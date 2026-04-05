# 2026-04-05 | 新增 | SHARP Web 服务 Docker 镜像
# 功能描述：多阶段构建 — 前端 Node.js 构建 + Python 运行时 + Nginx 静态服务
# 设计思路：
#   Stage 1 (frontend-build): Node 20 构建前端静态文件到 /app/web/dist
#   Stage 2 (runtime): Python 3.13-slim + Nginx，同时运行 FastAPI 后端和 Nginx
# 影响范围：生成约 2-3GB 镜像（含 PyTorch CPU + SHARP 依赖）
# 潜在风险：首次运行时 SHARP 模型 checkpoint (~500MB) 会自动下载到容器内缓存

# ── Stage 1: 前端构建 ──────────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY web/ ./
RUN pnpm build

# ── Stage 2: 运行时 ────────────────────────────────────────────────
FROM python:3.13-slim

# 系统依赖：Nginx + 图片处理库（Pillow 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    libgl1 \
    libglib2.0-0 \
    libjpeg62-turbo \
    libpng16-16 \
    libwebp7 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python 依赖（CPU-only，排除 gsplat 避免 CUDA 编译） ──
COPY requirements-docker.txt ./
RUN pip install --no-cache-dir -r requirements-docker.txt

# ── 项目源码 ──
COPY pyproject.toml ./
COPY src/ ./src/
COPY data/ ./data/
COPY server/ ./server/

# ── 安装 sharp CLI（--no-deps 跳过 gsplat 依赖，CPU predict 不需要它） ──
RUN pip install --no-cache-dir --no-deps -e .

# ── 前端静态文件（从 Stage 1 复制） ──
COPY --from=frontend-build /app/web/dist /app/web/dist

# ── Nginx 配置 ──
COPY docker/nginx.conf /etc/nginx/sites-available/default

# ── 启动脚本 ──
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# ── 创建输出目录 ──
RUN mkdir -p /tmp/sharp-output

EXPOSE 80

CMD ["/app/entrypoint.sh"]
