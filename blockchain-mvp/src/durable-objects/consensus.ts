/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * ConsensusCoordinator - Durable Object
 * ============================================
 * 
 * 核心职责：
 * 1. 存储 World State（强一致）
 * 2. 管理 Pending Queue（防双花关键）
 * 3. 原子性区块提交（storage.transaction）
 * 4. Alarm 兜底机制（5分钟超时强制出块）
 * 
 * 设计原则：
 * - 所有状态变更必须通过 storage.transaction 原子执行
 * - Pending Queue 存储在 DO 内存（强一致），绝不用 KV
 * - processing 标志作为并发锁，防止双花
 */

import {
  TransactionStatus,
  ConsensusState,
} from '../types';

import type {
  Transaction,
  Block,
  WorldState,
  PendingQueue,
  ConsensusConfig,
  ConsensusCoordinatorState,
  StateQueryResponse,
  BlockQueryResponse,
  TransactionReceipt,
  ValidatorVote,
  HexString,
  Address,
  BlockHash,
} from '../types';

import {
  hashBlock,
  hashTransaction,
  computeMerkleRoot,
  addHexPrefix,
  sha256Hex,
  objectToBytes,
  verifyBlockSignature,
} from '../crypto';

import {
  DEFAULT_GENESIS_CONFIG,
  generateGenesisBlock,
  generateInitialWorldState,
} from './genesis';

// ============================================
// 常量定义
// ============================================

/** 创世区块哈希 */
const GENESIS_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** 默认共识配置 */
const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  blockMaxTxs: 20,
  blockMinTxs: 1,
  consensusTimeoutMs: 3000,
  alarmTimeoutMs: 300000, // 5 分钟
  validators: [],
  requiredSignatures: 2,
};

/** 初始世界状态 - 从创世配置加载 */
const createInitialWorldState = (): WorldState => {
  // 从创世配置加载预挖分配
  const initialState = generateInitialWorldState(DEFAULT_GENESIS_CONFIG);

  return {
    balances: initialState.balances,
    nonces: initialState.nonces,
    latestBlockHeight: 0,
    latestBlockHash: GENESIS_HASH,
    genesisHash: GENESIS_HASH,
    totalTransactions: 0,
    lastUpdated: Date.now(),
  };
};

/** 初始待处理队列 */
const createInitialPendingQueue = (): PendingQueue => ({
  transactions: [],
  lastUpdated: Date.now(),
  processing: false,
});

// ============================================
// ConsensusCoordinator Durable Object
// ============================================

export class ConsensusCoordinator {
  private state: DurableObjectState;
  private env: unknown;

  // 缓存数据（减少 storage 读取）
  private worldState: WorldState | null = null;
  private pendingQueue: PendingQueue | null = null;
  private blockHistory: Map<number, Block> = new Map();
  private consensusConfig: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;

