#!/usr/bin/env bash
# 2026-04-05 | 新增 | 单独启动 Vite 前端开发服务器
# 功能描述：启动 Vite dev server（port 5173）。
# 使用方式：./scripts/dev-frontend.sh
# 影响范围：仅启动前端开发服务器。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$PROJECT_ROOT/web/node_modules" ]; then
  echo "❌ Node modules not found. Run: ./scripts/setup.sh"
  exit 1
fi

echo "🌐 Starting Vite frontend on http://127.0.0.1:5173 ..."
cd "$PROJECT_ROOT/web"
exec npx vite --host 127.0.0.1 --port 5173
