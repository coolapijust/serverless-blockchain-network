/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * Proposer Worker - 区块提议者
 * ============================================
 * 
 * 核心职责：
 * 1. HTTP 事件驱动触发（禁用 Cron）
 * 2. 检查 DO Queue，批量打包交易（1-20 笔）
 * 3. 并行请求 2 Validators 签名（Promise.all）
 * 4. 收集 2/3 签名后原子提交
 * 5. 并发控制（processing 锁）
 * 
 * 触发方式：
 * - API Worker 提交交易后立即 HTTP POST /internal/trigger
 * - Durable Objects Alarm 兜底唤醒
 */

import type {
  Block,
  Transaction,
  ValidatorVote,
  ValidateResponse,
  ProposerEnv,
} from '../types';

import {
  signBlock,
  hashBlock,
  hexToBytes,
  addHexPrefix,
} from '../crypto';

// ============================================
// 配置
// ============================================

interface ProposerConfig {
  nodeId: string;
  validatorUrls: string[];
  blockMaxTxs: number;
  blockMinTxs: number;
  consensusTimeoutMs: number;
  privateKey: string;
}

// ============================================
// 主处理函数
// ============================================

export default {
  async fetch(request: Request, env: ProposerEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // 配置
    const config: ProposerConfig = {
      nodeId: env.NODE_ID || 'proposer-0',
      validatorUrls: JSON.parse(env.VALIDATOR_URLS || '[]'),
      blockMaxTxs: parseInt(env.BLOCK_MAX_TXS || '20'),
      blockMinTxs: parseInt(env.BLOCK_MIN_TXS || '1'),
      consensusTimeoutMs: parseInt(env.CONSENSUS_TIMEOUT_MS || '3000'),
      privateKey: env.PROPOSER_PRIVATE_KEY || '',
    };

    console.log(`[Proposer] ${request.method} ${path}`, { url: request.url });

    // 健康检查
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        version: 'v1.1-path-fix-debug',
        nodeId: config.nodeId,
        role: 'proposer',
        validators: config.validatorUrls.length,
      });
    }

    // 核心触发接口：/internal/trigger 或 /trigger
    if ((path === '/internal/trigger' || path === '/trigger') && request.method === 'POST') {
      return handleTrigger(request, env, config);
    }

    // 查询状态
    if (path === '/status' && request.method === 'GET') {
      return getStatus(env);
    }

    return Response.json({
      error: 'Not found',
      debug: {
        method: request.method,
        path,
        url: request.url
      }
    }, { status: 404 });
  },
};

// ============================================
// 事件驱动触发处理
// ============================================

