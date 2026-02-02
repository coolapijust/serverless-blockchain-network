/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * API Gateway Worker
 * ============================================
 * 
 * 核心职责：
 * 1. 接收交易提交（POST /tx/submit）
 * 2. 验签 + Nonce 防重放检查
 * 3. 写入 DO Pending Queue（强一致）
  * 4. 立即 HTTP POST 唤醒 Proposer（事件驱动）
 * 5. 提供查询接口（账户、区块、交易）
 * 
 * 设计原则：
 * - 所有写操作通过 DO 原子事务
 * - 提交后立即触发共识（无延迟）
 * - 返回预估确认时间（3秒内）
 */

import type {
  Transaction,
  SubmitTransactionRequest,
  SubmitTransactionResponse,
  ApiResponse,
  NetworkStatusResponse,
  AccountQueryResponse,
  TransactionReceipt,
  ApiEnv,
  Address,
  HexString,
  StateQueryResponse,
} from '../types';

import { ConsensusState } from '../types';

import {
  hashTransaction,
  verifySignature,
  verifyTransactionSignature,
  signTransaction,
  publicKeyToAddress,
  addHexPrefix,
  generateRandomPrivateKey,
  getTestKeyPair,
} from '../crypto';

// ============================================
// CORS 响应头
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ============================================
// 主处理函数
// ============================================

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    let requestId = 'unknown';

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      requestId = crypto.randomUUID();
      // 健康检查
      if (path === '/health') {
        return jsonResponse({ status: 'ok', service: 'blockchain-api', requestId });
      }

      // 提交交易
      if (path === '/tx/submit' && request.method === 'POST') {
        return handleSubmitTransaction(request, env, requestId);
      }

      // 查询交易
      if (path.startsWith('/tx/') && request.method === 'GET') {
        const txHash = path.split('/')[2];
        return handleQueryTransaction(txHash, env, requestId);
      }

      // 查询账户
      if (path.startsWith('/account/') && request.method === 'GET') {
        const address = path.split('/')[2];
        return handleQueryAccount(address, env, requestId);
      }

      // 查询区块
      if (path.startsWith('/block/') && request.method === 'GET') {
        const heightOrHash = path.split('/')[2];
        return handleQueryBlock(heightOrHash, env, requestId);
      }

      // 查询最新区块
      if (path === '/block/latest' && request.method === 'GET') {
        return handleQueryLatestBlock(env, requestId);
      }

      // 创世初始化 (Admin)
      if (path === '/admin/init-genesis' && request.method === 'POST') {
        return handleInitGenesis(request, env, requestId);
      }

      // 网络状态
      if (path === '/status' && request.method === 'GET') {
        return handleNetworkStatus(env, requestId);
      }

      // 获取测试代币（仅测试网）
      if (path === '/faucet' && request.method === 'POST') {
        return handleFaucet(request, env, requestId);
      }

      return jsonResponse({ error: 'Not found', requestId }, 404);

    } catch (error) {
      console.error('[API] Error:', error);
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        requestId,
      }, 500);
    }
  },
};

// ============================================
// 交易提交处理
// ============================================

