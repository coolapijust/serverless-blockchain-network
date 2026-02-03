/**
 * BACKUP_ENCRYPTION_KEY 生成工具
 * 用于生成一个安全的 256-bit (32字节) 十六进制字符串
 */

const crypto = require('crypto');

function generateKey() {
    const key = crypto.randomBytes(32).toString('hex');
    console.log('\n--- 🔑 您的安全备份密钥 (BACKUP_ENCRYPTION_KEY) ---');
    console.log(key);
    console.log('--------------------------------------------------\n');
    console.log('💡 请妥善保管此密钥！没有它，您将无法恢复加密的备份文件。');
    console.log('👉 部署建议：使用命令 `npx wrangler secret put BACKUP_ENCRYPTION_KEY` 将其设置到 Cloudflare。\n');
}

generateKey();