async function handleTrigger(
  request: Request,
  env: ProposerEnv,
  config: ProposerConfig
): Promise<Response> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  console.log(`[Proposer ${config.nodeId}] Trigger received`, { requestId, time: startTime });

  try {
    // 获取 DO stub
    const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const doStub = env.CONSENSUS_COORDINATOR.get(doId);

    // 步骤 1：尝试获取 processing 锁
    // 关键：防止并发双花
    const lockResult = await acquireLock(doStub);

    if (!lockResult.success) {
      console.log(`[Proposer ${config.nodeId}] Lock acquisition failed:`, lockResult.error);
      return Response.json({
        success: false,
        error: lockResult.error,
        requestId,
      }, { status: 409 }); // 409 Conflict
    }

    const queue = lockResult.queue!;
    console.log(`[Proposer ${config.nodeId}] Lock acquired, queue size:`, queue.transactions.length);

    // 步骤 2：打包区块
    const packResult = await packBlock(doStub, config.nodeId);

    if (!packResult.success) {
      // 打包失败，释放锁
      await releaseLock(doStub, false);
      return Response.json({
        success: false,
        error: packResult.error,
        requestId,
      }, { status: 500 });
    }

    const block = packResult.block!;
    console.log(`[Proposer ${config.nodeId}] Block packed:`, {
      height: block.header.height,
      txCount: block.transactions.length,
    });

    // 步骤 3：签名区块
    const proposerSignature = await signBlock(block.hash, config.privateKey);
    block.proposerSignature = proposerSignature;

    // 步骤 4：并行请求验证者签名（Promise.all）
    const validationStart = Date.now();
    const { votes, errors } = await collectValidatorVotes(env, block, config);
    const validationTime = Date.now() - validationStart;

    console.log(`[Proposer ${config.nodeId}] Validation completed:`, {
      votes: votes.length,
      time: validationTime,
    });

    // 检查签名数（2/3）
    if (votes.length < 2) {
      // 共识失败，释放锁
      await releaseLock(doStub, false);
      return Response.json({
        success: false,
        error: `Insufficient votes: ${votes.length}/2 required`,
        debug: {
          validatorUrls: config.validatorUrls,
          validationTime,
          blockHeight: block.header.height,
          txCount: block.transactions.length,
          errors, // Include detailed errors
        },
        requestId,
      }, { status: 500 });
    }

    // 步骤 5：原子提交区块
    block.votes = votes;
    const commitResult = await commitBlock(doStub, block, votes);

    if (!commitResult.success) {
      // 提交失败，释放锁但不清空队列（可以重试）
      await releaseLock(doStub, false);
      return Response.json({
        success: false,
        error: commitResult.error,
        requestId,
      }, { status: 500 });
    }

    const totalTime = Date.now() - startTime;
    console.log(`[Proposer ${config.nodeId}] Block committed:`, {
      height: block.header.height,
      hash: block.hash,
      txCount: block.transactions.length,
      totalTime,
    });

    return Response.json({
      success: true,
      block: {
        height: block.header.height,
        hash: block.hash,
        txCount: block.transactions.length,
        timestamp: block.header.timestamp,
      },
      consensusTime: totalTime,
      requestId,
    });

  } catch (error) {
    console.error(`[Proposer ${config.nodeId}] Error:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 尝试上报错误到 DO
    try {
      const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
      const doStub = env.CONSENSUS_COORDINATOR.get(doId);
      await reportErrorToDO(doStub, errorMessage);
      await releaseLock(doStub, false);
    } catch (e) {
      // 忽略
    }

    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
    }, { status: 500 });
  }
}

// ============================================
// DO 操作封装
// ============================================

async function acquireLock(doStub: DurableObjectStub): Promise<{
  success: boolean;
  queue?: { transactions: Transaction[]; processing: boolean };
  error?: string;
}> {
  const response = await doStub.fetch('http://do/internal/acquire-lock', {
    method: 'POST',
  });

  return response.json() as Promise<{
    success: boolean;
    queue?: { transactions: Transaction[]; processing: boolean };
    error?: string;
  }>;
}

async function releaseLock(doStub: DurableObjectStub, clearQueue: boolean): Promise<void> {
  await doStub.fetch('http://do/internal/release-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clearQueue }),
  });
}

async function packBlock(
  doStub: DurableObjectStub,
  proposerId: string
): Promise<{ success: boolean; block?: Block; error?: string }> {
  const response = await doStub.fetch('http://do/internal/pack-block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposerId }),
  });

  return response.json() as Promise<{ success: boolean; block?: Block; error?: string }>;
}

async function reportErrorToDO(doStub: DurableObjectStub, error: string): Promise<void> {
  await doStub.fetch('http://do/internal/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  });
}

async function commitBlock(
  doStub: DurableObjectStub,
  block: Block,
  votes: ValidatorVote[]
): Promise<{ success: boolean; error?: string }> {
  const response = await doStub.fetch('http://do/internal/commit-block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block, votes }),
  });

  return response.json() as Promise<{ success: boolean; error?: string }>;
}

// ============================================
// 验证者通信
// ============================================

async function collectValidatorVotes(
  env: ProposerEnv,
  block: Block,
  config: ProposerConfig
): Promise<{ votes: ValidatorVote[]; errors: string[] }> {
  const votes: ValidatorVote[] = [];

  // 并行请求所有验证者
  const validationPromises = config.validatorUrls.map(async (url, index) => {
    try {
      // 确定服务绑定（如果有）
      const serviceName = `VALIDATOR_${index + 1}_SERVICE` as keyof ProposerEnv;
      const validatorService = (env as any)[serviceName] as Fetcher | undefined;

      console.log(`[Proposer] Validating with Validator ${index}...`, { useService: !!validatorService });

      // BigInt 安全序列化
      const safeStringify = (obj: any) => JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );

      let response: Response;
      if (validatorService) {
        response = await validatorService.fetch('http://validator/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeStringify({
            block,
            proposerId: config.nodeId,
          }),
        });
      } else {
        response = await fetch(`${url}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeStringify({
            block,
            proposerId: config.nodeId,
          }),
        });
      }

      if (!response.ok) {
        const errorBody = await response.text();
        return { error: `HTTP ${response.status}: ${errorBody}` };
      }

      const resultText = await response.text();
      let result: ValidateResponse;
      try {
        result = JSON.parse(resultText) as ValidateResponse;
      } catch (e) {
        return { error: `Invalid JSON: ${resultText.substring(0, 100)}` };
      }

      if (!result.valid || !result.signature) {
        return { error: result.error || 'Validation failed' };
      }

      return {
        vote: {
          validatorId: result.validatorId,
          validatorPubKey: result.publicKey || '',
          signature: result.signature,
          timestamp: result.timestamp,
        }
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 等待所有验证完成（使用 Promise.all 并行）
  const results = await Promise.all(validationPromises);

  // 收集有效签名
  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.vote) {
      votes.push(result.vote);
    } else {
      errors.push(`Validator ${i}: ${result.error || 'Unknown error'}`);
    }
  }

  // 记录错误汇总
  if (errors.length > 0) {
    console.error('[Proposer] Validation errors:', errors);
  }

  return { votes, errors };
}

// ============================================
// 状态查询
// ============================================

async function getStatus(env: ProposerEnv): Promise<Response> {
  try {
    const doId = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const doStub = env.CONSENSUS_COORDINATOR.get(doId);

    const response = await doStub.fetch('http://internal/state', {
      method: 'GET',
    });

    const state = await response.json();

    return Response.json({
      nodeId: env.NODE_ID,
      role: 'proposer',
      status: 'active',
      ...(state as any),
    });
  } catch (error) {
    return Response.json({
      nodeId: env.NODE_ID,
      role: 'proposer',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
