# Cloudflare Serverless Blockchain MVP

基于 Cloudflare 边缘计算的极简区块链实现，采用事件驱动架构实现"零交易零成本，有交易即时出块"。

## 架构概览

```
用户提交交易 → API Worker → 写入 DO Pending Queue → HTTP 唤醒 Proposer → 打包区块 → 并行请求 2 Validators 签名 → 收集 2/3 签名 → DO 原子提交 → 清空 Queue
```

## 核心特性

- **零成本休眠**：无交易时 Workers 完全休眠，不消耗任何资源
- **3秒确认**：交易提交后 3 秒内完成 BFT 共识确认
- **强一致性**：Pending Queue 使用 Durable Objects 存储，防止双花攻击
- **事件驱动**：禁用 Cron Triggers，完全由交易提交事件驱动
- **Alarm 兜底**：5 分钟超时强制出块，防止交易卡死
- **批量打包**：单次出块可包含 1-20 笔交易，降低单位成本
- **创世发行**：支持预挖分配、区块奖励、减半机制

---

## 项目结构

```
blockchain-mvp/
├── wrangler.toml                    # Cloudflare 配置
├── src/
│   ├── types.ts                     # TypeScript 接口定义
│   ├── types/
│   │   └── genesis.ts               # 创世相关类型
│   ├── crypto.ts                    # Ed25519 + SHA-256 工具
│   ├── durable-objects/
│   │   ├── consensus.ts             # ConsensusCoordinator DO
│   │   └── genesis.ts               # 创世区块 & 代币发行
│   └── workers/
│       ├── api.ts                   # API Gateway
│       ├── proposer.ts              # 区块提议者
│       └── validator.ts             # 验证者节点
├── test/
│   └── scenarios.ts                 # 测试用例
└── README.md                        # 本文档
```

---

## 代币经济模型

### 创世配置

```typescript
const GENESIS_CONFIG = {
  // 代币基本信息
  tokenName: 'Cloudflare Token',
  tokenSymbol: 'CFT',
  tokenDecimals: 18,
  
  // 初始供应量：10,000,000 CFT
  initialSupply: '10000000000000000000000000',
  
  // 预挖分配
  premine: [
    { address: '0x...', amount: '2000000 CFT', description: 'Team Reserve', vestingMonths: 24 },
    { address: '0x...', amount: '1500000 CFT', description: 'Ecosystem Fund', vestingMonths: 12 },
    { address: '0x...', amount: '1000000 CFT', description: 'Community Rewards', vestingMonths: 0 },
    { address: '0x...', amount: '5000000 CFT', description: 'Liquidity Mining', vestingMonths: 36 },
  ],
  
  // 挖矿参数
  blockTime: 3000,           // 3秒出块
  blockReward: '1 CFT',      // 每区块奖励
  halvingInterval: 2100000,  // ~2年减半
}
```

### 如何设置初始区块和发币量

#### 方法1：修改创世配置文件

编辑 `src/durable-objects/genesis.ts`：

```typescript
export const DEFAULT_GENESIS_CONFIG: GenesisConfig = {
  // 修改代币名称和符号
  tokenName: 'Your Token Name',
  tokenSymbol: 'YTK',
  tokenDecimals: 18,
  
  // 设置初始供应量（最小单位，18位小数）
  // 例如：100万代币 = 1000000 * 10^18
  initialSupply: '1000000000000000000000000',
  
  // 配置预挖分配
  premine: [
    {
      address: '0xYourAddress1...',  // 团队地址
      amount: '200000000000000000000000',  // 20万代币
      description: 'Team Reserve',
      vestingMonths: 24,  // 24个月线性释放
    },
    {
      address: '0xYourAddress2...',  // 生态基金地址
      amount: '300000000000000000000000',  // 30万代币
      description: 'Ecosystem Fund',
      vestingMonths: 12,
    },
  ],
  
  // 配置区块奖励
  blockReward: '1000000000000000000',  // 1代币每区块
  halvingInterval: 2100000,  // 210万区块后减半
  
  // 配置验证者
  validators: [
    {
      id: 'node-0',
      publicKey: '0xYourPublicKey1...',
      address: '0xYourValidatorAddress1...',
      stake: '100000000000000000000',  // 质押100代币
      commission: 10,  // 10%佣金
    },
    // ... 更多验证者
  ],
};
```

