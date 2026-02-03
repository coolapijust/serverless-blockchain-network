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
  ApiEnv,
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
  private lastBackupTime: number = 0;

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
      this.consensusConfig = stored.consensusConfig || DEFAULT_CONSENSUS_CONFIG;
      this.lastBackupTime = stored.lastBackupTime || 0;
      this.blockHistory = new Map(
        Object.entries(stored.blockHistory).map(([h, b]) => [Number(h), b])
      );
    } else {
      console.log('[ConsensusCoordinator] No stored state found, initializing from Genesis...');
      this.worldState = createInitialWorldState();
      this.pendingQueue = createInitialPendingQueue();
      this.lastBackupTime = 0;
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
      lastBackupTime: this.lastBackupTime,
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
  async initGenesis(genesisTime?: number, force: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[ConsensusCoordinator] Initializing genesis...');

      // 安全检查：如果区块高度已经大于 0，禁止普通重置。除非显式使用 force 参数。
      if (this.worldState && this.worldState.latestBlockHeight > 0 && !force) {
        console.warn('[ConsensusCoordinator] Block height > 0, initialization rejected without force.');
        return { success: false, error: 'Blockchain already initialized. Use force=true to override.' };
      }

      const config = {
        ...DEFAULT_GENESIS_CONFIG,
        genesisTime: genesisTime || DEFAULT_GENESIS_CONFIG.genesisTime
      };

      const genesisBlock = await generateGenesisBlock(config);
      const initialState = generateInitialWorldState(config);

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

      // --- 智能备份触发 [NEW] ---
      const now = Date.now();
      const backupInterval = 3600000; // 1 小时
      if (now - this.lastBackupTime > backupInterval) {
        console.log('[Consensus] Triggering opportunistic backup...');
        this.state.waitUntil(this.performBackup());
      }

      // 设置收尾闹钟 (1.5 小时后)，确保空闲状态也被备份
      await this.state.storage.setAlarm(now + backupInterval * 1.5);

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
   * 采用混合策略：收尾备份 + 锁重置
   */
  async alarm(): Promise<void> {
    console.log('[ConsensusCoordinator] Alarm triggered...');

    const now = Date.now();

    // 1. 检查是否需要收尾备份 (Idle Backup)
    if (now - this.lastBackupTime > 3600000) {
      console.log('[Consensus] Alarm: Triggering idle backup...');
      this.state.waitUntil(this.performBackup());
    }

    // 2. 释放可能卡住的处理锁 (Existing logic)
    if (this.pendingQueue && this.pendingQueue.processing) {
      console.warn('[ConsensusCoordinator] Processing timeout, releasing lock via alarm');
      await this.releaseProcessingLock(false); // 不清空队列，允许重试
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
   * 查询账户交易历史 [NEW]
   * 遍历区块历史和 Pending Queue (MVP 简化实现)
   */
  async getTransactionsByAddress(address: Address): Promise<TransactionReceipt[]> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const blockHistory = stored?.blockHistory || {};
    const queue = stored?.pendingQueue || createInitialPendingQueue();
    const cleanAddr = address.toLowerCase();

    const history: TransactionReceipt[] = [];

    // 1. 遍历区块历史 (倒序: 最新的在前)
    // 注意：这将随着区块增加而变慢，生产环境需要专门的索引
    const sortedHeights = Object.keys(blockHistory).map(Number).sort((a, b) => b - a);

    for (const height of sortedHeights) {
      const block = blockHistory[height];
      for (const tx of block.transactions) {
        if (tx.from === cleanAddr || tx.to === cleanAddr) {
          history.push({
            transaction: tx,
            status: TransactionStatus.CONFIRMED,
            blockHeight: block.header.height,
            blockHash: block.hash,
            confirmationTime: block.header.timestamp,
          });
        }
      }
    }

    // 2. 遍历 Pending Queue
    for (const tx of queue.transactions) {
      if (tx.from === cleanAddr || tx.to === cleanAddr) {
        // 避免重复 (理论上 Pending 不会在 History 中，但 defensive 一点)
        if (!history.find(h => h.transaction.hash === tx.hash)) {
          history.unshift({ // Pending 的放最前面
            transaction: tx,
            status: queue.processing ? TransactionStatus.PROCESSING : TransactionStatus.PENDING,
          });
        }
      }
    }

    return history;
  }

  /**
   * 批量查询区块
   */
  async queryBlocksRange(start: number, limit: number): Promise<Block[]> {
    const stored = await this.state.storage.get<ConsensusCoordinatorState>('state');
    const blockHistory = stored?.blockHistory || {};

    const blocks: Block[] = [];
    // 确保从 start 开始向下取 limit 个区块
    // 如果 start 为 100, limit 为 10，则取 100, 99, ..., 91
    const end = Math.max(0, start - limit + 1);

    for (let h = start; h >= end; h--) {
      const block = blockHistory[h];
      if (block) {
        blocks.push(block);
      }
    }

    return blocks;
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
        const body = await request.json().catch(() => ({})) as { genesisTime?: number; force?: boolean };
        const result = await this.initGenesis(body.genesisTime, body.force);
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

      // 查询账户交易历史 [NEW]
      if (path.startsWith('/account/') && path.endsWith('/txs') && request.method === 'GET') {
        const parts = path.split('/'); // /account/:address/txs
        const address = parts[2];
        const history = await this.getTransactionsByAddress(address);
        return safeJsonResponse({ transactions: history });
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

      // 批量查询区块
      if (path === '/blocks' && request.method === 'GET') {
        const start = parseInt(url.searchParams.get('start') || '0');
        const limit = parseInt(url.searchParams.get('limit') || '10');
        const blocks = await this.queryBlocksRange(start, limit);
        return safeJsonResponse({ blocks });
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

      // --- 备份相关接口 [NEW] ---

      // 获取备份列表
      if (path === '/internal/backup-list' && request.method === 'GET') {
        const indexStr = await this.apiEnv.CONFIG_KV.get('backup_index');
        const index = JSON.parse(indexStr || '[]');
        return safeJsonResponse({ backups: index });
      }


      // 手动触发备份
      if (path === '/internal/trigger-backup' && request.method === 'POST') {
        const result = await this.performBackup();
        return safeJsonResponse(result);
      }

      // 恢复状态
      if (path === '/internal/restore' && request.method === 'POST') {
        const { state, cid, force } = await request.json() as { state: any; cid: string; force?: boolean };

        // 1. 安全检查：必须提供 CID
        if (!cid) {
          return safeJsonResponse({ success: false, error: 'CID is required for verification' }, 400);
        }

        // 2. 验证 CID 是否为已记录的最新的备份
        const indexStr = await this.apiEnv.CONFIG_KV.get('backup_index');
        const index = JSON.parse(indexStr || '[]') as Array<{ cid: string, height: number, timestamp: number }>;

        if (index.length === 0) {
          return safeJsonResponse({ success: false, error: 'No backup records found in index' }, 400);
        }

        if (index[0].cid !== cid) {
          return safeJsonResponse({
            success: false,
            error: `CID mismatch. Provided: ${cid}, Latest recorded: ${index[0].cid}`
          }, 403);
        }

        // 3. 链状态检查
        if (this.worldState && this.worldState.latestBlockHeight > 0 && !force) {
          return safeJsonResponse({ success: false, error: 'Cannot restore to a live chain without force=true' }, 403);
        }

        // 4. BigInt 还原并应用
        const restoredState = this.restoreBigInts(state);

        await this.state.storage.put('state', restoredState);

        // 更新内存
        this.worldState = restoredState.worldState;
        this.pendingQueue = restoredState.pendingQueue;
        this.lastBackupTime = restoredState.lastBackupTime || 0;
        this.blockHistory = new Map(
          Object.entries(restoredState.blockHistory).map(([h, b]) => [Number(h), b as Block])
        );

        return safeJsonResponse({ success: true, message: 'State restored successfully' });
      }

      return safeJsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('[ConsensusCoordinator] Error:', error);
      return safeJsonResponse({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  }

  // ============================================
  // 备份与恢复辅助函数 [NEW]
  // ============================================

  private get apiEnv(): ApiEnv {
    return this.env as ApiEnv;
  }

  /**
   * 执行自动化备份
   */
  private async performBackup(): Promise<{ success: boolean; cid?: string; error?: string; height?: number }> {
    const now = Date.now();
    console.log(`[Consensus] Starting backup at ${new Date(now).toISOString()}...`);

    try {
      const state = await this.state.storage.get<ConsensusCoordinatorState>('state');
      if (!state) return { success: false, error: 'State not found in storage' };

      const jsonData = JSON.stringify(state, (k, v) => typeof v === 'bigint' ? v.toString() : v);

      // 1. 加密
      const encryptionKey = this.apiEnv.BACKUP_ENCRYPTION_KEY;
      let encryptedData: ArrayBuffer | Uint8Array;
      let iv: Uint8Array;

      if (encryptionKey) {
        console.log(`[Consensus] Encrypting backup data (len: ${jsonData.length})...`);
        const result = await this.encryptData(jsonData, encryptionKey);
        encryptedData = result.encrypted;
        iv = result.iv;
      } else {
        console.warn('[Consensus] No BACKUP_ENCRYPTION_KEY set, uploading unencrypted (Not recommended)');
        encryptedData = new TextEncoder().encode(jsonData);
        iv = new Uint8Array(0);
      }

      // 2. 上传到 Pinata
      const jwt = this.apiEnv.PINATA_JWT;
      if (!jwt) {
        console.error('[Consensus] PINATA_JWT not found, backup aborted');
        return { success: false, error: 'PINATA_JWT missing in env' };
      }

      const uploadResult = await this.uploadToPinata(iv, encryptedData, state.worldState.latestBlockHeight, jwt);
      if (!uploadResult.success) {
        return { success: false, error: `Pinata upload failed: ${uploadResult.error}` };
      }

      const cid = uploadResult.cid!;

      // 3. 更新状态
      this.lastBackupTime = now;
      await this.state.storage.put('lastBackupTime', now);

      state.lastBackupTime = now;
      await this.state.storage.put('state', state);

      // 4. 更新索引并清理 (TTL=10)
      console.log(`[Consensus] Updating backup index in KV with CID: ${cid}...`);
      await this.updateBackupIndex(cid, state.worldState.latestBlockHeight, now, jwt);

      console.log(`[Consensus] Backup complete. CID: ${cid}`);
      return { success: true, cid, height: state.worldState.latestBlockHeight };
    } catch (error: any) {
      console.error('[Consensus] Backup process failed:', error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * AES-GCM 加密
   */
  private async encryptData(data: string, hexKey: string): Promise<{ encrypted: ArrayBuffer, iv: Uint8Array }> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // 将 16 进制密钥转为 CryptoKey
    const keyBuf = new Uint8Array(hexKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuf,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );

    return { encrypted, iv };
  }

  /**
 * 上传二进制到 Pinata
 */
  private async uploadToPinata(iv: Uint8Array, data: ArrayBuffer | Uint8Array, height: number, jwt: string): Promise<{ success: boolean; cid?: string; error?: string }> {
    const formData = new FormData();

    // 组合 IV + 密文
    const combined = new Uint8Array(iv.length + data.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(data), iv.length);

    formData.append('file', new Blob([combined]), `backup-block-${height}.bin`);

    const metadata = JSON.stringify({
      name: `Blockchain-Backup-H${height}`,
      keyvalues: {
        app: 'blockchain-mvp',
        height: height.toString(),
        timestamp: Date.now().toString()
      }
    });
    formData.append('pinataMetadata', metadata);

    try {
      const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}` },
        body: formData
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[Pinata] Upload failed: ${response.status} ${err}`);
        return { success: false, error: `${response.status} ${err}` };
      }

      const result = await response.json() as { IpfsHash: string };
      return { success: true, cid: result.IpfsHash };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 更新备份索引并清理旧数据 (TTL=10)
   */
  private async updateBackupIndex(cid: string, height: number, timestamp: number, jwt: string): Promise<void> {
    const kv = this.apiEnv.CONFIG_KV;
    const indexStr = await kv.get('backup_index');
    let index = JSON.parse(indexStr || '[]') as Array<{ cid: string, height: number, timestamp: number }>;

    // 添加新记录
    index.unshift({ cid, height, timestamp });

    // 如果超过 10 条，清理最旧的
    if (index.length > 10) {
      const toDelete = index.slice(10);
      index = index.slice(0, 10);

      // 异步执行 Unpin
      for (const item of toDelete) {
        this.state.waitUntil(this.unpinFromPinata(item.cid, jwt));
      }
    }

    await kv.put('backup_index', JSON.stringify(index));
  }

  /**
   * 从 Pinata 中物理删除 (Unpin)
   */
  private async unpinFromPinata(cid: string, jwt: string): Promise<void> {
    console.log(`[Pinata] Unpinning old backup: ${cid}...`);
    const response = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${jwt}` }
    });

    if (!response.ok) {
      console.warn(`[Pinata] Unpin failed for ${cid}: ${response.status}`);
    } else {
      console.log(`[Pinata] Unpin successful: ${cid}`);
    }
  }

  /**
   * 还原状态中的 BigInt 字段
   */
  private restoreBigInts(state: any): ConsensusCoordinatorState {
    if (state.worldState && state.worldState.balances) {
      for (const addr in state.worldState.balances) {
        state.worldState.balances[addr] = BigInt(state.worldState.balances[addr]);
      }
    }

    if (state.pendingQueue && state.pendingQueue.transactions) {
      state.pendingQueue.transactions = state.pendingQueue.transactions.map((tx: any) => ({
        ...tx,
        amount: BigInt(tx.amount || '0'),
        gasPrice: BigInt(tx.gasPrice || '0'),
        gasLimit: BigInt(tx.gasLimit || '0')
      }));
    }

    if (state.blockHistory) {
      for (const h in state.blockHistory) {
        const block = state.blockHistory[h];
        if (block.transactions) {
          block.transactions = block.transactions.map((tx: any) => ({
            ...tx,
            amount: BigInt(tx.amount || '0'),
            gasPrice: BigInt(tx.gasPrice || '0'),
            gasLimit: BigInt(tx.gasLimit || '0')
          }));
        }
      }
    }

    return state as ConsensusCoordinatorState;
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