async function handleSubmitTransaction(
  request: Request,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  // 解析请求
  const body = await request.json() as SubmitTransactionRequest;

  // 验证必填字段
  if (!body.from || !body.to || !body.signature || !body.publicKey) {
    return jsonResponse({
      success: false,
      error: 'Missing required fields: from, to, signature, publicKey',
      requestId,
    }, 400);
  }

  // 验证地址格式
  if (!isValidAddress(body.from) || !isValidAddress(body.to)) {
    return jsonResponse({
      success: false,
      error: 'Invalid address format',
      requestId,
    }, 400);
  }

  // 1. 验证公钥与地址匹配
  // 这一步至关重要：确保提供的公钥属于发送方
  const derivedAddress = publicKeyToAddress(body.publicKey);
  if (derivedAddress.toLowerCase() !== body.from.toLowerCase()) {
    return jsonResponse({
      success: false,
      error: `Public key does not match sender address. Expected: ${body.from}, Derived: ${derivedAddress}`,
      requestId,
    }, 400);
  }

  // 构建交易对象
  const tx: Transaction = {
    hash: '', // 稍后计算
    from: body.from.toLowerCase(),
    to: body.to.toLowerCase(),
    amount: BigInt(body.amount || '0'),
    nonce: body.nonce,
    timestamp: body.timestamp || Date.now(),
    gasPrice: BigInt(0),
    gasLimit: BigInt(21000),
    signature: body.signature,
    publicKey: body.publicKey,
  };

  // 计算交易哈希
  tx.hash = await hashTransaction({
    from: tx.from,
    to: tx.to,
    amount: tx.amount.toString(),
    nonce: tx.nonce,
    publicKey: tx.publicKey, // Add back publicKey
    timestamp: tx.timestamp,
    gasPrice: tx.gasPrice.toString(),
    gasLimit: tx.gasLimit.toString(),
  });

  // 2. 验证签名（防篡改 + 防抵赖）
  // 验证 (from, to, amount, nonce, timestamp) 是否由 publicKey 签名
  const isValidSignature = await verifyTransactionSignature({
    from: tx.from,
    to: tx.to,
    amount: tx.amount.toString(),
    nonce: tx.nonce,
    timestamp: tx.timestamp,
    signature: tx.signature,
  }, tx.publicKey);

  if (!isValidSignature) {
    return jsonResponse({
      success: false,
      error: 'Invalid signature',
      requestId,
    }, 401);
  }

  console.log('[API] Submitting transaction:', {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    amount: tx.amount.toString(),
    nonce: tx.nonce,
  });

  // 获取 DO stub
  const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
  const doStub = env.CONSENSUS_COORDINATOR.get(doId);

  // 写入 Pending Queue
  const addResult = await addTransactionToQueue(doStub, tx);

  if (!addResult.success) {
    return jsonResponse({
      success: false,
      error: addResult.error,
      requestId,
    }, 400);
  }

  console.log('[API] Transaction added to queue:', tx.hash);

  // 立即触发 Proposer（事件驱动关键）
  // 使用 waitUntil 确保触发在后台执行，不阻塞响应
  const triggerPromise = triggerProposer(env);

  // 等待触发完成（或超时）
  const triggerTimeout = 2000; // 2 秒超时
  const triggerResult = await Promise.race([
    triggerPromise,
    new Promise<{ triggered: boolean; error?: string }>((resolve) => {
      setTimeout(() => resolve({ triggered: false, error: 'Trigger timeout' }), triggerTimeout);
    }),
  ]);

  console.log('[API] Proposer trigger result:', triggerResult);

  const processingTime = Date.now() - startTime;

  // 返回响应
  const response: SubmitTransactionResponse = {
    success: true,
    txHash: tx.hash,
    blockHeight: undefined, // 尚未确认
    estimatedConfirmationTime: 3000, // 预估 3 秒
  };

  return jsonResponse({
    ...response,
    processingTimeMs: processingTime,
    triggerStatus: triggerResult.triggered ? 'success' : 'pending',
    requestId,
  });
}

// ============================================
// 查询接口
// ============================================

async function handleQueryTransaction(
  txHash: HexString,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
  const doStub = env.CONSENSUS_COORDINATOR.get(doId);

  const receipt = await queryTransaction(doStub, txHash);

  if (!receipt) {
    return jsonResponse({
      success: false,
      error: 'Transaction not found',
      requestId,
    }, 404);
  }

  return jsonResponse({
    success: true,
    data: {
      ...receipt,
      transaction: {
        ...receipt.transaction,
        amount: receipt.transaction.amount.toString(),
        gasPrice: receipt.transaction.gasPrice.toString(),
        gasLimit: receipt.transaction.gasLimit.toString(),
      },
    },
    requestId,
  });
}

async function handleQueryAccount(
  address: Address,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
  const doStub = env.CONSENSUS_COORDINATOR.get(doId);

  const account = await queryAccount(doStub, address.toLowerCase());
  const pendingNonce = await getPendingNonce(doStub, address.toLowerCase());

  const response: AccountQueryResponse = {
    address: address.toLowerCase(),
    balance: account.balance.toString(),
    nonce: account.nonce,
    pendingNonce,
  };

  return jsonResponse({
    success: true,
    data: response,
    requestId,
  });
}

