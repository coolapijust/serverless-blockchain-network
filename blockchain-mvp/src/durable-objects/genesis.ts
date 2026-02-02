/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * Genesis & Token Issuance Module
 * ============================================
 * 
 * 创世区块设计：
 * 1. 创世区块高度为 0，前一区块哈希为全 0
 * 2. 创世交易包含初始代币分配
 * 3. 验证者节点在创世时注册
 * 
 * 代币经济模型：
 * - 初始供应量： configurable
 * - 预挖分配：团队、生态基金、社区奖励
 * - 区块奖励：每区块产出（可配置减半周期）
 */

import type {
  Block,
  Transaction,
  WorldState,
  GenesisConfig,
  Address,
  HexString,
} from '../types';

import {
  hashBlock,
  hashTransaction,
  computeMerkleRoot,
  addHexPrefix,
  bytesToHex,
  publicKeyToAddress,
} from '../crypto';

// ============================================
// 创世配置
// ============================================

export const DEFAULT_GENESIS_CONFIG: GenesisConfig = {
  // 网络标识
  chainId: '1337',
  networkId: 'cloudflare-mvp-testnet',

  // 创世时间（Unix 毫秒）
  genesisTime: 1704067200000, // 2024-01-01 00:00:00 UTC

  // 代币配置
  tokenName: 'Cloudflare Token',
  tokenSymbol: 'CFT',
  tokenDecimals: 18,

  // 初始供应量：10,000,000 CFT
  initialSupply: '10000000000000000000000000',

  // 预挖分配（按地址）
  premine: [
    {
      address: '0x262ec0e5cbab9ed4680a756cd77515d97bfd5b07', // Node 0 / Faucet
      amount: '5000000000000000000000000', // 5M CFT
      description: 'Faucet & Proposer Pool',
      vestingMonths: 0,
    },
    {
      address: '0x90ce275b6ce31eafabc83f2dff9f193adb5e5807', // Node 1
      amount: '2000000000000000000000000', // 2M CFT
      description: 'Validator 1 Stake',
      vestingMonths: 0,
    },
    {
      address: '0x767a3a0946bf05158fe941fae7f913de5a922a30', // Node 2
      amount: '2000000000000000000000000', // 2M CFT
      description: 'Validator 2 Stake',
      vestingMonths: 0,
    },
    {
      address: '0x0123456789abcdef0123456789abcdef01234567',
      amount: '1000000000000000000000000', // 1M CFT
      description: 'Ecosystem',
      vestingMonths: 0,
    }
  ],

  // 共识参数
  blockTime: 3000, // 3秒出块
  blockReward: '0', // 用户指定：不再自动增发
  halvingInterval: 2100000, // ~2年减半（虽然奖励为0，保留参数防报错）

  // 验证者节点（创世验证者）
  validators: [
    {
      id: 'node-1',
      publicKey: '0x90ce275b6ce31eafabc83f2dff9f193adb5e5807d5aa7fc59a71c63e1e9c8365',
      address: '0x90ce275b6ce31eafabc83f2dff9f193adb5e5807',
      stake: '1000000000000000000000',
      commission: 10,
    },
    {
      id: 'node-2',
      publicKey: '0x767a3a0946bf05158fe941fae7f913de5a922a30809b85379ecb4d7169a6055e',
      address: '0x767a3a0946bf05158fe941fae7f913de5a922a30',
      stake: '1000000000000000000000',
      commission: 10,
    },
  ],

  // Gas 配置
  minGasPrice: '0',
  maxGasLimit: '10000000',

  // 治理参数
  governance: {
    proposalThreshold: '1000000000000000000000', // 1000 CFT
    votingPeriod: 86400000, // 24小时
    executionDelay: 172800000, // 48小时
  },
};

// ============================================
// 创世区块生成
// ============================================

/**
 * 生成创世交易
 */
export async function generateGenesisTransactions(
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  let nonce = 0;

  for (const allocation of config.premine) {
    const timestamp = config.genesisTime;

    // 创世交易使用特殊签名（全0）
    const tx: Transaction = {
      hash: '', // 稍后计算
      from: '0x0000000000000000000000000000000000000000', // 零地址表示创世
      to: allocation.address.toLowerCase(),
      amount: BigInt(allocation.amount),
      nonce: nonce++,
      timestamp,
      gasPrice: BigInt(0),
      gasLimit: BigInt(21000),
      signature: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      publicKey: '0x0000000000000000000000000000000000000000000000000000000000000000', // 占位
      data: `premine:${allocation.description}`,
    };

    // 计算交易哈希
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

    transactions.push(tx);
  }

  return transactions;
}

/**
 * 生成创世区块
 */
export async function generateGenesisBlock(
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): Promise<Block> {
  const genesisTxs = await generateGenesisTransactions(config);

  // 计算交易根
  const txHashes = genesisTxs.map(tx => tx.hash);
  const txRoot = await computeMerkleRoot(txHashes);

  // 计算初始状态根
  const initialState = generateInitialWorldState(config);
  const stateRoot = await computeStateRoot(initialState);

  // 创世区块头
  const header = {
    height: 0,
    timestamp: config.genesisTime,
    prevHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txRoot,
    stateRoot,
    proposer: 'genesis',
    txCount: genesisTxs.length,
  };

  // 计算区块哈希
  const blockHash = await hashBlock(header);

  return {
    header,
    transactions: genesisTxs,
    hash: blockHash,
    proposerSignature: '0x00',
    votes: [],
  };
}

// ============================================
// 初始世界状态
// ============================================

interface InitialState {
  balances: Record<Address, bigint>;
  nonces: Record<Address, number>;
  stakes: Record<Address, bigint>;
  validatorAddresses: string[];
  validatorPublicKeys: string[]; // Explicitly store public keys
}

