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
- **聊天区域**：显示与 AI Agent 的对话历史
- **输入框**：输入消息，按 Enter 发送，Shift+Enter 换行
- **清除历史**：清除对话历史按钮

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