async function handleQueryBlock(
  heightOrHash: string,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
  const doStub = env.CONSENSUS_COORDINATOR.get(doId);

  // 判断是高度还是哈希
  const isHeight = /^\d+$/.test(heightOrHash);

  let block;
  if (isHeight) {
    block = await queryBlockByHeight(doStub, parseInt(heightOrHash));
  } else {
    // 通过哈希查询需要遍历，这里简化
    return jsonResponse({
      success: false,
      error: 'Query by hash not implemented',
      requestId,
    }, 501);
  }

  if (!block) {
    return jsonResponse({
      success: false,
      error: 'Block not found',
      requestId,
    }, 404);
  }

  return jsonResponse({
    success: true,
    data: block,
    requestId,
  });
}

async function handleQueryLatestBlock(
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
  const doStub = env.CONSENSUS_COORDINATOR.get(doId);

  const latest = await queryLatestBlock(doStub);

  return jsonResponse({
    success: true,
    data: latest,
    requestId,
  });
}

async function handleNetworkStatus(
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  try {
    const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const doStub = env.CONSENSUS_COORDINATOR.get(doId);

    const state = await queryState(doStub);

    const response: NetworkStatusResponse = {
      networkId: env.NETWORK_ID || 'unknown',
      chainId: env.CHAIN_ID || '0',
      latestBlockHeight: state?.worldState?.latestBlockHeight || 0,
      latestBlockHash: state?.worldState?.latestBlockHash || '0x0',
      pendingTransactions: state?.pendingCount || 0,
      totalTransactions: state?.worldState?.totalTransactions || 0,
      validators: state.validators || [],
      uptime: Math.floor((Date.now() - (state?.worldState?.lastUpdated || 0)) / 1000),
      lastError: state?.worldState?.lastProposerError
    };

    return jsonResponse({
      success: true,
      data: response,
      requestId,
    });
  } catch (error) {
    console.error('[NetworkStatus] Error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed',
      requestId
    }, 500);
  }
}

// ============================================
// 测试水龙头
// ============================================

