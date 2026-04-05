#!/usr/bin/env bash
# 2026-04-05 | 新增 | 单独启动 FastAPI 后端
# 功能描述：启动 SHARP predict API 服务（port 8321）。
# 使用方式：./scripts/dev-backend.sh
# 影响范围：仅启动后端服务进程。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
  echo "❌ Python venv not found. Run: ./scripts/setup.sh"
  exit 1
fi

echo "📡 Starting FastAPI backend on http://127.0.0.1:8321 ..."
exec "$VENV_PYTHON" "$PROJECT_ROOT/server/app.py"
