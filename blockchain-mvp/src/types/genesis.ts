/**
 * ============================================
 * Genesis Types
 * ============================================
 */

import type { Address, HexString } from './base';

/**
 * 创世配置
 */
export interface GenesisConfig {
  /** 链 ID */
  chainId: string;

  /** 网络 ID */
  networkId: string;

  /** 创世时间（Unix 毫秒） */
  genesisTime: number;

  /** 代币名称 */
  tokenName: string;

  /** 代币符号 */
  tokenSymbol: string;

  /** 代币精度 */
  tokenDecimals: number;

  /** 初始供应量（最小单位） */
  initialSupply: string;

  /** 预挖分配 */
  premine: PremineAllocation[];

  /** 区块时间（毫秒） */
  blockTime: number;

  /** 区块奖励（最小单位） */
  blockReward: string;

  /** 减半间隔（区块数） */
  halvingInterval: number;

  /** 创世验证者 */
  validators: GenesisValidator[];

  /** 最低 Gas 价格 */
  minGasPrice: string;

  /** 最大 Gas 限制 */
  maxGasLimit: string;

  /** 治理参数 */
  governance: GovernanceConfig;
}

/**
 * 预挖分配
 */
export interface PremineAllocation {
  /** 接收地址 */
  address: Address;

  /** 分配数量（最小单位） */
  amount: string;

  /** 描述 */
  description: string;

  /** 锁仓月数（0表示立即释放） */
  vestingMonths: number;
}

/**
 * 创世验证者
 */
export interface GenesisValidator {
  /** 节点 ID */
  id: string;

  /** 公钥 */
  publicKey: HexString;

  /** 地址 */
  address: Address;

  /** 质押数量 */
  stake: string;

  /** 佣金比例（%） */
  commission: number;
}

/**
 * 治理配置
 */
export interface GovernanceConfig {
  /** 提案门槛（最小单位） */
  proposalThreshold: string;

  /** 投票周期（毫秒） */
  votingPeriod: number;

  /** 执行延迟（毫秒） */
  executionDelay: number;
}

/**
 * 代币信息
 */
export interface TokenInfo {
  /** 代币名称 */
  name: string;

  /** 代币符号 */
  symbol: string;

  /** 精度 */
  decimals: number;

  /** 总供应量 */
  totalSupply: string;

  /** 流通供应量 */
  circulatingSupply: string;

  /** 创世区块 */
  genesisBlock: number;

  /** 创世交易哈希 */
  genesisTxHash: string;

  /** 当前区块奖励 */
  blockReward: string;

  /** 下次减半区块 */
  nextHalving: number;
}

/**
 * 质押信息
 */
export interface StakeInfo {
  /** 验证者地址 */
  validator: Address;

  /** 质押数量 */
  amount: string;

  /** 委托者数量 */
  delegators: number;

  /** 佣金比例 */
  commission: number;

  /** 总奖励 */
  totalRewards: string;
}

/**
 * 释放计划
 */
export interface VestingSchedule {
  /** 受益地址 */
  beneficiary: Address;

  /** 总数量 */
  totalAmount: string;

  /** 已释放数量 */
  releasedAmount: string;

  /** 开始时间 */
  startTime: number;

  /** 结束时间 */
  endTime: number;

  /** 释放周期（月） */
  cliffMonths: number;

  /** 线性释放月数 */
  vestingMonths: number;
}