async function handleFaucet(
  request: Request,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  try {
    // 允许 devnet 和 testnet
    const allowed = ['cloudflare-mvp-devnet', 'cloudflare-mvp-testnet'];
    if (env.NETWORK_ID && !allowed.includes(env.NETWORK_ID)) {
      return jsonResponse({
        success: false,
        error: `Faucet not available on ${env.NETWORK_ID}`,
        requestId,
      }, 403);
    }

    const body = await request.json() as { address: string; amount?: string };

    if (!body.address || !isValidAddress(body.address)) {
      return jsonResponse({
        success: false,
        error: 'Invalid address',
        requestId,
      }, 400);
    }

    // Amount logic: Default 1, Max 1000
    let amountWei = BigInt('1000000000000000000'); // 1 CF
    if (body.amount) {
      try {
        const reqAmount = BigInt(body.amount);
        // Max 1000 CF = 1000 * 1e18
        const maxAmount = BigInt('1000000000000000000000');
        if (reqAmount > 0n && reqAmount <= maxAmount) {
          amountWei = reqAmount;
        }
      } catch {
        // Invalid amount, ignore
      }
    }

    // 使用配置的 Faucet Key
    let faucetPriv = env.FAUCET_KEY;
    if (!faucetPriv) {
      // Fallback for dev (but we should have it)
      faucetPriv = getTestKeyPair(0).privateKey;
    }

    // Import Key
    const { importKeyPairFromPrivateKey } = await import('../crypto');
    const faucetKey = await importKeyPairFromPrivateKey(faucetPriv);

    // Check if imported successfully
    if (!faucetKey || !faucetKey.publicKey) {
      throw new Error("Invalid Faucet Key configuration");
    }

    const { publicKeyToAddress } = await import('../crypto');
    const faucetAddr = publicKeyToAddress(faucetKey.publicKey);

    // DEBUG: Return address to verify
    // return jsonResponse({ success: true, debug: true, faucetAddr });

    const timestamp = Date.now();

    // Fetch Faucet Nonce first (using unique var names)
    const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const doStub = env.CONSENSUS_COORDINATOR.get(doId);

    // Use helper queryAccount (defined in this file)
    // Note: account query is async
    console.log('[Faucet] Using address:', faucetAddr);
    const faucetAccount = await queryAccount(doStub, faucetAddr);
    console.log('[Faucet] Account State:', { address: faucetAddr, balance: faucetAccount.balance.toString(), nonce: faucetAccount.nonce });

    const txData = {
      from: faucetAddr,
      to: body.address.toLowerCase(),
      amount: amountWei.toString(),
      nonce: faucetAccount.nonce,
      timestamp, // Fix: Added timestamp
    };

    const signature = await signTransaction(txData, faucetKey.privateKey);

    // 构建完整交易
    const tx: Transaction = {
      hash: '',
      from: txData.from,
      to: txData.to,
      amount: BigInt(txData.amount),
      nonce: txData.nonce,
      publicKey: faucetKey.publicKey,
      timestamp: txData.timestamp,
      gasPrice: BigInt(0),
      gasLimit: BigInt(21000),
      signature,
    };

    tx.hash = await hashTransaction({
      from: tx.from,
      to: tx.to,
      amount: tx.amount.toString(),
      nonce: tx.nonce,
      publicKey: tx.publicKey,
      timestamp: tx.timestamp,
      gasPrice: tx.gasPrice.toString(),
      gasLimit: tx.gasLimit.toString(),
    });

    // 提交到队列
    // Reuse doStub from above
    const addResult = await addTransactionToQueue(doStub, tx);

    if (!addResult.success) {
      // 获取当前所有余额账户名以供核对
      const doState = await doStub.fetch('http://do/state').then(r => r.json()) as any;
      const accounts = Object.keys(doState?.worldState?.balances || {}).join(', ');

      return jsonResponse({
        success: false,
        error: `${addResult.error} (Addr: ${faucetAddr}, Bal: ${faucetAccount.balance.toString()}, Known: [${accounts}])`,
        requestId,
      }, 500);
    }

    // 触发 Proposer（等待完成以确保成功）
    const triggerTimeout = 2000; // 2 秒超时
    const triggerResult = await Promise.race([
      triggerProposer(env),
      new Promise<{ triggered: boolean; error?: string }>((resolve) => {
        setTimeout(() => resolve({ triggered: false, error: 'Trigger timeout' }), triggerTimeout);
      }),
    ]);

    console.log('[Faucet] Proposer trigger result:', triggerResult);

    return jsonResponse({
      success: true,
      data: {
        txHash: tx.hash,
        amount: txData.amount,
        to: txData.to,
      },
      triggerStatus: triggerResult.triggered ? 'success' : 'pending',
      requestId,
    });
  } catch (error) {
    console.error('[Faucet] Error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Faucet internal error',
      requestId
    }, 500);
  }
}

// ============================================
// DO 操作封装
// ============================================

async function addTransactionToQueue(
  doStub: DurableObjectStub,
  tx: Transaction
): Promise<{ success: boolean; error?: string }> {
  const response = await doStub.fetch('http://do/internal/add-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx, (_, v) => typeof v === 'bigint' ? v.toString() : v),
  });

  return response.json() as Promise<{ success: boolean; error?: string }>;
}

async function queryTransaction(
  doStub: DurableObjectStub,
  txHash: HexString
): Promise<TransactionReceipt | null> {
  const response = await doStub.fetch(`http://do/tx/${txHash}`, {
    method: 'GET',
  });

  if (!response.ok) return null;

  const result = (await response.json()) as any;
  if (result.error) return null;

  return result as TransactionReceipt;
}

async function queryAccount(
  doStub: DurableObjectStub,
  address: Address
): Promise<{ balance: bigint; nonce: number }> {
  const response = await doStub.fetch(`http://do/account/${address}`, {
    method: 'GET',
  });

  const result = await response.json() as { balance: string; nonce: number };

  return {
    balance: BigInt(result.balance),
    nonce: result.nonce,
  };
}

