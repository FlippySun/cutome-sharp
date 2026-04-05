#!/usr/bin/env bash
# 2026-04-05 | 新增 | 一键安装所有依赖（Python venv + Node modules）
# 功能描述：初始化 Python 虚拟环境并安装后端和 SHARP 依赖，
#          同时安装前端 Node.js 依赖。
# 使用方式：./scripts/setup.sh
# 影响范围：创建 .venv/、安装 pip 包、安装 node_modules/。
# 潜在风险：需要 Python 3.13+、Node.js 18+、pnpm。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📦 SHARP project setup"
echo "   Project root: $PROJECT_ROOT"
echo ""

# ── Python 虚拟环境 ──
VENV_DIR="$PROJECT_ROOT/.venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "🐍 Creating Python venv..."
  python3 -m venv "$VENV_DIR"
fi

VENV_PIP="$VENV_DIR/bin/pip3"
if [ ! -f "$VENV_PIP" ]; then
  echo "🔧 Installing pip in venv..."
  "$VENV_DIR/bin/python" -m ensurepip --upgrade
fi

# ── SHARP 核心依赖 ──
echo "🐍 Installing SHARP Python dependencies..."
"$VENV_PIP" install -r "$PROJECT_ROOT/requirements.txt"

# ── FastAPI 后端依赖 ──
echo "🐍 Installing FastAPI server dependencies..."
"$VENV_PIP" install -r "$PROJECT_ROOT/server/requirements.txt"

echo ""

# ── 前端 Node.js 依赖 ──
echo "🌐 Installing frontend Node.js dependencies..."
cd "$PROJECT_ROOT/web"

if command -v pnpm &>/dev/null; then
  pnpm install
elif command -v npm &>/dev/null; then
  npm install
else
  echo "❌ Neither pnpm nor npm found. Please install Node.js first."
  exit 1
fi

echo ""
echo "✅ Setup complete!"
echo "   Run ./scripts/dev-all.sh to start the development environment."
