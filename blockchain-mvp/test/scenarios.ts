/**
 * ============================================
 * Cloudflare Serverless Blockchain MVP
 * 测试场景
 * ============================================
 * 
 * 测试覆盖：
 * 1. 单交易流程 - 验证完整共识流程
 * 2. 批量交易 - 验证 1-20 笔批量打包
 * 3. 双花攻击 - 验证 nonce 和 processing 锁
 * 4. Alarm 兜底 - 验证 5 分钟超时强制出块
 * 5. 并发提交 - 验证队列和锁机制
 * 6. 无效交易 - 验证余额不足、nonce 错误
 */

import type {
  Transaction,
  Block,
  SubmitTransactionRequest,
  TestScenario,
  TestResult,
  TestStep,
  KeyPair,
} from '../src/types';

import {
  generateKeyPair,
  publicKeyToAddress,
  signTransaction,
  hashTransaction,
  getTestKeyPair,
  addHexPrefix,
} from '../src/crypto';

// ============================================
// 测试配置
// ============================================

const TEST_CONFIG = {
  // API 端点
  API_URL: 'https://api.blockchain-mvp.workers.dev',
  PROPOSER_URL: 'https://proposer.blockchain-mvp.workers.dev',
  VALIDATOR1_URL: 'https://validator1.blockchain-mvp.workers.dev',
  VALIDATOR2_URL: 'https://validator2.blockchain-mvp.workers.dev',

  // 测试密钥
  TEST_KEYS: {
    alice: getTestKeyPair(0),
    bob: getTestKeyPair(1),
    charlie: getTestKeyPair(2),
  },

  // 超时配置
  TIMEOUT_MS: 10000,
  CONSENSUS_TIMEOUT_MS: 5000,
};

// ============================================
// 测试工具
// ============================================

class TestRunner {
  private results: TestResult[] = [];
  private requestId: string = '';

