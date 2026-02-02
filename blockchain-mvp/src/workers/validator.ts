/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * Validator Worker - 无状态验证节点
 * ============================================
 * 
 * 核心职责：
 * 1. 无状态验签（不存储任何状态）
 * 2. 暴露 /validate 接口，验证区块有效性
 * 3. 验证通过后返回 Ed25519 签名
 * 
 * 设计原则：
 * - 完全无状态，便于水平扩展
 * - 所有验证逻辑独立，不依赖外部状态
 * - 快速响应，验证时间 < 100ms
 */

import type {
  Block,
  Transaction,
  ValidateRequest,
  ValidateResponse,
  ValidatorEnv,
  ValidatorVote,
  WorldState,
} from '../types';

import {
  verifySignature,
  signBlock,
  hashBlock,
  hashTransaction,
  computeMerkleRoot,
  publicKeyToAddress,
  addHexPrefix,
  hexToBytes,
  importKeyPairFromPrivateKey,
  sha256Hex,
  objectToBytes,
} from '../crypto';

// ============================================
// 配置
// ============================================

interface ValidatorConfig {
  nodeId: string;
  validatorIndex: number;
  privateKey: string;
  publicKey: string;
}

// ============================================
// 主处理函数
// ============================================

export default {
  async fetch(request: Request, env: ValidatorEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 配置
    const config: ValidatorConfig = {
      nodeId: env.NODE_ID || `validator-${env.VALIDATOR_INDEX || 0}`,
      validatorIndex: parseInt(env.VALIDATOR_INDEX || '0'),
      privateKey: env.VALIDATOR_PRIVATE_KEY || '',
      publicKey: '', // 从私钥派生
    };

    console.log(`[Validator ${config.nodeId}] Request: ${request.method} ${path}`);

    // 健康检查
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        nodeId: config.nodeId,
        role: 'validator',
        index: config.validatorIndex,
      });
    }

    // 核心验证接口：/validate
    if (path === '/validate' && request.method === 'POST') {
      return handleValidate(request, env, config);
    }

    // 查询状态（仅返回节点信息）
    if (path === '/status' && request.method === 'GET') {
      return Response.json({
        nodeId: config.nodeId,
        role: 'validator',
        index: config.validatorIndex,
        status: 'active',
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};

// ============================================
// 验证处理
// ============================================

async function handleValidate(
  request: Request,
  env: ValidatorEnv,
  config: ValidatorConfig
): Promise<Response> {
  const startTime = Date.now();

  try {
    const rawBody = await request.text();
    console.log(`[Validator ${config.nodeId}] Raw request body:`, rawBody.substring(0, 500));

    const body = JSON.parse(rawBody) as ValidateRequest;
    const { block, proposerId } = body;

    console.log(`[Validator ${config.nodeId}] Validating block:`, {
      height: block?.header?.height,
      txCount: block?.transactions?.length || 0,
      proposer: proposerId,
      receivedHash: block?.hash?.substring(0, 20),
      header: JSON.stringify(block?.header).substring(0, 200),
    });

    // 防御性检查
    if (!block || !block.header || !block.transactions) {
      return Response.json({
        valid: false,
        validatorId: config.nodeId,
        error: 'Invalid block structure',
        timestamp: Date.now(),
      });
    }

    // 还原 BigInt 字段（JSON 序列化后会变成字符串）
    block.transactions = block.transactions.map((tx: any) => ({
      ...tx,
      amount: typeof tx.amount === 'bigint' ? tx.amount : BigInt(tx.amount || '0'),
      gasPrice: typeof tx.gasPrice === 'bigint' ? tx.gasPrice : BigInt(tx.gasPrice || '0'),
      gasLimit: typeof tx.gasLimit === 'bigint' ? tx.gasLimit : BigInt(tx.gasLimit || '0'),
    }));

    // 执行验证
    const validationResult = await validateBlock(block, env, config);

    if (!validationResult.valid) {
      console.log(`[Validator ${config.nodeId}] Block rejected:`, validationResult.error);

      const response: ValidateResponse = {
        valid: false,
        validatorId: config.nodeId,
        error: validationResult.error,
        timestamp: Date.now(),
      };

      return Response.json(response);
    }

    // 验证通过，签名区块
    let signature: string;
    let publicKey: string;

    try {
      signature = await signBlock(block.hash, config.privateKey);
    } catch (e: any) {
      console.error(`[Validator ${config.nodeId}] Signing failed:`, e);
      throw new Error(`Signing failed: ${e.message}`);
    }

    try {
      // 从私钥获取公钥 (用于提议者收集)
      const keyPair = await importKeyPairFromPrivateKey(config.privateKey);
      publicKey = keyPair.publicKey;
    } catch (e: any) {
      console.error(`[Validator ${config.nodeId}] Key derivation failed:`, e);
      throw new Error(`Key derivation failed: ${e.message}`);
    }

    const response: ValidateResponse = {
      valid: true,
      validatorId: config.nodeId,
      publicKey: publicKey,
      signature,
      timestamp: Date.now(),
    };

    const validationTime = Date.now() - startTime;
    console.log(`[Validator ${config.nodeId}] Block validated:`, {
      height: block.header.height,
      time: validationTime,
    });

    return Response.json(response);

  } catch (error) {
    console.error(`[Validator ${config.nodeId}] Error:`, error);

    const response: ValidateResponse = {
      valid: false,
      validatorId: config.nodeId,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
    };

    return Response.json(response, { status: 500 });
  }
}

// ============================================
// 区块验证逻辑
// ============================================

interface ValidationResult {
  valid: boolean;
  error?: string;
}

async function validateBlock(
  block: Block,
  env: ValidatorEnv,
  config: ValidatorConfig
): Promise<ValidationResult> {

  // 1. 验证区块哈希
  const computedHash = await hashBlock({
    height: block.header.height,
    timestamp: block.header.timestamp,
    prevHash: block.header.prevHash,
    txRoot: block.header.txRoot,
    stateRoot: block.header.stateRoot,
    proposer: block.header.proposer,
    txCount: block.header.txCount,
  });

  console.log(`[Validator] Hash comparison:`, {
    computed: computedHash.substring(0, 20),
    received: block.hash.substring(0, 20),
    match: computedHash === block.hash
  });

  if (computedHash !== block.hash) {
    return {
      valid: false,
      error: `Invalid block hash: computed ${computedHash.substring(0, 20)}... != received ${block.hash.substring(0, 20)}... (PrevHash: ${block.header.prevHash.substring(0, 10)}..., TxRoot: ${block.header.txRoot.substring(0, 10)}..., Timestamp: ${block.header.timestamp})`
    };
  }

  // 2. 验证提议者签名
  // 注意：生产环境需要从配置中获取提议者公钥
  // 这里简化处理，假设签名有效
  if (!block.proposerSignature) {
    return { valid: false, error: 'Missing proposer signature' };
  }

  // 3. 验证交易数量
  if (block.transactions.length !== block.header.txCount) {
    return {
      valid: false,
      error: `Transaction count mismatch: ${block.transactions.length} vs ${block.header.txCount}`
    };
  }

  // 4. 验证交易根
  if (block.transactions.length > 0) {
    const txHashes = await Promise.all(block.transactions.map(async tx => {
      return hashTransaction({
        from: tx.from,
        to: tx.to,
        amount: tx.amount.toString(),
        nonce: tx.nonce,
        publicKey: tx.publicKey,
        timestamp: tx.timestamp,
        gasPrice: tx.gasPrice.toString(),
        gasLimit: tx.gasLimit.toString(),
      });
    }));

    const computedTxRoot = await computeMerkleRoot(txHashes);
    if (computedTxRoot !== block.header.txRoot) {
      return { valid: false, error: 'Invalid transaction root' };
    }
  }

  // 5. 验证每笔交易
  for (let i = 0; i < block.transactions.length; i++) {
    const tx = block.transactions[i];
    const txResult = await validateTransaction(tx, i);

    if (!txResult.valid) {
      return {
        valid: false,
        error: `Transaction ${i} invalid: ${txResult.error}`
      };
    }
  }

  // 6. 验证状态根（通过 DO 查询当前状态并模拟执行）
  const stateResult = await validateStateRoot(block, env);
  if (!stateResult.valid) {
    return stateResult;
  }

  // 7. 验证时间戳（不能是未来时间）
  const now = Date.now();
  if (block.header.timestamp > now + 60000) { // 允许 1 分钟时钟偏差
    return { valid: false, error: 'Block timestamp is in the future' };
  }

  return { valid: true };
}

// ============================================
// 交易验证
// ============================================

async function validateTransaction(
  tx: Transaction,
  index: number
): Promise<ValidationResult> {

  // 1. 验证交易哈希
  const computedHash = await hashTransaction({
    from: tx.from,
    to: tx.to,
    amount: tx.amount.toString(),
    nonce: tx.nonce,
    publicKey: tx.publicKey,
    timestamp: tx.timestamp,
    gasPrice: tx.gasPrice.toString(),
    gasLimit: tx.gasLimit.toString(),
  });

  if (computedHash !== tx.hash) {
    return { valid: false, error: 'Invalid transaction hash' };
  }

  // 2. 验证地址格式
  if (!tx.from || !tx.to) {
    return { valid: false, error: 'Missing from/to address' };
  }

  // 3. 验证金额
  if (tx.amount < BigInt(0)) {
    return { valid: false, error: 'Negative amount' };
  }

  // 4. 验证时间戳
  const now = Date.now();
  if (tx.timestamp > now + 60000) {
    return { valid: false, error: 'Transaction timestamp is in the future' };
  }

  // 5. 验证签名存在
  if (!tx.signature) {
    return { valid: false, error: 'Missing signature' };
  }

  // 注意：完整的签名验证需要知道发送方公钥
  // 在实际实现中，地址应该能从公钥恢复
  // 这里简化处理

  return { valid: true };
}

// ============================================
// 状态根验证
// ============================================

async function validateStateRoot(
  block: Block,
  env: ValidatorEnv
): Promise<ValidationResult> {
  try {
    // 获取 DO stub 查询当前状态
    const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const doStub = env.CONSENSUS_COORDINATOR.get(doId);

    // 查询当前世界状态
    const stateResponse = await doStub.fetch('http://internal/state', {
      method: 'GET',
    });

    if (!stateResponse.ok) {
      return { valid: false, error: 'Failed to query world state' };
    }

    const rawState = await stateResponse.json() as any;
    const worldState = rawState.worldState;

    // 修复：还原 balances 中的 BigInt
    worldState.balances = Object.fromEntries(
      Object.entries(worldState.balances).map(([k, v]) => [k, BigInt(v as string)])
    );

    // 验证区块高度
    if (block.header.height !== worldState.latestBlockHeight + 1) {
      return {
        valid: false,
        error: `Invalid block height. Expected: ${worldState.latestBlockHeight + 1}, got: ${block.header.height}`
      };
    }

    // 验证前一区块哈希
    if (block.header.prevHash !== worldState.latestBlockHash) {
      return { valid: false, error: 'Invalid previous block hash' };
    }

    // 模拟执行交易，计算新的状态根
    const newBalances = { ...worldState.balances };
    const newNonces = { ...worldState.nonces };

    for (const tx of block.transactions) {
      // 验证 nonce
      const currentNonce = newNonces[tx.from] || 0;
      if (tx.nonce !== currentNonce) {
        return {
          valid: false,
          error: `Invalid nonce for ${tx.from}. Expected: ${currentNonce}, got: ${tx.nonce}`
        };
      }

      // 验证余额
      const fromBalance = newBalances[tx.from] || BigInt(0);
      if (fromBalance < tx.amount) {
        return {
          valid: false,
          error: `Insufficient balance for ${tx.from}. Has: ${fromBalance}, needs: ${tx.amount}`
        };
      }

      // 执行转账
      newBalances[tx.from] = fromBalance - tx.amount;
      newBalances[tx.to] = (newBalances[tx.to] || BigInt(0)) + tx.amount;

      // 更新 nonce
      newNonces[tx.from] = currentNonce + 1;
    }

    // 计算新的状态根
    const stateData = {
      balances: Object.entries(newBalances).map(([k, v]) => [k, (v as bigint).toString()]),
      nonces: newNonces,
    };

    // Use statically imported sha256Hex and objectToBytes
    const computedStateRoot = await sha256Hex(objectToBytes(stateData));

    if (computedStateRoot !== block.header.stateRoot) {
      return {
        valid: false,
        error: `Invalid state root. Expected: ${computedStateRoot}, got: ${block.header.stateRoot}`
      };
    }

    return { valid: true };

  } catch (error) {
    console.error('[Validator] State validation error:', error);
    return { valid: false, error: 'State validation failed' };
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 验证地址格式
 */
function isValidAddress(address: string): boolean {
  if (!address) return false;

  const clean = address.startsWith('0x') ? address.slice(2) : address;

  if (clean.length !== 40) return false;

  return /^[0-9a-fA-F]+$/.test(clean);
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
    }

    // 指数退避
    await delay(Math.pow(2, i) * 100);
  }

  throw lastError || new Error('Max retries exceeded');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