    // 初始化时加载数据
    this.initialize();
  }

  // ============================================
  // 初始化
  // ============================================

  private async initialize(): Promise<void> {
    // 尝试从 storage 加载
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');

    if (stored) {
      this.worldState = stored.worldState;
      this.pendingQueue = stored.pendingQueue;
      this.blockHistory = new Map(Object.entries(stored.blockHistory).map(([k, v]) => [parseInt(k), v]));
      this.consensusConfig = stored.consensusConfig;
    } else {
      // 首次创建，初始化状态
      this.worldState = createInitialWorldState();
      this.pendingQueue = createInitialPendingQueue();

      // 保存初始状态
      await this.persistState();
    }
  }

  /**
   * 持久化状态到 storage
   */
  private async persistState(): Promise<void> {
    const state: ConsensusCoordinatorState = {
      worldState: this.worldState!,
      pendingQueue: this.pendingQueue!,
      blockHistory: Object.fromEntries(this.blockHistory),
      consensusConfig: this.consensusConfig,
    };

    await this.state.storage.put('state', state);
  }

  // ============================================
  // 交易队列管理
  // ============================================

  /**
   * 添加交易到 Pending Queue
   * 关键：这是防双花的第一道防线
   */
  async addTransaction(tx: Transaction): Promise<{ success: boolean; error?: string }> {
    // 使用原子事务确保一致性
    return this.state.storage.transaction(async (txn) => {
      // 重新加载最新状态（防止并发）
      const stored = await txn.get<ConsensusCoordinatorState>('state');
      const queue = stored?.pendingQueue || createInitialPendingQueue();
      const worldState = stored?.worldState || createInitialWorldState();

      // 检查是否已在队列中（防双花）
      const exists = queue.transactions.some(t => t.hash === tx.hash);
      if (exists) {
        return { success: false, error: 'Transaction already in queue' };
      }

      // 检查 nonce（防重放）
      const currentNonce = worldState.nonces[tx.from] || 0;
      if (tx.nonce !== currentNonce) {
        return {
          success: false,
          error: `Invalid nonce. Expected: ${currentNonce}, got: ${tx.nonce}`
        };
      }

      // 检查余额
      const balance = worldState.balances[tx.from] || BigInt(0);
      if (balance < tx.amount) {
        return { success: false, error: 'Insufficient balance' };
      }

      // 添加到队列
      queue.transactions.push(tx);
      queue.lastUpdated = Date.now();

      // 更新状态
      const newState: ConsensusCoordinatorState = {
        ...stored!,
        pendingQueue: queue,
      };

      await txn.put('state', newState);

      // 更新本地缓存
      this.pendingQueue = queue;

      return { success: true };
    });
  }

  /**
   * 初始化创世状态
   */
  async initGenesis(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[ConsensusCoordinator] Initializing genesis...');

      const genesisBlock = await generateGenesisBlock(DEFAULT_GENESIS_CONFIG);
      const initialState = generateInitialWorldState(DEFAULT_GENESIS_CONFIG);

      console.log('[ConsensusCoordinator] Genesis InitialState Auditing:', {
        premineCount: DEFAULT_GENESIS_CONFIG.premine.length,
        balanceKeys: Object.keys(initialState.balances).length,
        firstAddr: DEFAULT_GENESIS_CONFIG.premine[0]?.address
      });

      const worldState: WorldState = {
        balances: initialState.balances,
        nonces: initialState.nonces,
        latestBlockHeight: 0,
        latestBlockHash: genesisBlock.hash,
        genesisHash: genesisBlock.hash,
        totalTransactions: genesisBlock.transactions.length,
        lastUpdated: Date.now(),
      };

      // 更新共识配置中的验证者列表
      const consensusConfig: ConsensusConfig = {
        ...this.consensusConfig,
        validators: initialState.validatorPublicKeys,
        requiredSignatures: Math.ceil(initialState.validatorPublicKeys.length * 2 / 3),
      };

      const newState: ConsensusCoordinatorState = {
        worldState,
        pendingQueue: createInitialPendingQueue(),
        blockHistory: { 0: genesisBlock },
        consensusConfig,
      };

      await this.state.storage.put('state', newState);

      // 更新本地状态
      this.worldState = worldState;
      this.pendingQueue = newState.pendingQueue;
      this.consensusConfig = consensusConfig;

      console.log('[ConsensusCoordinator] Genesis initialized:', genesisBlock.hash);
      return { success: true };
    } catch (error) {
      console.error('[ConsensusCoordinator] Genesis initialization failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * 获取 Pending Queue 状态 (Existing method)
   */
  async getPendingQueue(): Promise<PendingQueue> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    return stored?.pendingQueue || createInitialPendingQueue();
  }

  /**
   * 获取队列长度
   */
  async getPendingCount(): Promise<number> {
    const queue = await this.getPendingQueue();
    return queue.transactions.length;
  }

  // ============================================
  // 并发锁管理（processing 标志）
  // ============================================

  /**
   * 尝试获取处理锁
   * 关键：防止并发双花
   */
  async acquireProcessingLock(): Promise<{ success: boolean; queue?: PendingQueue; error?: string }> {
    return this.state.storage.transaction(async (txn) => {
      const stored = await txn.get<ConsensusCoordinatorState>('state');
      const queue = stored?.pendingQueue || createInitialPendingQueue();

      // 检查是否已有处理中
      if (queue.processing) {
        // 检查是否超时（防止死锁）
        if (queue.processingStartedAt) {
          const elapsed = Date.now() - queue.processingStartedAt;
          if (elapsed < this.consensusConfig.consensusTimeoutMs) {
            return { success: false, error: 'Processing in progress' };
          }
          // 超时，重置锁
        }
      }

      // 检查队列是否有交易
      if (queue.transactions.length === 0) {
        return { success: false, error: 'No pending transactions' };
      }

      // 获取锁
      queue.processing = true;
      queue.processingStartedAt = Date.now();
      queue.lastUpdated = Date.now();

      const newState: ConsensusCoordinatorState = {
        ...stored!,
        pendingQueue: queue,
      };

      await txn.put('state', newState);

      // 更新本地缓存
      this.pendingQueue = queue;

      return { success: true, queue };
    });
  }

  /**
   * 释放处理锁
   */
  async releaseProcessingLock(clearQueue: boolean = false): Promise<void> {
    await this.state.storage.transaction(async (txn) => {
      const stored = await txn.get<ConsensusCoordinatorState>('state');
      const queue = stored?.pendingQueue || createInitialPendingQueue();

      queue.processing = false;
      queue.processingStartedAt = undefined;
      queue.currentBlock = undefined;

      if (clearQueue) {
        queue.transactions = [];
      }

      queue.lastUpdated = Date.now();

      const newState: ConsensusCoordinatorState = {
        ...stored!,
        pendingQueue: queue,
      };

      await txn.put('state', newState);

      // 更新本地缓存
      this.pendingQueue = queue;
    });
  }

  // ============================================
  // 区块原子提交（核心）
  // ============================================

  /**
   * 原子提交区块
   * 关键：所有状态变更必须在一个事务中完成
   */
  async commitBlock(block: Block, votes: ValidatorVote[]): Promise<{ success: boolean; error?: string }> {
    return this.state.storage.transaction(async (txn) => {
      // 重新加载最新状态
      const stored = await txn.get<ConsensusCoordinatorState>('state');
      const worldState = stored?.worldState || createInitialWorldState();
      const queue = stored?.pendingQueue || createInitialPendingQueue();

      // 验证区块高度
      if (block.header.height !== worldState.latestBlockHeight + 1) {
        return {
          success: false,
          error: `Invalid block height. Expected: ${worldState.latestBlockHeight + 1}, got: ${block.header.height}`
        };
      }

      // 验证前一区块哈希
      if (block.header.prevHash !== worldState.latestBlockHash) {
        return { success: false, error: 'Invalid previous block hash' };
      }

      // 验证签名数（2/3）
      const validVotes: ValidatorVote[] = [];
      const knownValidators = new Set(this.consensusConfig.validators); // 存储公钥

      for (const vote of votes) {
        // 1. 检查验证者是否在允许列表中
        // 注意：这里假设 vote.validatorPubKey 是公钥，且 config.validators 也是公钥列表
        // 如果 config 中存的是 ID，则需要映射；根据 types.ts 注释，这里是公钥
        if (!knownValidators.has(vote.validatorPubKey)) {
          console.warn(`[Consensus] Unknown validator vote: ${vote.validatorPubKey}`);
          continue;
        }

        // 2. 验证签名
        const isValid = await verifyBlockSignature(block.hash, vote.signature, vote.validatorPubKey);
        if (isValid) {
          validVotes.push(vote);
        } else {
          console.warn(`[Consensus] Invalid signature from validator: ${vote.validatorId}`);
        }
      }

      if (validVotes.length < this.consensusConfig.requiredSignatures) {
        return {
          success: false,
          error: `Insufficient valid signatures. Required: ${this.consensusConfig.requiredSignatures}, got: ${validVotes.length}`
        };
      }

      // 执行交易，更新状态
      const executedTxs: Transaction[] = [];
      const newBalances = { ...worldState.balances };
      const newNonces = { ...worldState.nonces };

      for (const tx of block.transactions) {
        // 再次验证 nonce
        const currentNonce = newNonces[tx.from] || 0;
        if (tx.nonce !== currentNonce) {
          // 跳过无效交易（不应发生）
          continue;
        }

        // 再次验证余额
        const fromBalance = newBalances[tx.from] || BigInt(0);
        if (fromBalance < tx.amount) {
          // 跳过无效交易
          continue;
        }

        // 执行转账
        newBalances[tx.from] = fromBalance - tx.amount;
        newBalances[tx.to] = (newBalances[tx.to] || BigInt(0)) + tx.amount;

        // 更新 nonce
        newNonces[tx.from] = currentNonce + 1;

        executedTxs.push(tx);
      }

      // 更新世界状态
      const newWorldState: WorldState = {
        balances: newBalances,
        nonces: newNonces,
        latestBlockHeight: block.header.height,
        latestBlockHash: block.hash,
        genesisHash: worldState.genesisHash,
        totalTransactions: worldState.totalTransactions + executedTxs.length,
        lastUpdated: Date.now(),
      };

      // 更新区块历史
      const newBlockHistory = { ...stored?.blockHistory, [block.header.height]: block };

      // 清空已处理的交易
      const processedHashes = new Set(executedTxs.map(tx => tx.hash));
      const remainingTxs = queue.transactions.filter(tx => !processedHashes.has(tx.hash));

      const newQueue: PendingQueue = {
        transactions: remainingTxs,
        lastUpdated: Date.now(),
        processing: false,
        processingStartedAt: undefined,
        currentBlock: undefined,
      };

      // 保存新状态
      const newState: ConsensusCoordinatorState = {
        worldState: newWorldState,
        pendingQueue: newQueue,
        blockHistory: newBlockHistory,
        consensusConfig: stored?.consensusConfig || this.consensusConfig,
      };

      await txn.put('state', newState);

      // 更新本地缓存
      this.worldState = newWorldState;
      this.pendingQueue = newQueue;
      this.blockHistory.set(block.header.height, block);

      // 取消 Alarm（如果设置了）
      await this.state.storage.deleteAlarm();

      return { success: true };
    });
  }

  // ============================================
  // Alarm 兜底机制
  // ============================================

  /**
   * 设置 Alarm（兜底超时）
   */
  async setAlarm(timeoutMs?: number): Promise<void> {
    const delay = timeoutMs || this.consensusConfig.alarmTimeoutMs;
    const alarmTime = Date.now() + delay;
    await this.state.storage.setAlarm(alarmTime);
  }

  /**
   * 取消 Alarm
   */
  async cancelAlarm(): Promise<void> {
    await this.state.storage.deleteAlarm();
  }

  /**
   * Alarm 回调处理
   * 关键：兜底机制，防止交易卡死
   */
  async alarm(): Promise<void> {
    console.log('[ConsensusCoordinator] Alarm triggered - forcing block commit');

    const queue = await this.getPendingQueue();

    // 检查是否有卡死的交易
    if (queue.processing && queue.transactions.length > 0) {
      // 重置锁，让新的提议可以尝试
      await this.releaseProcessingLock(false);

      // 触发新的提议（通过 HTTP 唤醒 Proposer）
      // 这里返回一个标记，由 fetch 处理
    }

    // 如果有待处理交易但未在处理中，尝试打包
    if (!queue.processing && queue.transactions.length > 0) {
      // 返回标记，由 fetch 处理唤醒
    }
  }

  // ============================================
  // 区块打包（Proposer 调用）
  // ============================================

  /**
   * 打包区块
   * 返回待共识的区块（未签名）
   */
  async packBlock(proposerId: string): Promise<{ success: boolean; block?: Block; error?: string }> {
    return this.state.storage.transaction(async (txn) => {
      const stored = await txn.get<ConsensusCoordinatorState>('state');
      const worldState = stored?.worldState || createInitialWorldState();
      const queue = stored?.pendingQueue || createInitialPendingQueue();

      // 检查队列
      if (queue.transactions.length === 0) {
        return { success: false, error: 'No pending transactions' };
      }

      // 批量打包（1-20 笔）
      const maxTxs = this.consensusConfig.blockMaxTxs;
      const txsToPack = queue.transactions.slice(0, maxTxs);

      // 计算交易根
      const txHashes = await Promise.all(txsToPack.map(async tx => {
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
      const txRoot = await computeMerkleRoot(txHashes);

      // 计算新的状态根（简化：直接哈希状态）
      const stateRoot = await this.computeStateRoot(worldState, txsToPack);

      // 构建区块头
      const header = {
        height: worldState.latestBlockHeight + 1,
        timestamp: Date.now(),
        prevHash: worldState.latestBlockHash,
        txRoot,
        stateRoot,
        proposer: proposerId,
        txCount: txsToPack.length,
      };

      // 计算区块哈希
      const blockHash = await hashBlock(header);

      // 构建区块（未签名）
      const block: Block = {
        header,
        transactions: txsToPack,
        hash: blockHash,
        proposerSignature: '', // 待签名
        votes: [],
      };

      // 更新队列状态（标记正在处理）
      queue.processing = true;
      queue.processingStartedAt = Date.now();
      queue.currentBlock = block;

      const newState: ConsensusCoordinatorState = {
        ...stored!,
        pendingQueue: queue,
      };

      await txn.put('state', newState);

      // 更新本地缓存
      this.pendingQueue = queue;

      // 设置 Alarm 兜底
      await this.setAlarm();

      return { success: true, block };
    });
  }

  /**
   * 计算状态根
   */
  private async computeStateRoot(
    worldState: WorldState,
    txs: Transaction[]
  ): Promise<BlockHash> {
    // 模拟执行交易，计算新状态
    const newBalances = { ...worldState.balances };
    const newNonces = { ...worldState.nonces };

    for (const tx of txs) {
      const fromBalance = newBalances[tx.from] || BigInt(0);
      if (fromBalance >= tx.amount) {
        newBalances[tx.from] = fromBalance - tx.amount;
        newBalances[tx.to] = (newBalances[tx.to] || BigInt(0)) + tx.amount;
        newNonces[tx.from] = (newNonces[tx.from] || 0) + 1;
      }
    }

    // 哈希状态
    // 哈希状态
    const stateData = {
      balances: Object.entries(newBalances).map(([k, v]) => [k, v.toString()]),
      nonces: newNonces,
    };

    return sha256Hex(objectToBytes(stateData));
  }

  // ============================================
  // 状态查询
  // ============================================

  /**
   * 查询完整状态
   */
  async queryState(): Promise<StateQueryResponse> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const worldState = stored?.worldState || createInitialWorldState();
    const queue = stored?.pendingQueue || createInitialPendingQueue();

    // Key: BigInt serialization fix
    const worldStateStrings = {
      ...worldState,
      balances: Object.fromEntries(
        Object.entries(worldState.balances).map(([k, v]) => [k, v.toString()])
      ),
    } as any;

    return {
      worldState: worldStateStrings,
      pendingCount: queue.transactions.length,
      processing: queue.processing,
      consensusState: queue.processing ? ConsensusState.VOTING : ConsensusState.IDLE,
      validators: this.consensusConfig.validators,
    };
  }

  /**
   * 查询账户
   */
  async queryAccount(address: Address): Promise<{ balance: bigint; nonce: number }> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const worldState = stored?.worldState || createInitialWorldState();

    return {
      balance: worldState.balances[address] || BigInt(0),
      nonce: worldState.nonces[address] || 0,
    };
  }

  /**
   * 查询区块
   */
  async queryBlock(height: number): Promise<BlockQueryResponse> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const worldState = stored?.worldState || createInitialWorldState();
    const blockHistory = stored?.blockHistory || {};

    const block = blockHistory[height];

    if (!block) {
      return { confirmations: 0 };
    }

    const confirmations = worldState.latestBlockHeight - height + 1;

    return {
      block,
      lightBlock: {
        height: block.header.height,
        hash: block.hash,
        timestamp: block.header.timestamp,
        txCount: block.header.txCount,
        prevHash: block.header.prevHash,
        stateRoot: block.header.stateRoot,
      },
      confirmations,
    };
  }

  /**
   * 查询最新区块
   */
  async queryLatestBlock(): Promise<{ height: number; hash: HexString; timestamp: number }> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const worldState = stored?.worldState || createInitialWorldState();

    return {
      height: worldState.latestBlockHeight,
      hash: worldState.latestBlockHash,
      timestamp: worldState.lastUpdated,
    };
  }

  /**
   * 查询交易
   */
  async queryTransaction(txHash: HexString): Promise<TransactionReceipt | null> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const blockHistory = stored?.blockHistory || {};
    const queue = stored?.pendingQueue || createInitialPendingQueue();

    // 在区块历史中查找
    for (const block of Object.values(blockHistory)) {
      const tx = block.transactions.find(t => t.hash === txHash);
      if (tx) {
        return {
          transaction: tx,
          status: TransactionStatus.CONFIRMED,
          blockHeight: block.header.height,
          blockHash: block.hash,
          confirmationTime: block.header.timestamp,
        };
      }
    }

    // 在 Pending Queue 中查找
    const pendingTx = queue.transactions.find(t => t.hash === txHash);
    if (pendingTx) {
      return {
        transaction: pendingTx,
        status: queue.processing ? TransactionStatus.PROCESSING : TransactionStatus.PENDING,
      };
    }

    return null;
  }

  // ============================================
  // 配置管理
  // ============================================

  /**
   * 更新共识配置
   */
  async updateConfig(config: Partial<ConsensusConfig>): Promise<void> {
    await this.state.storage.transaction(async (txn) => {
      const stored = await txn.get<ConsensusCoordinatorState>('state');

      const newConfig = {
        ...(stored?.consensusConfig || this.consensusConfig),
        ...config,
      };

      const newState: ConsensusCoordinatorState = {
        ...(stored || {
          worldState: createInitialWorldState(),
          pendingQueue: createInitialPendingQueue(),
          blockHistory: {},
          consensusConfig: DEFAULT_CONSENSUS_CONFIG,
        }),
        consensusConfig: newConfig,
      };

      await txn.put('state', newState);

      this.consensusConfig = newConfig;
    });
  }

  // ============================================
  // HTTP 接口
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 交易提交（内部接口，由 API Worker 调用）
      if (path === '/internal/add-tx' && request.method === 'POST') {
        const tx = await request.json() as any;
        // BigInt 还原
        tx.amount = BigInt(tx.amount || '0');
        tx.gasPrice = BigInt(tx.gasPrice || '0');
        tx.gasLimit = BigInt(tx.gasLimit || '0');

        const result = await this.addTransaction(tx);
        return safeJsonResponse(result);
      }

      // 获取队列（Proposer 调用）
      if (path === '/internal/queue' && request.method === 'GET') {
        const queue = await this.getPendingQueue();
        return safeJsonResponse({
          count: queue.transactions.length,
          processing: queue.processing,
          transactions: queue.transactions,
        });
      }

      // 获取锁（Proposer 调用）
      if (path === '/internal/acquire-lock' && request.method === 'POST') {
        const result = await this.acquireProcessingLock();
        return safeJsonResponse(result);
      }

      // 释放锁（Proposer 调用）
      if (path === '/internal/release-lock' && request.method === 'POST') {
        const { clearQueue } = await request.json() as { clearQueue?: boolean };
        await this.releaseProcessingLock(clearQueue);
        return safeJsonResponse({ success: true });
      }

      // 处理初始化请求
      if (url.pathname === '/internal/init-genesis' && request.method === 'POST') {
        const result = await this.initGenesis();
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 打包区块（Proposer 调用）
      if (path === '/internal/pack-block' && request.method === 'POST') {
        const { proposerId } = await request.json() as { proposerId: string };
        const result = await this.packBlock(proposerId);
        return safeJsonResponse(result);
      }

      // 提交区块（Proposer 调用）
      if (path === '/internal/commit-block' && request.method === 'POST') {
        const { block, votes } = await request.json() as { block: any; votes: ValidatorVote[] };

        // BigInt 还原
        if (block && block.transactions) {
          block.transactions = block.transactions.map((tx: any) => ({
            ...tx,
            amount: BigInt(tx.amount || '0'),
            gasPrice: BigInt(tx.gasPrice || '0'),
            gasLimit: BigInt(tx.gasLimit || '0')
          }));
        }

        const result = await this.commitBlock(block, votes);
        return safeJsonResponse(result);
      }

      // 查询状态
      if (path === '/state' && request.method === 'GET') {
        const state = await this.queryState();
        return safeJsonResponse(state);
      }

      // 查询账户
      if (path.startsWith('/account/') && request.method === 'GET') {
        const address = path.split('/')[2];
        const account = await this.queryAccount(address);
        return safeJsonResponse({
          address,
          balance: account.balance.toString(),
          nonce: account.nonce,
        });
      }

      // 查询区块
      if (path.startsWith('/block/') && request.method === 'GET') {
        const height = parseInt(path.split('/')[2]);
        const block = await this.queryBlock(height);
        return safeJsonResponse(block);
      }

      // 查询最新区块
      if (path === '/block/latest' && request.method === 'GET') {
        const latest = await this.queryLatestBlock();
        return safeJsonResponse(latest);
      }

      // 查询交易
      if (path.startsWith('/tx/') && request.method === 'GET') {
        const txHash = path.split('/')[2];
        const receipt = await this.queryTransaction(txHash);
        return safeJsonResponse(receipt || { error: 'Transaction not found' });
      }

      // Alarm 触发（内部）
      if (path === '/internal/alarm' && request.method === 'POST') {
        await this.alarm();
        return safeJsonResponse({ success: true });
      }

      // 错误上报
      if (path === '/internal/report-error' && request.method === 'POST') {
        const { error } = await request.json() as { error: string };
        await this.state.storage.transaction(async (txn) => {
          const stored = await txn.get<ConsensusCoordinatorState>('state');
          if (stored) {
            stored.worldState.lastProposerError = error;
            await txn.put('state', stored);
            this.worldState = stored.worldState;
          }
        });
        return safeJsonResponse({ success: true });
      }

      return safeJsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('[ConsensusCoordinator] Error:', error);
      return safeJsonResponse({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }
}

/**
 * BigInt 安全的 JSON 响应
 */
function safeJsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ============================================
// Durable Object 导出
// ============================================

export default {
  async fetch(request: Request, env: { CONSENSUS_COORDINATOR: DurableObjectNamespace }): Promise<Response> {
    const id = env.CONSENSUS_COORDINATOR.idFromName('consensus-coordinator');
    const stub = env.CONSENSUS_COORDINATOR.get(id);
    return stub.fetch(request);
  },
};
