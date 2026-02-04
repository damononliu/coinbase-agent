# Web UI 使用指南

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

确保你的 `.env` 文件包含：

```env
PRIVATE_KEY=0x_your_private_key_here
GROQ_API_KEY=gsk_your_groq_key
LLM_PROVIDER=groq
NETWORK_ID=base-sepolia
PORT=3000
```

### 3. 启动服务器

```bash
npm run server
```

### 4. 打开浏览器

访问 `http://localhost:3000`

## 功能特性

### 界面说明

- **顶部状态栏**：显示连接状态、钱包地址、网络、LLM 提供者
- **浏览器钱包**：可连接 MetaMask 显示浏览器钱包地址（仅展示）
- **本地钱包**：创建/导入的钱包仅存储在浏览器本地（localStorage），不上传服务端
- **导出私钥**：只在浏览器弹窗显示，注意环境安全
- **资产列表**：跟踪 Token 与 NFT（基于链上读取）
- **交易历史**：从 ERC20 Transfer 日志读取（仅 Token）
- **发送/收款**：表单驱动的 Agent 交互
- **合约批准**：ERC20 Approve / Allowance
- **地址簿**：常用地址本地保存
- **聊天区域**：显示与 AI Agent 的对话历史
- **输入框**：输入消息，按 Enter 发送，Shift+Enter 换行
- **清除历史**：清除对话历史按钮
- **快捷操作**：刷新余额、复制钱包地址

### API 端点

#### GET `/api/health`
健康检查

#### GET `/api/status`
获取 Agent 状态

#### POST `/api/initialize`
初始化 Agent

#### POST `/api/chat`
发送消息
```json
{
  "message": "你的消息"
}
```

#### POST `/api/clear`
清除对话历史

#### GET `/api/wallet/refresh`
刷新钱包信息（地址/余额/网络）

#### POST `/api/client_wallet`
设置浏览器钱包地址（仅展示）

#### DELETE `/api/client_wallet`
清除浏览器钱包地址

#### GET `/api/client_wallet`
获取浏览器钱包地址

#### GET `/api/token/details`
获取 ERC20 token 元信息（name/symbol/decimals）

#### GET `/api/token/balance`
获取 ERC20 token 余额

#### GET `/api/token/allowance`
获取 ERC20 allowance

#### GET `/api/token/history`
获取 ERC20 Transfer 日志（交易历史）

#### GET `/api/nft/metadata`
获取 NFT 元数据（ERC721/1155）

## 开发模式

使用开发模式启动（自动重载）：

```bash
npm run dev
```

## 故障排除

### 端口被占用

如果 3000 端口被占用，可以通过环境变量修改：

```bash
PORT=3001 npm run server
```

### Agent 初始化失败

1. 检查 `.env` 文件配置是否正确
2. 检查私钥格式是否正确（0x 开头）
3. 检查 API Key 是否有效
4. 查看服务器控制台错误信息

### 前端无法连接

1. 确认服务器已启动
2. 检查浏览器控制台错误信息
3. 确认端口号正确