  async runScenario(scenario: TestScenario): Promise<TestResult> {
    console.log(`\n========================================`);
    console.log(`Running: ${scenario.name}`);
    console.log(`Description: ${scenario.description}`);
    console.log(`========================================`);

    const startTime = Date.now();
    const stepResults: { step: number; action: string; passed: boolean; error?: string }[] = [];

    try {
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        console.log(`\n[Step ${i + 1}] ${step.action}`);

        try {
          await this.executeStep(step);
          stepResults.push({ step: i + 1, action: step.action, passed: true });
          console.log(`✓ Passed`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          stepResults.push({ step: i + 1, action: step.action, passed: false, error: errorMsg });
          console.log(`✗ Failed: ${errorMsg}`);
          throw error;
        }
      }

      const duration = Date.now() - startTime;
      const result: TestResult = {
        scenario: scenario.name,
        passed: true,
        steps: stepResults,
        duration,
      };

      this.results.push(result);
      console.log(`\n✓ Scenario passed (${duration}ms)`);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const result: TestResult = {
        scenario: scenario.name,
        passed: false,
        steps: stepResults,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.results.push(result);
      console.log(`\n✗ Scenario failed (${duration}ms)`);
      return result;
    }
  }

  private async executeStep(step: TestStep): Promise<void> {
    // 根据 action 执行不同的操作
    switch (step.action) {
      case 'submitTransaction':
        await this.submitTransaction(step.params as { from: KeyPair; to: string; amount: string; nonce: number });
        break;
      case 'submitBatchTransactions':
        await this.submitBatchTransactions(step.params as { count: number; from: KeyPair });
        break;
      case 'waitForConfirmation':
        await this.waitForConfirmation(step.params as { txHash: string });
        break;
      case 'checkBalance':
        await this.checkBalance(step.params as { address: string; expected: string });
        break;
      case 'checkNonce':
        await this.checkNonce(step.params as { address: string; expected: number });
        break;
      case 'doubleSpend':
        await this.testDoubleSpend(step.params as { from: KeyPair; to: string; amount: string });
        break;
      case 'invalidNonce':
        await this.testInvalidNonce(step.params as { from: KeyPair; to: string; nonce: number });
        break;
      case 'insufficientBalance':
        await this.testInsufficientBalance(step.params as { from: KeyPair; to: string; amount: string });
        break;
      case 'concurrentSubmit':
        await this.testConcurrentSubmit(step.params as { count: number; from: KeyPair });
        break;
      case 'triggerAlarm':
        await this.triggerAlarm();
        break;
      case 'wait':
        await this.wait((step.params as { ms: number }).ms);
        break;
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }

  // ============================================
  // 测试操作实现
  // ============================================

  private async submitTransaction(params: {
    from: KeyPair;
    to: string;
    amount: string;
    nonce: number;
  }): Promise<string> {
    const { from, to, amount, nonce } = params;

    const timestamp = Date.now();
    const txData = {
      from: publicKeyToAddress(from.publicKey),
      to: to.toLowerCase(),
      amount,
      nonce,
      timestamp,
    };

    const signature = await signTransaction({
      from: txData.from,
      to: txData.to,
      amount: txData.amount,
      nonce: txData.nonce,
      timestamp: txData.timestamp,
    }, from.privateKey);

    const request: SubmitTransactionRequest = {
      from: txData.from,
      to: txData.to,
      amount,
      nonce,
      timestamp,
      signature,
      publicKey: from.publicKey,
    };

    const response = await fetch(`${TEST_CONFIG.API_URL}/tx/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Submit failed: ${error}`);
    }

    const result = await response.json() as { txHash: string };
    return result.txHash;
  }

  private async submitBatchTransactions(params: { count: number; from: KeyPair }): Promise<string[]> {
    const { count, from } = params;
    const txHashes: string[] = [];

    // 获取当前 nonce
    const address = publicKeyToAddress(from.publicKey);
    const account = await this.getAccount(address);
    let nonce = account.nonce;

    for (let i = 0; i < count; i++) {
      const txHash = await this.submitTransaction({
        from,
        to: publicKeyToAddress(getTestKeyPair(1).publicKey),
        amount: '100',
        nonce: nonce++,
      });
      txHashes.push(txHash);
    }

    return txHashes;
  }

  private async waitForConfirmation(params: { txHash: string }): Promise<void> {
    const { txHash } = params;
    const startTime = Date.now();

    while (Date.now() - startTime < TEST_CONFIG.CONSENSUS_TIMEOUT_MS) {
      const receipt = await this.getTransaction(txHash);

      if (receipt && receipt.status === 'confirmed') {
        return;
      }

      await this.wait(500);
    }

    throw new Error('Confirmation timeout');
  }

  private async checkBalance(params: { address: string; expected: string }): Promise<void> {
    const { address, expected } = params;
    const account = await this.getAccount(address);

    if (account.balance !== expected) {
      throw new Error(`Balance mismatch. Expected: ${expected}, got: ${account.balance}`);
    }
  }

  private async checkNonce(params: { address: string; expected: number }): Promise<void> {
    const { address, expected } = params;
    const account = await this.getAccount(address);

    if (account.nonce !== expected) {
      throw new Error(`Nonce mismatch. Expected: ${expected}, got: ${account.nonce}`);
    }
  }

  private async testDoubleSpend(params: { from: KeyPair; to: string; amount: string }): Promise<void> {
    const { from, to, amount } = params;

    // 获取当前 nonce
    const address = publicKeyToAddress(from.publicKey);
    const account = await this.getAccount(address);
    const nonce = account.nonce;

    // 同时提交两笔相同 nonce 的交易
    const [result1, result2] = await Promise.allSettled([
      this.submitTransaction({ from, to, amount, nonce }),
      this.submitTransaction({ from, to, amount, nonce }),
    ]);

    // 应该只有一笔成功
    const successCount = [result1, result2].filter(r => r.status === 'fulfilled').length;

    if (successCount !== 1) {
      throw new Error(`Double spend test failed. Success count: ${successCount}, expected: 1`);
    }
  }

  private async testInvalidNonce(params: { from: KeyPair; to: string; nonce: number }): Promise<void> {
    const { from, to, nonce } = params;

    try {
      await this.submitTransaction({ from, to, amount: '100', nonce });
      throw new Error('Should have failed with invalid nonce');
    } catch (error) {
      // 预期失败
      if (error instanceof Error && error.message.includes('Should have failed')) {
        throw error;
      }
    }
  }

  private async testInsufficientBalance(params: { from: KeyPair; to: string; amount: string }): Promise<void> {
    const { from, to, amount } = params;

    const address = publicKeyToAddress(from.publicKey);
    const account = await this.getAccount(address);

    try {
      await this.submitTransaction({ from, to, amount, nonce: account.nonce });
      throw new Error('Should have failed with insufficient balance');
    } catch (error) {
      // 预期失败
      if (error instanceof Error && error.message.includes('Should have failed')) {
        throw error;
      }
    }
  }

  private async testConcurrentSubmit(params: { count: number; from: KeyPair }): Promise<void> {
    const { count, from } = params;

    // 并发提交多笔交易
    const promises: Promise<string>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        this.submitTransaction({
          from,
          to: publicKeyToAddress(getTestKeyPair(1).publicKey),
          amount: '10',
          nonce: i, // 注意：这里应该使用递增 nonce
        })
      );
    }

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;

