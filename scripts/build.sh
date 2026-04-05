#!/usr/bin/env bash
# 2026-04-05 | 新增 | 构建前端生产产物
# 功能描述：运行 TypeScript 类型检查 + Vite 生产构建，输出到 web/dist/。
# 使用方式：./scripts/build.sh
# 影响范围：生成 web/dist/ 目录下的静态文件。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$PROJECT_ROOT/web/node_modules" ]; then
  echo "❌ Node modules not found. Run: ./scripts/setup.sh"
  exit 1
fi

echo "🔨 Building frontend production bundle..."
cd "$PROJECT_ROOT/web"
npx tsc --noEmit
npx vite build

echo ""
echo "✅ Build complete! Output: web/dist/"
