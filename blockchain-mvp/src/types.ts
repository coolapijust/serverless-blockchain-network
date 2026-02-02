/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * TypeScript 类型定义
 * ============================================
 * 
 * 核心设计原则：
 * 1. 所有状态变更必须通过 Durable Objects 原子事务
 * 2. 交易哈希使用 SHA-256，签名使用 Ed25519
 * 3. 区块高度从 0 开始，创世区块包含初始代币分配
 */

// 导出基础类型
export * from './types/base';
import type { HexString, Address, TxHash, BlockHash, Signature, Timestamp } from './types/base';

// 导出创世相关类型
export * from './types/genesis';

// ============================================
// 交易相关类型
// ============================================

/**
 * 交易结构
 * 遵循以太坊风格，但使用 Ed25519 签名
 */
export interface Transaction {
  /** 交易唯一标识（SHA-256 哈希） */
  hash: TxHash;

  /** 发送方地址（从签名恢复） */
  from: Address;

  /** 接收方地址 */
  to: Address;

  /** 转账金额（最小单位） */
  amount: bigint;

  /** 发送方 nonce，防重放攻击 */
  nonce: number;

  /** 发送方公钥 (Ed25519) */
  publicKey: HexString;

  /** 交易创建时间 */
  timestamp: Timestamp;

  /** Gas 价格（本 MVP 固定为 0） */
  gasPrice: bigint;

  /** Gas 限制（本 MVP 固定） */
  gasLimit: bigint;

  /** Ed25519 签名 */
  signature: Signature;

  /** 原始交易数据（用于验签） */
  data?: HexString;
}

/**
 * 提交交易的请求体
 */
export interface SubmitTransactionRequest {
  from: Address;
  to: Address;
  amount: string; // JSON 不支持 bigint，使用字符串
  nonce: number;
  timestamp: Timestamp;
  signature: Signature;
  publicKey: HexString;
}

/**
 * 交易提交响应
 */
export interface SubmitTransactionResponse {
  success: boolean;
  txHash?: TxHash;
  error?: string;
  blockHeight?: number;
  estimatedConfirmationTime?: number;
}

/**
 * 交易状态
 */
export enum TransactionStatus {
  PENDING = 'pending',     // 在队列中等待打包
  PROCESSING = 'processing', // 正在共识中
  CONFIRMED = 'confirmed',   // 已上链
  FAILED = 'failed',         // 执行失败
}

/**
 * 交易收据
 */
export interface TransactionReceipt {
  transaction: Transaction;
  status: TransactionStatus;
  blockHeight?: number;
  blockHash?: BlockHash;
  confirmationTime?: number;
  executionError?: string;
}

// ============================================
// 区块相关类型
// ============================================

/**
 * 区块头
 */
export interface BlockHeader {
  /** 区块高度 */
  height: number;

  /** 区块创建时间 */
  timestamp: Timestamp;

  /** 前一区块哈希 */
  prevHash: BlockHash;

  /** 交易默克尔根 */
  txRoot: BlockHash;

  /** 状态树根 */
  stateRoot: BlockHash;

  /** 提议者节点 ID */
  proposer: string;

  /** 交易数量 */
  txCount: number;
}

/**
 * 完整区块
 */
export interface Block {
  /** 区块头 */
  header: BlockHeader;

  /** 交易列表 */
  transactions: Transaction[];

  /** 区块哈希（头哈希） */
  hash: BlockHash;

  /** 提议者签名 */
  proposerSignature: Signature;

  /** 验证者投票（2/3 签名） */
  votes: ValidatorVote[];

  /** 共识达成时间 */
  consensusTime?: number;
}

/**
 * 验证者投票
 */
export interface ValidatorVote {
  /** 验证者节点 ID */
  validatorId: string;

  /** 验证者公钥 */
  validatorPubKey: HexString;

  /** 对区块哈希的签名 */
  signature: Signature;

  /** 投票时间 */
  timestamp: Timestamp;
}

/**
 * 轻量级区块（用于查询）
 */
export interface LightBlock {
  height: number;
  hash: BlockHash;
  timestamp: Timestamp;
  txCount: number;
  prevHash: BlockHash;
  stateRoot: BlockHash;
}

// ============================================
// 共识相关类型
// ============================================

/**
 * 共识状态
 */
export enum ConsensusState {
  IDLE = 'idle',           // 空闲，等待交易
  PROPOSING = 'proposing', // 正在提议区块
  VOTING = 'voting',       // 正在收集投票
  COMMITTING = 'committing', // 正在提交
}

/**
 * 验证请求
 */
export interface ValidateRequest {
  block: Block;
  proposerId: string;
}

/**
 * 验证响应
 */
export interface ValidateResponse {
  valid: boolean;
  validatorId: string;
  publicKey?: HexString; // Added publicKey
  signature?: Signature;
  error?: string;
  timestamp: Timestamp;
}

/**
 * 共识配置
 */
export interface ConsensusConfig {
  /** 区块最大交易数 */
  blockMaxTxs: number;

  /** 区块最小交易数 */
  blockMinTxs: number;

  /** 共识超时时间（毫秒） */
  consensusTimeoutMs: number;

  /** Alarm 兜底超时（毫秒） */
  alarmTimeoutMs: number;

  /** 验证者列表（公钥） */
  validators: string[];

  /** 所需签名数（2/3） */
  requiredSignatures: number;
}

// ============================================
// 世界状态类型
// ============================================

/**
 * 账户状态
 */
export interface AccountState {
  /** 余额 */
  balance: bigint;