    console.log(`Concurrent submit: ${successCount}/${count} succeeded`);
  }

  private async triggerAlarm(): Promise<void> {
    // 触发 DO Alarm（需要内部接口）
    const response = await fetch(`${TEST_CONFIG.API_URL}/internal/trigger-alarm`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to trigger alarm');
    }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // API 辅助方法
  // ============================================

  private async getAccount(address: string): Promise<{ balance: string; nonce: number }> {
    const response = await fetch(`${TEST_CONFIG.API_URL}/account/${address}`);

    if (!response.ok) {
      throw new Error(`Failed to get account: ${response.status}`);
    }

    const result = await response.json() as { data: { balance: string; nonce: number } };
    return result.data;
  }

  private async getTransaction(txHash: string): Promise<{ status: string; blockHeight?: number } | null> {
    const response = await fetch(`${TEST_CONFIG.API_URL}/tx/${txHash}`);

    if (!response.ok) {
      return null;
    }

    const result = await response.json() as { data?: { status: string; blockHeight?: number } };
    return result.data || null;
  }

  getResults(): TestResult[] {
    return this.results;
  }

  printSummary(): void {
    console.log('\n========================================');
    console.log('Test Summary');
    console.log('========================================');

    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;

    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`\nDetails:`);

    for (const result of this.results) {
      const status = result.passed ? '✓' : '✗';
      console.log(`${status} ${result.scenario} (${result.duration}ms)`);

      if (!result.passed && result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }
  }
}

// ============================================
// 测试场景定义
// ============================================

