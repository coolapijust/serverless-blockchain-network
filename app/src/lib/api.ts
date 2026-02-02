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

// 从环境变量获取 API 地址，如果未设置则使用默认值
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://blockchain-mvp.lovelylove.workers.dev';

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

    const result = await response.json();

    // Handle error responses
    if (result.success === false) {
      throw new Error(result.error || 'API request failed');
    }

    // If response has a 'data' field, unwrap it; otherwise return the whole result
    // This handles both ApiResponse<T> format and direct response format
    return (result.data !== undefined ? result.data : result) as T;
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
    try {
      console.log(`[API] Fetching block ${height}...`);
      const result = await this.fetch<any>(`/block/${height}`);
      console.log(`[API] getBlock(${height}) raw result:`, JSON.stringify(result).substring(0, 200));
      console.log(`[API] getBlock(${height}) has block?`, !!result?.block);
      console.log(`[API] getBlock(${height}) has header?`, !!result?.block?.header);

      // Backend returns BlockQueryResponse { block: Block, lightBlock, confirmations }
      if (result && result.block && result.block.header) {
        console.log(`[API] Returning block ${height} successfully`);
        return result.block;
      }

      console.error(`[API] Block data structure invalid:`, result);
      throw new Error('Block data not found or invalid in response');
    } catch (e) {
      console.error(`[API] getBlock(${height}) failed:`, e);
      throw e;
    }
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
    const result = await this.fetch<any>(`/tx/${txHash}`);
    // Backend returns TransactionReceipt { transaction: Transaction, status, blockHeight... }
    if (result && result.transaction) {
      return {
        ...result.transaction,
        status: result.status,
        blockHeight: result.blockHeight,
        blockHash: result.blockHash,
        confirmationTime: result.confirmationTime,
      };
    }
    return result; // Fallback
  }

  async submitTransaction(tx: {
    from: Address;
    to: Address;
    amount: string;
    nonce: number;
    timestamp: number; // Accept timestamp from caller
    signature: string;
    publicKey: string;
  }): Promise<{ txHash: string; estimatedConfirmationTime: number }> {
    return this.fetch('/tx/submit', {
      method: 'POST',
      body: JSON.stringify(tx), // Use provided timestamp
    });
  }

  // ==================== Accounts ====================
  async getAccount(address: Address): Promise<Account> {
    return this.fetch(`/account/${address}`);
  }

  async getAccountTransactions(address: Address): Promise<Transaction[]> {
    const txs = await this.fetch<Transaction[]>(`/account/${address}/txs`);
    // Backend returns TransactionReceipt[], verify and map if needed
    // But since we fixed the backend to return `data` as the array, fetch returns `T`.
    // However, the items are Receipts (nested). We need to flatten them similar to getTransaction.

    // Actually, let's check the backend response. `handleQueryAccountTransactions` returns `data: data.transactions`
    // where elements are `TransactionReceipt`.
    // We should flatten them here for easier consumption in UI.
    return (txs as any[]).map((r: any) => {
      if (r.transaction) {
        return {
          ...r.transaction,
          status: r.status,
          blockHeight: r.blockHeight,
          blockHash: r.blockHash,
          confirmationTime: r.confirmationTime,
        };
      }
      return r; // Should not happen with current backend
    });
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
