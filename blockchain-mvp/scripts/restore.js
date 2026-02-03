const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ==========================================
// 配置
// ==========================================
// 默认 API 地址（生产环境）
const DEFAULT_API_URL = 'https://blockchain-mvp.lovelylove.workers.dev';
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

async function restore() {
    const args = process.argv.slice(2);
    const help = `
Usage: node scripts/restore.js <CID> <KEY> [API_URL]

  <CID>      IPFS Content ID of the backup
  <KEY>      64-char Hex Encryption Key
  [API_URL]  Optional. Default: ${DEFAULT_API_URL}
`;

    if (args.length < 2) {
        console.log(help);
        process.exit(1);
    }

    const cid = args[0];
    const keyHex = args[1];
    const apiUrl = args[2] || DEFAULT_API_URL;

    if (keyHex.length !== 64) {
        console.error('Error: Key must be 64-character hex string (32 bytes).');
        process.exit(1);
    }

    console.log(`\n=== 🚨 Blockchain Disaster Recovery Tool ===`);
    console.log(`Target API: ${apiUrl}`);
    console.log(`Backup CID: ${cid}`);
    console.log(`------------------------------------------`);

    try {
        // 1. 下载
        console.log(`\n[1/3] Downloading backup from IPFS (${IPFS_GATEWAY})...`);
        const response = await fetch(`${IPFS_GATEWAY}${cid}`);
        if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

        const encryptedBuffer = await response.arrayBuffer();
        const data = new Uint8Array(encryptedBuffer);
        console.log(`      Downloaded ${data.length} bytes.`);

        // 2. 解密
        console.log(`\n[2/3] Decrypting data...`);
        const key = Buffer.from(keyHex, 'hex');
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

        // AES-GCM 自带 auth tag (最后 16 字节)
        // 但在 consensus.ts 中我们只是简单拼接 iv+encrypted (其中 encrypted 包含了 tag? 不，Node.js 的 cipher.final() 和 WebCrypto 的实现略有不同)
        // 注意：WebCrypto (Used in Worker) AES-GCM 输出是 Ciphertext + Tag (combined)
        // Node.js DecipherGCM 需要 setAuthTag。
        // WebCrypto: [IV (12)] [Ciphertext (N)] [Tag (16)]

        // 我们在 consensus.ts 中是: combined.set(iv); combined.set(encryptedData, 12);
        // encryptedData 来自 crypto.subtle.encrypt -> 包含 ciphertext + tag

        // 所以 Node.js 解密时：
        const authTagLength = 16;
        const authTag = ciphertext.slice(ciphertext.length - authTagLength);
        const actualCiphertext = ciphertext.slice(0, ciphertext.length - authTagLength);

        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(actualCiphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        const stateJson = decrypted.toString('utf8');
        const state = JSON.parse(stateJson);
        console.log(`      Decryption successful!`);
        console.log(`      Recovered Block Height: ${state.worldState.latestBlockHeight}`);
        console.log(`      Total Transactions: ${state.worldState.totalTransactions}`);

        // 3. 恢复
        console.log(`\n[3/3] Restoring to Consensus Engine (FORCE RESET)...`);

        const confirm = await verifyUserDecision();
        if (!confirm) {
            console.log('Operation cancelled.');
            process.exit(0);
        }

        const restoreRes = await fetch(`${apiUrl}/admin/restore-backup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                state: state,
                cid: cid,
                force: true // 灾难恢复必须强制
            })
        });

        const result = await restoreRes.json();
        if (result.success) {
            console.log(`\n✅ RESTORE COMPLETE! Service should be back online.`);
        } else {
            console.error(`\n❌ RESTORE FAILED: ${JSON.stringify(result)}`);
        }

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
    }
}

// 简单交互确认
function verifyUserDecision() {
    return new Promise(resolve => {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        readline.question('⚠️  WARNING: This will OVERWRITE the current chain state. Type "RESTORE" to confirm: ', answer => {
            readline.close();
            resolve(answer === 'RESTORE');
        });
    });
}

restore();