/**
 * 生成初始世界状态
 */
export function generateInitialWorldState(
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): InitialState {
  const balances: Record<Address, bigint> = {};
  const nonces: Record<Address, number> = {};
  const stakes: Record<Address, bigint> = {};
  const validatorAddresses: string[] = [];
  const validatorPublicKeys: string[] = [];

  // 分配预挖代币
  for (const allocation of config.premine) {
    const address = allocation.address.toLowerCase();
    balances[address] = BigInt(allocation.amount);
    nonces[address] = 0;
  }

  // 注册验证者及其质押
  for (const validator of config.validators) {
    const address = validator.address.toLowerCase();
    validatorAddresses.push(address);
    validatorPublicKeys.push(validator.publicKey); // Ensure we collect public keys
    stakes[address] = BigInt(validator.stake);

    // 验证者地址如果没有预挖，则初始化为0
    if (!(address in balances)) {
      balances[address] = BigInt(0);
      nonces[address] = 0;
    }
  }

  return {
    balances,
    nonces,
    stakes,
    validatorAddresses,
    validatorPublicKeys,
  };
}

/**
 * 计算状态根
 */
async function computeStateRoot(state: InitialState): Promise<HexString> {
  const stateData = {
    balances: Object.entries(state.balances).map(([k, v]) => [k, v.toString()]),
    nonces: state.nonces,
    stakes: Object.entries(state.stakes).map(([k, v]) => [k, v.toString()]),
    validators: state.validatorAddresses, // Use addresses for state root
  };

  const { sha256Hex, objectToBytes } = await import('../crypto');
  return sha256Hex(objectToBytes(stateData));
}

// ============================================
// 区块奖励计算
// ============================================

/**
 * 计算指定高度的区块奖励
 */
export function calculateBlockReward(
  blockHeight: number,
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): bigint {
  // 用户指定不自动增发
  return BigInt(0);
}

/**
 * 计算总供应量（优化版）
 */
export function calculateTotalSupply(
  currentBlockHeight: number,
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): bigint {
  const initialSupply = BigInt(config.initialSupply);

  // 由于奖励为0，总供应量恒定
  // 如果未来开启奖励，使用公式法：initial + height * reward (如果不考虑减半)

  return initialSupply;
}

// ============================================
// 创世配置验证
// ============================================

/**
 * 验证创世配置
 */
export function validateGenesisConfig(config: GenesisConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 验证初始供应量
  const premineTotal = config.premine.reduce(
    (sum, p) => sum + BigInt(p.amount),
    BigInt(0)
  );

  if (premineTotal > BigInt(config.initialSupply)) {
    errors.push(`Premine total (${premineTotal}) exceeds initial supply (${config.initialSupply})`);
  }

  // 验证验证者数量（至少3个用于BFT）
  if (config.validators.length < 3) {
    errors.push('At least 3 validators required for BFT consensus');
  }

  // 验证验证者质押
  for (const validator of config.validators) {
    if (BigInt(validator.stake) <= BigInt(0)) {
      errors.push(`Validator ${validator.id} has invalid stake`);
    }
  }

  // 验证区块时间
  if (config.blockTime < 1000) {
    errors.push('Block time too short (minimum 1000ms)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================
// 创世配置序列化/反序列化
// ============================================

/**
 * 从 KV 加载创世配置
 */
export async function loadGenesisConfig(kv: KVNamespace): Promise<GenesisConfig> {
  const stored = await kv.get<GenesisConfig>('genesis_config', 'json');
  return stored || DEFAULT_GENESIS_CONFIG;
}

/**
 * 保存创世配置到 KV
 */
export async function saveGenesisConfig(
  kv: KVNamespace,
  config: GenesisConfig
): Promise<void> {
  await kv.put('genesis_config', JSON.stringify(config));
}

// ============================================
// 代币信息查询
// ============================================

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply: string;
  genesisBlock: number;
  genesisTxHash: string;
  blockReward: string;
  nextHalving: number;
}

/**
 * 获取代币信息
 */
export async function getTokenInfo(
  currentBlockHeight: number,
  config: GenesisConfig = DEFAULT_GENESIS_CONFIG
): Promise<TokenInfo> {
  const totalSupply = calculateTotalSupply(currentBlockHeight, config);

  // 计算流通供应量（扣除未释放的预挖）
  let circulatingSupply = BigInt(0);
  for (const allocation of config.premine) {
    const monthsSinceGenesis = Math.floor(
      (Date.now() - config.genesisTime) / (30 * 24 * 60 * 60 * 1000)
    );
    const vestedMonths = Math.min(monthsSinceGenesis, allocation.vestingMonths || 0);
    const vestedAmount = BigInt(allocation.amount) * BigInt(vestedMonths) / BigInt(allocation.vestingMonths || 1);
    circulatingSupply += vestedAmount;
  }

  // 加上挖矿产出
  for (let i = 1; i <= currentBlockHeight; i++) {
    circulatingSupply += calculateBlockReward(i, config);
  }

  const halvings = Math.floor(currentBlockHeight / config.halvingInterval);
  const nextHalving = (halvings + 1) * config.halvingInterval;

  return {
    name: config.tokenName,
    symbol: config.tokenSymbol,
    decimals: config.tokenDecimals,
    totalSupply: totalSupply.toString(),
    circulatingSupply: circulatingSupply.toString(),
    genesisBlock: 0,
    genesisTxHash: '', // 需要实际计算
    blockReward: calculateBlockReward(currentBlockHeight, config).toString(),
    nextHalving,
  };
}