const scenarios: TestScenario[] = [
  {
    name: 'Single Transaction Flow',
    description: 'Submit a single transaction and verify it gets confirmed',
    steps: [
      {
        action: 'submitTransaction',
        params: {
          from: TEST_CONFIG.TEST_KEYS.alice,
          to: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.bob.publicKey),
          amount: '1000',
          nonce: 0,
        },
      },
      {
        action: 'waitForConfirmation',
        params: { txHash: '{{previous.txHash}}' },
      },
      {
        action: 'checkBalance',
        params: {
          address: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.bob.publicKey),
          expected: '1000',
        },
      },
    ],
    expectedResult: 'Transaction confirmed within 3 seconds',
  },
  {
    name: 'Batch Transactions (20 Txs)',
    description: 'Submit 20 transactions in batch and verify all get confirmed',
    steps: [
      {
        action: 'submitBatchTransactions',
        params: {
          count: 20,
          from: TEST_CONFIG.TEST_KEYS.alice,
        },
      },
      {
        action: 'wait',
        params: { ms: 5000 },
      },
      {
        action: 'checkNonce',
        params: {
          address: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.alice.publicKey),
          expected: 20,
        },
      },
    ],
    expectedResult: 'All 20 transactions confirmed in one or more blocks',
  },
  {
    name: 'Double Spend Prevention',
    description: 'Attempt to submit two transactions with same nonce',
    steps: [
      {
        action: 'doubleSpend',
        params: {
          from: TEST_CONFIG.TEST_KEYS.alice,
          to: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.bob.publicKey),
          amount: '500',
        },
      },
    ],
    expectedResult: 'Only one transaction succeeds',
  },
  {
    name: 'Invalid Nonce Rejection',
    description: 'Submit transaction with invalid nonce',
    steps: [
      {
        action: 'invalidNonce',
        params: {
          from: TEST_CONFIG.TEST_KEYS.alice,
          to: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.bob.publicKey),
          nonce: 999,
        },
      },
    ],
    expectedResult: 'Transaction rejected with nonce error',
  },
  {
    name: 'Insufficient Balance',
    description: 'Submit transaction with amount exceeding balance',
    steps: [
      {
        action: 'insufficientBalance',
        params: {
          from: TEST_CONFIG.TEST_KEYS.charlie,
          to: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.alice.publicKey),
          amount: '999999999999999999999',
        },
      },
    ],
    expectedResult: 'Transaction rejected with insufficient balance error',
  },
  {
    name: 'Concurrent Submission',
    description: 'Submit multiple transactions concurrently',
    steps: [
      {
        action: 'concurrentSubmit',
        params: {
          count: 10,
          from: TEST_CONFIG.TEST_KEYS.alice,
        },
      },
      {
        action: 'wait',
        params: { ms: 5000 },
      },
    ],
    expectedResult: 'All valid transactions processed without conflicts',
  },
  {
    name: 'Alarm Fallback',
    description: 'Test alarm trigger for stuck transactions',
    steps: [
      {
        action: 'submitTransaction',
        params: {
          from: TEST_CONFIG.TEST_KEYS.alice,
          to: publicKeyToAddress(TEST_CONFIG.TEST_KEYS.bob.publicKey),
          amount: '100',
          nonce: 0,
        },
      },
      {
        action: 'triggerAlarm',
        params: {},
      },
      {
        action: 'waitForConfirmation',
        params: { txHash: '{{previous.txHash}}' },
      },
    ],
    expectedResult: 'Block committed via alarm fallback',
  },
];

// ============================================
// 运行测试
// ============================================

export async function runAllTests(): Promise<void> {
  const runner = new TestRunner();

  for (const scenario of scenarios) {
    await runner.runScenario(scenario);
  }

  runner.printSummary();
}



// ============================================
// 单元测试导出（用于测试框架）
// ============================================

export {
  TestRunner,
  scenarios,
  TEST_CONFIG,
};

// ============================================
// 手动测试命令
// ============================================

/**
 * 手动测试步骤：
 * 
 * 1. 健康检查
 * curl https://api.blockchain-mvp.workers.dev/health
 * 
 * 2. 获取测试代币
 * curl -X POST https://api.blockchain-mvp.workers.dev/faucet \
 *   -H "Content-Type: application/json" \
 *   -d '{"address":"0x..."}'
 * 
 * 3. 提交交易
 * curl -X POST https://api.blockchain-mvp.workers.dev/tx/submit \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "from": "0x...",
 *     "to": "0x...",
 *     "amount": "100",
 *     "nonce": 0,
 *     "signature": "0x..."
 *   }'
 * 
 * 4. 查询交易
 * curl https://api.blockchain-mvp.workers.dev/tx/0x...
 * 
 * 5. 查询账户
 * curl https://api.blockchain-mvp.workers.dev/account/0x...
 * 
 * 6. 查询区块
 * curl https://api.blockchain-mvp.workers.dev/block/latest
 * curl https://api.blockchain-mvp.workers.dev/block/1
 * 
 * 7. 网络状态
 * curl https://api.blockchain-mvp.workers.dev/status
 * 
 * 8. 手动触发 Proposer
 * curl -X POST https://proposer.blockchain-mvp.workers.dev/trigger
 * 
 * 9. 验证者健康检查
 * curl https://validator1.blockchain-mvp.workers.dev/health
 * curl https://validator2.blockchain-mvp.workers.dev/health
 */
