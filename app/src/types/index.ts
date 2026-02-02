/**
 * ============================================
 * Blockchain Frontend Types
 * ============================================
 */

export type HexString = string;
export type Address = string;
export type TxHash = HexString;
export type BlockHash = HexString;
export type Signature = HexString;

export interface KeyPair {
  publicKey: HexString;
  privateKey: HexString;
}

export interface Transaction {
  hash: TxHash;
  from: Address;
  to: Address;
  amount: string;
  nonce: number;
  timestamp: number;
  gasPrice: string;
  gasLimit: string;
  signature: string;
  publicKey: string; // Add public key for verification
  status: 'pending' | 'processing' | 'confirmed' | 'failed';
  blockHeight?: number;
  blockHash?: BlockHash;
  confirmationTime?: number;
}

export interface Block {
  header: {
    height: number;
    timestamp: number;
    prevHash: BlockHash;
    txRoot: BlockHash;
    stateRoot: BlockHash;
    proposer: string;
    txCount: number;
  };
  transactions: Transaction[];
  hash: BlockHash;
  proposerSignature: string;
  votes: ValidatorVote[];
  consensusTime?: number;
}

export interface ValidatorVote {
  validatorId: string;
  validatorPubKey: string;
  signature: string;
  timestamp: number;
}

export interface Account {
  address: Address;
  balance: string;
  nonce: number;
  pendingNonce: number;
}

export interface NetworkStatus {
  networkId: string;
  chainId: string;
  latestBlockHeight: number;
  latestBlockHash: BlockHash;
  pendingTransactions: number;
  totalTransactions: number;
  validators: string[];
  blockTime?: number;
  tps?: number;
  uptime?: number;
  lastUpdated?: number;
  lastError?: string;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  circulatingSupply: string;
  genesisBlock: number;
  genesisTxHash: string;
}

export interface Trade {
  id: string;
  type: 'buy' | 'sell';
  amount: string;
  price: string;
  total: string;
  timestamp: number;
  from: Address;
  to: Address;
  txHash: TxHash;
}

export interface Order {
  id: string;
  type: 'buy' | 'sell';
  amount: string;
  price: string;
  filled: string;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
  timestamp: number;
  owner: Address;
}

export interface MarketData {
  price: string;
  change24h: string;
  volume24h: string;
  high24h: string;
  low24h: string;
  lastUpdate: number;
}

export interface AdminStats {
  totalBlocks: number;
  totalTransactions: number;
  totalAccounts: number;
  activeValidators: number;
  pendingTransactions: number;
  averageBlockTime: number;
  networkHealth: 'healthy' | 'degraded' | 'down';
}

export interface GenesisConfig {
  chainId: string;
  networkId: string;
  genesisTime: number;
  initialSupply: string;
  premine: {
    address: Address;
    amount: string;
    description: string;
  }[];
  blockTime: number;
  blockReward: string;
  halvingInterval: number;
  validators: {
    id: string;
    publicKey: string;
    address: Address;
  }[];
}
