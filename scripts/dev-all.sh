#!/usr/bin/env bash
# 2026-04-05 | 新增 | 一键启动开发环境（后端 API + 前端 Vite）
# 功能描述：同时启动 FastAPI 后端（port 8321）和 Vite 前端（port 5173），
#          两个进程后台并行运行，Ctrl+C 一次性终止全部。
# 使用方式：./scripts/dev-all.sh
# 影响范围：仅启动开发服务器，不修改任何文件。
# 潜在风险：端口冲突时会启动失败；请确保 8321 和 5173 未被占用。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"

echo "🚀 Starting SHARP development environment..."
echo "   Project root: $PROJECT_ROOT"
echo ""

# ── 检查依赖 ──
if [ ! -f "$VENV_PYTHON" ]; then
  echo "❌ Python venv not found at $VENV_PYTHON"
  echo "   Run: ./scripts/setup.sh first"
  exit 1
fi

if [ ! -d "$PROJECT_ROOT/web/node_modules" ]; then
  echo "❌ Node modules not found. Run: ./scripts/setup.sh first"
  exit 1
fi

# ── 启动后端 API ──
echo "📡 Starting FastAPI backend on http://127.0.0.1:8321 ..."
"$VENV_PYTHON" "$PROJECT_ROOT/server/app.py" &
BACKEND_PID=$!

# ── 启动前端 Vite ──
echo "🌐 Starting Vite frontend on http://127.0.0.1:5173 ..."
cd "$PROJECT_ROOT/web"
npx vite --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!

echo ""
echo "✅ Both servers started:"
echo "   Frontend: http://127.0.0.1:5173"
echo "   Backend:  http://127.0.0.1:8321"
echo "   Press Ctrl+C to stop all."
echo ""

# ── 捕获退出信号，清理子进程 ──
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  echo "👋 All servers stopped."
}
trap cleanup EXIT INT TERM

# 等待任一子进程退出
wait
