/**
 * ============================================
 * Blockchain API Client
 * ============================================
 */

import type {
  Transaction,
  Block,
  Account,
  NetworkStatus,
  HexString,
  Address,
} from '@/types';

// 硬编码生产环境 API 地址，确保连接无误
const API_BASE_URL = 'https://blockchain-mvp.lovelylove.workers.dev';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `HTTP ${response.status}`);
    }

    const result = await response.json() as ApiResponse<T>;

    if (!result.success) {
      throw new Error(result.error || 'API request failed');
    }

    return result.data as T;
  }

  // ==================== Network ====================
  async getNetworkStatus(): Promise<NetworkStatus> {
    return this.fetch('/status');
  }

  async getHealth(): Promise<{ status: string; service: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  // ==================== Blocks ====================
  async getLatestBlock(): Promise<Block> {
    const result = await this.fetch<any>('/block/latest');
    // The latest block endpoint returns { height, hash, timestamp } 
    // but the app expects a full Block object for getLatestBlock.
    // We should probably redirect to getBlock(height) for full data.
    return this.getBlock(result.height);
  }

  async getBlock(height: number): Promise<Block> {
    const result = await this.fetch<any>(`/block/${height}`);
    // Backend returns BlockQueryResponse { block: Block, confirmations: number }
    if (result && result.block) {
      return result.block;
    }
    throw new Error('Block data not found in response');
  }

  async getBlocks(page: number = 1, limit: number = 20): Promise<Block[]> {
    try {
      const status = await this.getNetworkStatus();
      if (!status || status.latestBlockHeight === undefined) return [];

      const blocks: Block[] = [];
      const startHeight = Math.max(0, status.latestBlockHeight - (page - 1) * limit);
      const endHeight = Math.max(-1, startHeight - limit);

      for (let i = startHeight; i > endHeight; i--) {
        try {
          const block = await this.getBlock(i);
          if (block && block.header) {
            blocks.push(block);
          }
        } catch (e) {
          console.warn(`Failed to fetch block ${i}:`, e);
          // Continue to next block instead of breaking entirely
        }
      }

      return blocks;
    } catch (e) {
      console.error('getBlocks failed:', e);
      return [];
    }
  }

  // ==================== Transactions ====================
  async getTransaction(txHash: HexString): Promise<Transaction> {
    return this.fetch(`/tx/${txHash}`);
  }

  async submitTransaction(tx: {
    from: Address;
    to: Address;
    amount: string;
    nonce: number;
    signature: string;
    publicKey: string;
  }): Promise<{ txHash: string; estimatedConfirmationTime: number }> {
    return this.fetch('/tx/submit', {
      method: 'POST',
      body: JSON.stringify({
        ...tx,
        timestamp: Date.now(),
      }),
    });
  }

  // ==================== Accounts ====================
  async getAccount(address: Address): Promise<Account> {
    return this.fetch(`/account/${address}`);
  }

  // ==================== Faucet ====================
  async requestFaucet(address: Address, amount?: string): Promise<{ txHash: string; amount: string }> {
    return this.fetch('/faucet', {
      method: 'POST',
      body: JSON.stringify({ address, amount }),
    });
  }

  // ==================== Admin ====================
  async initGenesis(): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.fetch('/admin/init-genesis', {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
export default api;
