# Coinbase AgentKit Wallet Agent

使用 Coinbase 官方 AgentKit (v0.10+) 构建的 AI 钱包 Agent。

## 特性

- 🤖 **Coinbase AgentKit** - 官方 SDK，功能完整
- 🔐 **CDP 托管钱包** - Coinbase 托管，安全可靠
- 🧠 **Groq/OpenAI** - 支持免费 Groq 或付费 OpenAI
- ⚡ **Base Sepolia** - 默认使用测试网

## 快速开始

### 1. 获取 CDP API Keys

1. 访问 https://portal.cdp.coinbase.com/
2. 注册/登录 Coinbase 开发者账号
3. 创建新项目
4. 生成 API Key（保存 API Key ID 和 Secret）

### 2. 获取 Groq API Key（免费）

1. 访问 https://console.groq.com
2. 登录并创建 API Key

### 3. 配置环境变量

```bash
cd coinbase-agent

# 创建 .env 文件
cat > .env << 'EOF'
# 钱包私钥 (必需，0x 开头)
PRIVATE_KEY=0x_your_private_key_here

# Groq (免费 LLM)
GROQ_API_KEY=gsk_your_groq_key
LLM_PROVIDER=groq

# 网络 (可选，默认 base-sepolia)
NETWORK_ID=base-sepolia

# Web 服务器端口 (可选，默认 3000)
PORT=3000
EOF
```

### 4. 安装并运行

```bash
npm install
```

#### CLI 模式（命令行交互）

```bash
npm run chat
```

#### Web 前端模式（浏览器界面）

```bash
npm run server
```

然后在浏览器中打开 `http://localhost:3000`

## 支持的操作

AgentKit 提供了丰富的链上操作：

| 操作 | 说明 |
|------|------|
| `get_wallet_details` | 获取钱包地址和余额 |
| `get_balance` | 查询余额 |
| `native_transfer` | 转账 ETH |
| `wrap_eth` | 将 ETH 换成 WETH |
| `unwrap_eth` | 将 WETH 换成 ETH |
| `faucet` | 获取测试币 |
| `erc20_transfer` | 转账 ERC20 代币 |
| `erc20_balance` | 查询 ERC20 余额 |
| ... | 更多操作 |

## 示例对话

```
You: 我的钱包地址是什么？

🤖 Agent: get_wallet_details: Address: 0x1234...abcd, Network: base-sepolia, Balance: 0.05 ETH

You: 给我一些测试币

🤖 Agent: faucet: Successfully requested test ETH from faucet!

You: 转 0.01 ETH 到 0xabcd...1234

🤖 Agent: native_transfer: Transaction sent! Hash: 0x...
```

## 项目结构

```
coinbase-agent/
├── src/
│   ├── config.ts    # 配置管理
│   ├── agent.ts     # AgentKit Agent
│   ├── chat.ts      # CLI 交互
│   ├── server.ts    # Web 服务器 (Express)
│   └── index.ts     # 导出
├── public/
│   ├── index.html   # 前端页面
│   ├── style.css    # 样式
│   └── app.js       # 前端 JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

## 环境变量说明

| 变量 | 说明 | 必需 |
|------|------|------|
| `PRIVATE_KEY` | 钱包私钥 (0x 开头) | ✅ |
| `GROQ_API_KEY` | Groq API Key (免费) | ✅ (如果用 Groq) |
| `OPENAI_API_KEY` | OpenAI API Key | ✅ (如果用 OpenAI) |
| `LLM_PROVIDER` | `groq` 或 `openai` | ❌ (默认 groq) |
| `NETWORK_ID` | 网络 ID | ❌ (默认 base-sepolia) |
| `RPC_URL` | RPC 节点 URL | ❌ (可选) |
| `PORT` | Web 服务器端口 | ❌ (默认 3000) |

**注意**：当前版本使用自托管钱包（self-custody），需要提供 `PRIVATE_KEY`。

## Web 前端特性

- 🎨 **现代化 UI** - 美观的聊天界面
- 💬 **实时对话** - 与 AI Agent 自然交互
- 📊 **状态显示** - 钱包地址、网络、LLM 提供者
- 🔄 **清除历史** - 一键清除对话历史
- 📱 **响应式设计** - 支持移动设备

## 开发脚本

| 脚本 | 说明 |
|------|------|
| `npm run chat` | CLI 命令行模式 |
| `npm run server` | 启动 Web 服务器 |
| `npm run dev` | 开发模式 (Web 服务器，自动重载) |
| `npm run dev:chat` | 开发模式 (CLI，自动重载) |
| `npm run build` | 编译 TypeScript |
| `npm run typecheck` | 类型检查 |

## License

MIT