async function getPendingNonce(doStub: DurableObjectStub, address: Address): Promise<number> {
  // 查询 Pending Queue 中该地址的交易
  const response = await doStub.fetch('http://do/internal/queue', {
    method: 'GET',
  });

  const result = await response.json() as { transactions: Transaction[] };

  // 找到该地址的最大 nonce
  const addressTxs = result.transactions.filter(tx => tx.from === address);
  if (addressTxs.length === 0) {
    const account = await queryAccount(doStub, address);
    return account.nonce;
  }

  const maxNonce = Math.max(...addressTxs.map(tx => tx.nonce));
  return maxNonce + 1;
}

async function queryBlockByHeight(
  doStub: DurableObjectStub,
  height: number
): Promise<unknown | null> {
  const response = await doStub.fetch(`http://do/block/${height}`, {
    method: 'GET',
  });

  if (!response.ok) return null;

  const result = (await response.json()) as any;
  if (result.error) return null;

  return result;
}

async function queryLatestBlock(
  doStub: DurableObjectStub
): Promise<{ height: number; hash: string; timestamp: number }> {
  const response = await doStub.fetch('http://do/block/latest', {
    method: 'GET',
  });

  return response.json() as Promise<{ height: number; hash: string; timestamp: number }>;
}

async function queryState(doStub: DurableObjectStub): Promise<{
  worldState: {
    latestBlockHeight: number;
    latestBlockHash: string;
    totalTransactions: number;
    lastUpdated: number;
    lastProposerError?: string;
  };
  pendingCount: number;
  validators: string[];
}> {
  try {
    const response = await doStub.fetch('http://do/state', {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DO Query failed: ${response.status} ${text}`);
    }

    return await response.json() as any;
  } catch (error) {
    console.error('[API] queryState failed:', error);
    throw error;
  }
}

// ============================================
// Proposer 触发
// ============================================

async function triggerProposer(env: ApiEnv): Promise<{ triggered: boolean; error?: string }> {
  try {
    const proposerUrl = env.PROPOSER_URL;
    const proposerService = env.PROPOSER_SERVICE;

    if (!proposerService && !proposerUrl) {
      return { triggered: false, error: 'Proposer URL/Service not configured' };
    }

    console.log('[API] Triggering Proposer...', { useService: !!proposerService });

    let response: Response;
    if (proposerService) {
      // 使用 Service Binding (更可靠)
      response = await proposerService.fetch('http://proposer/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trigger-Source': 'api-gateway',
        },
        body: JSON.stringify({ timestamp: Date.now() }),
      });
    } else {
      // 退回到公共 URL
      response = await fetch(`${proposerUrl}/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Trigger-Source': 'api-gateway',
        },
        body: JSON.stringify({ timestamp: Date.now() }),
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error('[API] Proposer trigger failed:', error);
      return { triggered: false, error: `HTTP ${response.status}: ${error}` };
    }

    const result = await response.json();
    console.log('[API] Proposer triggered successfully:', result);

    return { triggered: true };

  } catch (error) {
    console.error('[API] Proposer trigger error:', error);
    return {
      triggered: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// 工具函数
// ============================================

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function isValidAddress(address: string): boolean {
  if (!address) return false;

  const clean = address.startsWith('0x') ? address.slice(2) : address;

  if (clean.length !== 40) return false;

  return /^[0-9a-fA-F]+$/.test(clean);
}
/**
 * 处理创世初始化
 */
async function handleInitGenesis(
  request: Request,
  env: ApiEnv,
  requestId: string
): Promise<Response> {
  try {
    const id = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const stub = env.CONSENSUS_COORDINATOR.get(id);

    // 调用 DO 的初始化接口
    const response = await stub.fetch('http://do/internal/init-genesis', {
      method: 'POST',
    });

    const result = await response.json();
    return jsonResponse({
      success: true,
      data: result,
      requestId,
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Init genesis failed',
      requestId,
    }, 500);
  }
}

// ============================================
// 导出 Durable Object 类
// Wrangler 要求入口文件显式导出所有绑定的 DO 类
// ============================================
export { ConsensusCoordinator } from '../durable-objects/consensus';
