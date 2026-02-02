#!/usr/bin/env node
/**
 * ============================================
 * Ed25519 Key Pair Generator
 * ============================================
 * 
 * Usage: node scripts/generate-keys.js [count]
 * Default count: 3 (1 proposer + 2 validators)
 */

const crypto = require('crypto');

function generateKeyPair(index) {
  // 生成 Ed25519 密钥对
  const keyPair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });

  // 提取私钥（32字节种子）
  const privateKey = '0x' + keyPair.privateKey.toString('hex').slice(32, 96);
  
  // 提取公钥
  const publicKey = '0x' + keyPair.publicKey.toString('hex').slice(24, 88);
  
  // 派生地址（公钥前20字节）
  const address = '0x' + publicKey.slice(2, 42);

  return {
    index,
    role: index === 0 ? 'Proposer' : `Validator ${index}`,
    privateKey,
    publicKey,
    address,
  };
}

function main() {
  const count = parseInt(process.argv[2]) || 3;
  
  console.log('='.repeat(60));
  console.log('Cloudflare Blockchain MVP - Key Generator');
  console.log('='.repeat(60));
  console.log();
  console.log(`Generating ${count} key pairs...`);
  console.log();

  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(generateKeyPair(i));
  }

  keys.forEach((key) => {
    console.log('-'.repeat(60));
    console.log(`KeyPair ${key.index} (${key.role}):`);
    console.log('-'.repeat(60));
    console.log(`  Private Key: ${key.privateKey}`);
    console.log(`  Public Key:  ${key.publicKey}`);
    console.log(`  Address:     ${key.address}`);
    console.log();
  });

  console.log('='.repeat(60));
  console.log('IMPORTANT: Save these keys securely!');
  console.log('Private keys should never be shared or committed to git.');
  console.log('='.repeat(60));
  console.log();
  
  // 输出 wrangler.toml 配置片段
  console.log('Add these to your wrangler.toml secrets:');
  console.log();
  console.log('```bash');
  console.log('# Proposer');
  console.log(`wrangler secret put PROPOSER_PRIVATE_KEY --env proposer`);
  console.log(`# Enter: ${keys[0].privateKey}`);
  console.log();
  console.log('# Validator 1');
  console.log(`wrangler secret put VALIDATOR_PRIVATE_KEY --env validator1`);
  console.log(`# Enter: ${keys[1].privateKey}`);
  console.log();
  console.log('# Validator 2');
  console.log(`wrangler secret put VALIDATOR_PRIVATE_KEY --env validator2`);
  console.log(`# Enter: ${keys[2].privateKey}`);
  console.log('```');
  console.log();
  
  // 输出创世配置片段
  console.log('Add these to your genesis config:');
  console.log();
  console.log('```typescript');
  console.log('validators: [');
  keys.forEach((key, i) => {
    console.log('  {');
    console.log(`    id: 'node-${i}',`);
    console.log(`    publicKey: '${key.publicKey}',`);
    console.log(`    address: '${key.address}',`);
    console.log(`    stake: '1000000000000000000000', // 1000 tokens`);
    console.log(`    commission: 10,`);
    console.log('  },');
  });
  console.log('],');
  console.log('```');
}

main();
