#!/usr/bin/env bash
# 2026-04-05 | 新增 | Docker 容器启动脚本
# 功能描述：同时启动 Nginx（前端）和 FastAPI（后端）
# 设计思路：Nginx 在前台运行之前，先后台启动 FastAPI；
#          使用 trap 捕获退出信号，确保两个进程都能优雅关闭。
# 影响范围：容器内进程管理
# 潜在风险：无已知风险

set -euo pipefail

echo "🚀 Starting SHARP Web Service..."
echo "   FastAPI backend on :8321"
echo "   Nginx frontend on :80"

# ── 启动 FastAPI 后端 ──
python /app/server/app.py &
BACKEND_PID=$!

# 等待后端就绪
echo "⏳ Waiting for backend to start..."
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:8321/api/health > /dev/null 2>&1; then
        echo "✅ Backend is ready!"
        break
    fi
    sleep 1
done

# ── 启动 Nginx ──
echo "🌐 Starting Nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!

# ── 信号处理 ──
cleanup() {
    echo "🛑 Shutting down..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$NGINX_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    echo "👋 All services stopped."
}
trap cleanup EXIT INT TERM

# 等待任一进程退出
wait