#### 方法2：通过环境变量配置

在 `wrangler.toml` 中添加：

```toml
[vars]
TOKEN_NAME = "Your Token"
TOKEN_SYMBOL = "YTK"
INITIAL_SUPPLY = "1000000000000000000000000"
BLOCK_REWARD = "1000000000000000000"
HALVING_INTERVAL = "2100000"
```

#### 方法3：部署后通过 Admin API 配置

```bash
# 部署前设置创世配置
curl -X POST https://api.your-domain.com/admin/genesis \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "tokenName": "Your Token",
    "tokenSymbol": "YTK",
    "initialSupply": "1000000000000000000000000",
    "premine": [...]
  }'
```

---

## 完整部署流程

### 前置要求

1. [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 安装
3. Node.js 18+
4. 域名（可选，用于自定义域名）

### 重要提示：新人部署必读

直接 Clone 代码后无法直接部署，必须修改以下配置才能成功运行：

1.  **KV Namespace ID**: `wrangler.toml` 中的 `id` 本项目私有。你必须创建自己的 KV 数据库并替换 ID。
2.  **Worker 子域名**: 将配置文件中所有的 `lovelylove.workers.dev` 替换为你自己的 Worker 子域名（通常是 `your-project.your-subdomain.workers.dev`）。
3.  **密钥安全**: 虽然测试网可以直接写在配置文件中，但**生产环境**请务必使用 Secrets！

### 步骤1：克隆并初始化项目

```bash
# 克隆代码
git clone <repository>
cd blockchain-mvp

# 安装依赖
npm install

# 登录 Cloudflare
wrangler login
```

### 步骤2：生成 Ed25519 密钥对

```bash
# 使用 Node.js 生成 3 组密钥（Proposer + 2 Validators）
node scripts/generate-keys.js

# 输出示例：
# KeyPair 0 (Proposer):
#   Private: 0x0123456789abcdef...
#   Public:  0x0123456789abcdef...
#   Address: 0x0123456789abcdef0123456789abcdef01234567
#
# KeyPair 1 (Validator 1):
#   Private: 0xfedcba9876543210...
#   Public:  0xfedcba9876543210...
#   Address: 0xfedcba9876543210fedcba9876543210fedcba98
#
# KeyPair 2 (Validator 2):
#   Private: 0xaabbccdd11223344...
#   Public:  0xaabbccdd11223344...
#   Address: 0xaabbccdd11223344aabbccdd11223344aabbccdd
```

**保存好这些密钥！** 私钥用于签名，公钥用于验证，地址用于接收代币。

### 步骤3：配置创世区块

编辑 `src/durable-objects/genesis.ts`：

```typescript
export const DEFAULT_GENESIS_CONFIG = {
  // 1. 设置代币信息
  tokenName: 'My Token',
  tokenSymbol: 'MTK',
  tokenDecimals: 18,
  
  // 2. 设置初始供应量（例如：1000万代币）
  initialSupply: '10000000000000000000000000',
  
  // 3. 配置预挖分配（使用步骤2生成的地址）
  premine: [
    {
      address: '0x0123456789abcdef0123456789abcdef01234567', // Proposer地址
      amount: '2000000000000000000000000',  // 200万代币
      description: 'Team Reserve',
      vestingMonths: 24,
    },
    {
      address: '0xfedcba9876543210fedcba9876543210fedcba98', // Validator1地址
      amount: '1000000000000000000000000',  // 100万代币
      description: 'Validator Rewards',
      vestingMonths: 0,
    },
    {
      address: '0xaabbccdd11223344aabbccdd11223344aabbccdd', // Validator2地址
      amount: '1000000000000000000000000',  // 100万代币
      description: 'Validator Rewards',
      vestingMonths: 0,
    },
  ],
  
  // 4. 配置验证者（使用步骤2生成的公钥和地址）
  validators: [
    {
      id: 'node-0',
      publicKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      address: '0x0123456789abcdef0123456789abcdef01234567',
      stake: '1000000000000000000000',  // 1000代币质押
      commission: 10,
    },
    {
      id: 'node-1',
      publicKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba98765432',
      address: '0xfedcba9876543210fedcba9876543210fedcba98',
      stake: '1000000000000000000000',
      commission: 10,
    },
    {
      id: 'node-2',
      publicKey: '0xaabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd112233',
      address: '0xaabbccdd11223344aabbccdd11223344aabbccdd',
      stake: '1000000000000000000000',
      commission: 10,
    },
  ],
  
  // 5. 配置挖矿参数
  blockTime: 3000,  // 3秒出块
  blockReward: '1000000000000000000',  // 1代币每区块
  halvingInterval: 2100000,  // ~2年减半
};
```

### 步骤4：创建 KV Namespace

```bash
# 创建配置存储
wrangler kv:namespace create "CONFIG_KV"
wrangler kv:namespace create "CONFIG_KV" --preview

# 记录输出的 id，更新 wrangler.toml 中的 id 和 preview_id
```

### 步骤5：配置 Secrets (推荐安全做法)

**强烈建议**不要将私钥硬编码在 `wrangler.toml` 中（除非是本地测试环境）。请使用 `wrangler secret` 命令将私钥加密存储在 Cloudflare 环境变量中。

```bash
# 1. Proposer 私钥
# 对应 wrangler.toml 中的 PROPOSER_PRIVATE_KEY
wrangler secret put PROPOSER_PRIVATE_KEY --env proposer
# 提示输入时，粘贴步骤2生成的 Proposer 私钥 (0x...)

# 2. Validator 1 私钥
# 对应 wrangler.toml 中的 VALIDATOR_PRIVATE_KEY
wrangler secret put VALIDATOR_PRIVATE_KEY --env validator1
# 提示输入时，粘贴步骤2生成的 Validator 1 私钥

# 3. Validator 2 私钥
# 对应 wrangler.toml 中的 VALIDATOR_PRIVATE_KEY
wrangler secret put VALIDATOR_PRIVATE_KEY --env validator2
# 提示输入时，粘贴步骤2生成的 Validator 2 私钥

# 4. Admin 密钥（用于后台管理接口鉴权）
wrangler secret put ADMIN_API_KEY --env production
# 提示输入时，设置一个复杂的密码
```

> **注意**: 设置了 Secret 后，`wrangler.toml` 中的对应 `vars` 变量会被覆盖，你可以安全地从配置文件中删除这些明文私钥。

### 步骤6：部署 Workers

```bash
# 1. 部署 Durable Objects（必须先部署，其他 worker 依赖它）
wrangler deploy --env production

# 2. 部署 Proposer
wrangler deploy --env proposer

# 3. 部署 Validators
wrangler deploy --env validator1
wrangler deploy --env validator2

# 4. 验证部署
wrangler tail --env production
```

### 步骤7：初始化创世区块

```bash
# 调用初始化 API 创建创世区块
curl -X POST https://api.your-domain.com/admin/init-genesis \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"

# 预期响应：
# {
#   "success": true,
#   "genesisBlock": {
#     "height": 0,
#     "hash": "0x...",
#     "txCount": 3,
#     "initialSupply": "10000000000000000000000000"
#   }
# }
```

### 步骤8：验证创世状态

```bash
# 查询网络状态
curl https://api.your-domain.com/status

# 预期响应：
# {
#   "success": true,
#   "data": {
#     "networkId": "cloudflare-mvp-testnet",
#     "chainId": "1337",
#     "latestBlockHeight": 0,
#     "latestBlockHash": "0x...",
#     "pendingTransactions": 0,
#     "totalTransactions": 3,
#     "token": {
#       "name": "My Token",
#       "symbol": "MTK",
#       "totalSupply": "10000000000000000000000000"
#     }
#   }
# }

# 查询预挖地址余额
curl https://api.your-domain.com/account/0x0123456789abcdef0123456789abcdef01234567

# 预期响应：
# {
#   "success": true,
#   "data": {
#     "address": "0x0123456789abcdef0123456789abcdef01234567",
#     "balance": "2000000000000000000000000",
#     "nonce": 0
#   }
# }
```

### 步骤9：配置自定义域名（可选）

```bash
# 添加自定义域名
wrangler route add api.your-domain.com/* --script blockchain-mvp
wrangler route add proposer.your-domain.com/* --script blockchain-mvp-proposer
wrangler route add validator1.your-domain.com/* --script blockchain-mvp-validator1
wrangler route add validator2.your-domain.com/* --script blockchain-mvp-validator2

# 配置 DNS
# 在 Cloudflare Workers中指向 你自己的域名
```

---

## 运行状态检查

### 1. 健康检查

```bash
# API Gateway
curl https://api.your-domain.com/health

# Proposer
curl https://proposer.your-domain.com/health

# Validators
curl https://validator1.your-domain.com/health
curl https://validator2.your-domain.com/health
```

### 2. 网络状态

```bash
curl https://api.your-domain.com/status
```

### 3. 代币信息

```bash
curl https://api.your-domain.com/token/info
```

### 4. 区块查询

```bash
# 最新区块
curl https://api.your-domain.com/block/latest

# 指定区块
curl https://api.your-domain.com/block/0  # 创世区块
curl https://api.your-domain.com/block/1
```

### 5. 账户查询

```bash
curl https://api.your-domain.com/account/0x...
```

### 6. 交易测试

```bash
# 1. 获取测试代币（开发网）
curl -X POST https://api.your-domain.com/faucet \
  -H "Content-Type: application/json" \
  -d '{"address":"0x..."}'

# 2. 提交交易（需要先签名）
curl -X POST https://api.your-domain.com/tx/submit \
  -H "Content-Type: application/json" \
  -d '{
    "from": "0x...",
    "to": "0x...",
    "amount": "100",
    "nonce": 0,
    "signature": "0x..."
  }'

# 3. 查询交易
curl https://api.your-domain.com/tx/0x...
```

---

## 前端部署

前端是一个独立的 React 应用，需要单独部署。

```bash
cd frontend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，设置 VITE_API_URL

# 构建
npm run build

# 部署到 Cloudflare Pages
wrangler pages deploy dist
```

---

## 初始化项目补充内容

### 还需要补充的内容：

1. **创世区块初始化脚本** (`scripts/init-genesis.js`)
   - 自动生成创世配置
   - 验证配置合法性
   - 部署前预检查

2. **密钥管理工具** (`scripts/key-manager.js`)
   - 生成 Ed25519 密钥对
   - 安全存储私钥
   - 地址派生验证

3. **监控告警系统**
   - 区块高度监控
   - 交易确认延迟告警
   - 验证者掉线检测

4. **数据备份机制**
   - DO 状态定期导出
   - 区块数据归档
   - 灾难恢复方案

5. **治理模块**
   - 参数升级提案
   - 投票机制
   - 自动执行

---

## 故障排查

### 问题：创世区块未创建

**排查步骤：**

1. 检查 `/admin/init-genesis` 是否被调用
2. 检查 DO 状态：`curl /internal/state`
3. 检查日志：`wrangler tail`

### 问题：预挖余额不正确

**排查步骤：**

1. 验证创世配置中的地址格式
2. 检查 `initialSupply` 是否足够覆盖 `premine` 总和
3. 重新初始化创世区块

### 问题：区块奖励不生效

**排查步骤：**

1. 检查 `blockReward` 配置
2. 验证 `halvingInterval` 计算
3. 检查 Proposer 是否正确发放奖励

---

## 安全建议

1. **密钥管理**：使用 Cloudflare Secrets，禁止硬编码
2. **访问控制**：Admin API 需要强认证
3. **速率限制**：API Gateway 添加请求限流
4. **监控告警**：配置异常交易告警
5. **定期审计**：检查代币分配和区块奖励

---

## 许可证

MIT
