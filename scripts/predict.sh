#!/usr/bin/env bash
# 2026-04-05 | 新增 | 命令行快捷预测脚本
# 功能描述：封装 sharp predict CLI，简化参数传递。
# 使用方式：
#   ./scripts/predict.sh -i <图片路径> [-o <输出目录>] [--device mps|cpu|cuda]
# 示例：
#   ./scripts/predict.sh -i data/teaser.jpg
#   ./scripts/predict.sh -i data/teaser.jpg -o /tmp/my-output --device cpu
# 影响范围：调用 .venv/bin/sharp predict，输出 .ply 文件到指定目录。
# 潜在风险：首次运行会自动下载模型 checkpoint (~500MB)。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARP_BIN="$PROJECT_ROOT/.venv/bin/sharp"

if [ ! -f "$SHARP_BIN" ]; then
  echo "❌ sharp CLI not found. Run: ./scripts/setup.sh"
  exit 1
fi

# 如果没有传 -o 参数，默认输出到 /tmp/sharp-output/
OUTPUT_DIR="/tmp/sharp-output"
HAS_OUTPUT=false
for arg in "$@"; do
  if [ "$arg" = "-o" ] || [ "$arg" = "--output-path" ]; then
    HAS_OUTPUT=true
    break
  fi
done

if [ "$HAS_OUTPUT" = false ]; then
  echo "📁 No output path specified, using default: $OUTPUT_DIR"
  exec "$SHARP_BIN" predict "$@" -o "$OUTPUT_DIR" --no-render -v
else
  exec "$SHARP_BIN" predict "$@" --no-render -v
fi
