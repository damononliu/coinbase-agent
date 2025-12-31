#!/bin/bash
# 启动 Coinbase AgentKit Web 服务器

cd "$(dirname "$0")"

echo "🚀 正在启动服务器..."
echo ""

# 检查端口是否被占用
if lsof -ti:3000 > /dev/null 2>&1; then
  echo "⚠️  端口 3000 已被占用，正在停止旧进程..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null
  sleep 1
fi

# 启动服务器
npm run server

