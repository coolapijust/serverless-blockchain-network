#!/usr/bin/env node
/**
 * ============================================
 * Genesis Block Initialization Script
 * ============================================
 * 
 * Usage: node scripts/init-genesis.js [--api-url URL] [--admin-key KEY]
 */

const https = require('https');
const http = require('http');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function makeRequest(url, options = {}) {
  const client = url.startsWith('https') ? https : http;
  
  return new Promise((resolve, reject) => {
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function checkHealth(apiUrl) {
  console.log('Checking API health...');
  
  try {
    const response = await makeRequest(`${apiUrl}/health`);
    console.log('✓ API is healthy');
    console.log('  Response:', JSON.stringify(response, null, 2));
    return true;
  } catch (error) {
    console.error('✗ API health check failed:', error.message);
    return false;
  }
}

async function checkGenesisStatus(apiUrl) {
  console.log('\nChecking current genesis status...');
  
  try {
    const response = await makeRequest(`${apiUrl}/status`);
    
    if (response.success && response.data) {
      console.log('Current network status:');
      console.log(`  Network ID: ${response.data.networkId}`);
      console.log(`  Chain ID: ${response.data.chainId}`);
      console.log(`  Latest Block: ${response.data.latestBlockHeight}`);
      console.log(`  Total Transactions: ${response.data.totalTransactions}`);
      
      if (response.data.latestBlockHeight >= 0) {
        console.log('\n⚠ Genesis block already exists!');
        return { exists: true, data: response.data };
      }
    }
    
    return { exists: false, data: response.data };
  } catch (error) {
    console.error('✗ Failed to check status:', error.message);
    return { exists: false, data: null };
  }
}

async function initializeGenesis(apiUrl, adminKey) {
  console.log('\nInitializing genesis block...');
  
  try {
    const response = await makeRequest(`${apiUrl}/admin/init-genesis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timestamp: Date.now() }),
    });
    
    if (response.success) {
      console.log('✓ Genesis block created successfully!');
      console.log('  Block Height:', response.genesisBlock.height);
      console.log('  Block Hash:', response.genesisBlock.hash);
      console.log('  Transaction Count:', response.genesisBlock.txCount);
      console.log('  Initial Supply:', response.genesisBlock.initialSupply);
      return true;
    } else {
      console.error('✗ Genesis initialization failed:', response.error);
      return false;
    }
  } catch (error) {
    console.error('✗ Request failed:', error.message);
    return false;
  }
}

async function verifyGenesis(apiUrl) {
  console.log('\nVerifying genesis block...');
  
  try {
    // 查询创世区块
    const blockResponse = await makeRequest(`${apiUrl}/block/0`);
    
    if (blockResponse.data) {
      console.log('✓ Genesis block found');
      console.log('  Hash:', blockResponse.data.block?.hash || blockResponse.data.lightBlock?.hash);
      console.log('  Transactions:', blockResponse.data.block?.transactions?.length || 0);
    }
    
    // 查询预挖地址余额
    const statusResponse = await makeRequest(`${apiUrl}/status`);
    
    if (statusResponse.success) {
      console.log('✓ Network is operational');
      console.log('  Total Transactions:', statusResponse.data.totalTransactions);
    }
    
    return true;
  } catch (error) {
    console.error('✗ Verification failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Cloudflare Blockchain MVP - Genesis Initialization');
  console.log('='.repeat(60));
  console.log();
  
  // 解析命令行参数
  const args = process.argv.slice(2);
  let apiUrl = 'https://api.blockchain-mvp.workers.dev';
  let adminKey = '';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-url' && args[i + 1]) {
      apiUrl = args[i + 1];
      i++;
    }
    if (args[i] === '--admin-key' && args[i + 1]) {
      adminKey = args[i + 1];
      i++;
    }
  }
  
  // 交互式输入
  if (!apiUrl.includes('your-domain')) {
    const customUrl = await question(`API URL [${apiUrl}]: `);
    if (customUrl.trim()) apiUrl = customUrl.trim();
  } else {
    apiUrl = await question('Enter API URL: ');
  }
  
  if (!adminKey) {
    adminKey = await question('Enter Admin API Key: ');
  }
  
  console.log();
  console.log('Configuration:');
  console.log('  API URL:', apiUrl);
  console.log('  Admin Key:', adminKey ? '***' : '(not set)');
  console.log();
  
  if (!adminKey) {
    console.error('Error: Admin API Key is required');
    process.exit(1);
  }
  
  // 执行检查
  const healthy = await checkHealth(apiUrl);
  if (!healthy) {
    console.error('\nError: API is not healthy. Please check your deployment.');
    process.exit(1);
  }
  
  const { exists, data } = await checkGenesisStatus(apiUrl);
  
  if (exists) {
    const confirm = await question('\nGenesis block already exists. Reinitialize? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }
  
  // 初始化创世区块
  const success = await initializeGenesis(apiUrl, adminKey);
  
  if (success) {
    // 验证
    await verifyGenesis(apiUrl);
    
    console.log();
    console.log('='.repeat(60));
    console.log('Genesis initialization completed successfully!');
    console.log('='.repeat(60));
    console.log();
    console.log('Next steps:');
    console.log('  1. Query genesis block: curl', `${apiUrl}/block/0`);
    console.log('  2. Check network status: curl', `${apiUrl}/status`);
    console.log('  3. Query account balance: curl', `${apiUrl}/account/0x...`);
    console.log();
  } else {
    console.error('\nGenesis initialization failed.');
    process.exit(1);
  }
  
  rl.close();
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