  /** 已使用的 nonce */
  nonce: number;

  /** 最后更新时间 */
  lastUpdated: Timestamp;
}

/**
 * 世界状态（存储在 DO 中）
 */
export interface WorldState {
  /** 账户余额映射 */
  balances: Record<Address, bigint>;

  /** 账户 nonce 映射 */
  nonces: Record<Address, number>;

  /** 最新区块高度 */
  latestBlockHeight: number;

  /** 最新区块哈希 */
  latestBlockHash: BlockHash;

  /** 创世区块哈希 */
  genesisHash: BlockHash;

  /** 总交易数 */
  totalTransactions: number;

  /** 最后更新时间 */
  lastUpdated: Timestamp;

  /** 最后一次 Proposer 错误 */
  lastProposerError?: string;
}

/**
 * 待处理队列状态（DO 存储）
 */
export interface PendingQueue {
  /** 待处理交易列表（强一致） */
  transactions: Transaction[];

  /** 最后更新时间 */
  lastUpdated: Timestamp;

  /** 队列处理中标志（并发锁） */
  processing: boolean;

  /** 当前处理区块 */
  currentBlock?: Block;

  /** 处理开始时间 */
  processingStartedAt?: Timestamp;
}

// ============================================
// Durable Objects 类型
// ============================================

/**
 * ConsensusCoordinator 状态
 */
export interface ConsensusCoordinatorState {
  worldState: WorldState;
  pendingQueue: PendingQueue;
  blockHistory: Record<number, Block>;
  consensusConfig: ConsensusConfig;
}

/**
 * 状态查询响应
 */
export interface StateQueryResponse {
  worldState: WorldState;
  pendingCount: number;
  processing: boolean;
  consensusState: ConsensusState;
  validators: string[]; // Added validators (public keys)
}

/**
 * 区块查询响应
 */
export interface BlockQueryResponse {
  block?: Block;
  lightBlock?: LightBlock;
  confirmations: number;
}

// ============================================
// API 响应类型
// ============================================

/**
 * 标准 API 响应
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Timestamp;
  requestId: string;
}

/**
 * 网络状态响应
 */
export interface NetworkStatusResponse {
  networkId: string;
  chainId: string;
  latestBlockHeight: number;
  latestBlockHash: BlockHash;
  pendingTransactions: number;
  totalTransactions: number;
  validators: string[];
  uptime: number;
  lastUpdated?: number;
  lastError?: string;
}

/**
 * 账户查询响应
 */
export interface AccountQueryResponse {
  address: Address;
  balance: string;
  nonce: number;
  pendingNonce: number;
}

// ============================================
// 加密相关类型
// ============================================

/**
 * 密钥对
 */
export interface KeyPair {
  publicKey: HexString;
  privateKey: HexString;
}

/**
 * 签名数据
 */
export interface SignData {
  message: HexString;
  signature: Signature;
  publicKey: HexString;
}

/**
 * 节点配置
 */
export interface NodeConfig {
  nodeId: string;
  role: 'proposer' | 'validator';
  keyPair: KeyPair;
  peers: string[];
}

// ============================================
// 事件相关类型
// ============================================

/**
 * 区块事件
 */
export interface BlockEvent {
  type: 'block_proposed' | 'block_confirmed' | 'block_rejected';
  blockHeight: number;
  blockHash: BlockHash;
  timestamp: Timestamp;
  proposer: string;
  txCount: number;
}

/**
 * 交易事件
 */
export interface TransactionEvent {
  type: 'tx_submitted' | 'tx_pending' | 'tx_confirmed' | 'tx_failed';
  txHash: TxHash;
  from: Address;
  to: Address;
  amount: bigint;
  timestamp: Timestamp;
}

// ============================================
// 测试相关类型
// ============================================

/**
 * 测试场景
 */
export interface TestScenario {
  name: string;
  description: string;
  steps: TestStep[];
  expectedResult: string;
}

/**
 * 测试步骤
 */
export interface TestStep {
  action: string;
  params?: Record<string, unknown>;
  expected?: string;
}

/**
 * 测试结果
 */
export interface TestResult {
  scenario: string;
  passed: boolean;
  steps: { step: number; action: string; passed: boolean; error?: string }[];
  duration: number;
  error?: string;
}

// ============================================
// Worker 环境类型
// ============================================

/**
 * API Worker 环境变量
 */
export interface ApiEnv {
  CONSENSUS_COORDINATOR: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  NETWORK_ID: string;
  CHAIN_ID: string;
  PROPOSER_URL: string;
  FAUCET_KEY: string;
  PROPOSER_SERVICE?: Fetcher;
}

/**
 * Proposer Worker 环境变量
 */
export interface ProposerEnv {
  CONSENSUS_COORDINATOR: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  NODE_ROLE: string;
  NODE_ID: string;
  VALIDATOR_URLS: string;
  BLOCK_MAX_TXS: string;
  BLOCK_MIN_TXS: string;
  CONSENSUS_TIMEOUT_MS: string;
  ALARM_TIMEOUT_MS: string;
  PROPOSER_PRIVATE_KEY: string;
  VALIDATOR_1_SERVICE?: Fetcher;
  VALIDATOR_2_SERVICE?: Fetcher;
}

/**
 * Validator Worker 环境变量
 */
export interface ValidatorEnv {
  CONSENSUS_COORDINATOR: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  NODE_ROLE: string;
  NODE_ID: string;
  VALIDATOR_INDEX: string;
  VALIDATOR_PRIVATE_KEY: string;
}
