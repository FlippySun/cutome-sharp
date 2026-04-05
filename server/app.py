"""
2026-04-05 | 新增 | SHARP 预测 API 服务
功能描述：FastAPI 后端接收图片上传，调用 sharp predict CLI 生成 3DGS .ply 文件，
         返回可供前端 viewer 加载的文件路径。
设计思路：
  - 每次预测创建唯一 job_id 目录（/tmp/sharp-output/<job_id>/），隔离不同请求的产物。
  - 通过 subprocess 调用 .venv/bin/sharp predict，复用已有 CLI 逻辑，避免重复实现模型加载。
  - 支持 device 参数（默认 auto 自动选择 mps/cpu），预测完成后返回 .ply 绝对路径。
  - CORS 仅允许 localhost 开发端口，防止意外暴露。
参数与返回值：
  - POST /api/predict：接收 multipart/form-data 图片文件，可选 device 参数。
         返回 JSON { job_id, ply_path, duration_s }。
  - GET /api/health：健康检查。
影响范围：独立服务进程，不修改 sharp 核心代码；前端通过 Vite proxy 调用。
潜在风险：
  - 大图片或高分辨率可能导致预测耗时较长（MPS ~30s，CPU ~2min）。
  - 模型首次运行会自动下载 checkpoint（~500MB），首次请求可能超时。
  - /tmp 输出目录在系统重启后会被清理。
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
LOGGER = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────────────────
# 2026-04-05 | 修复 | sharp CLI 路径自动探测
# 设计思路：优先使用项目 .venv 内的安装（本地开发），
#          回退到系统 PATH 中的 sharp（Docker 部署时安装在 /usr/local/bin/sharp）。
PROJECT_ROOT = Path(__file__).resolve().parent.parent
_venv_sharp = PROJECT_ROOT / ".venv" / "bin" / "sharp"
_system_sharp = shutil.which("sharp")
SHARP_BIN = _venv_sharp if _venv_sharp.exists() else Path(_system_sharp) if _system_sharp else _venv_sharp
OUTPUT_BASE = Path("/tmp/sharp-output")

# 支持的图片扩展名（与 sharp.utils.io.get_supported_image_extensions 一致）
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tiff"}

# ── FastAPI 应用 ──────────────────────────────────────────────────────────────
app = FastAPI(title="SHARP Predict API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    # 2026-04-05 | 修复 | 添加生产域名，允许反代后的请求通过 CORS
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://sharp.zhiz.chat",
        "http://sharp.zhiz.chat",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """健康检查，同时验证 sharp CLI 可达。"""
    sharp_exists = SHARP_BIN.exists()
    return {
        "status": "ok",
        "sharp_bin": str(SHARP_BIN),
        "sharp_available": sharp_exists,
    }


@app.post("/api/predict")
async def predict(
    image: UploadFile = File(..., description="待预测的图片文件"),
    device: str = Form(default="default", description="推理设备：default / cpu / mps / cuda"),
):
    """
    接收图片 → 调用 sharp predict → 返回 .ply 路径。

    参数：
      image: 上传的图片文件（jpg/png/webp/heic 等）
      device: 推理设备选择，默认 auto（优先 mps > cpu）

    返回：
      { job_id, ply_path, duration_s, filename }
    """
    # ── 1. 校验文件类型 ──
    if not image.filename:
        raise HTTPException(status_code=400, detail="文件名为空")

    ext = Path(image.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片格式 '{ext}'，支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    # ── 2. 创建工作目录，保存上传文件 ──
    job_id = uuid.uuid4().hex[:12]
    job_dir = OUTPUT_BASE / job_id
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    input_path = input_dir / image.filename
    content = await image.read()
    input_path.write_bytes(content)
    LOGGER.info("Job %s: saved %s (%.1f KB)", job_id, input_path, len(content) / 1024)

    # ── 3. 调用 sharp predict ──
    cmd = [
        str(SHARP_BIN),
        "predict",
        "-i", str(input_path),
        "-o", str(output_dir),
        "--device", device,
        "--no-render",  # 跳过 CUDA-only 的视频渲染
        "-v",
    ]
    LOGGER.info("Job %s: running %s", job_id, " ".join(cmd))

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 分钟超时
            cwd=str(PROJECT_ROOT),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="预测超时（>10 分钟）")

    duration = time.time() - t0

    if result.returncode != 0:
        LOGGER.error("Job %s: sharp predict failed\nstdout: %s\nstderr: %s",
                      job_id, result.stdout[-500:], result.stderr[-500:])
        raise HTTPException(
            status_code=500,
            detail=f"sharp predict 执行失败 (exit {result.returncode}): {result.stderr[-300:]}",
        )

    # ── 4. 查找输出的 .ply 文件 ──
    ply_files = list(output_dir.glob("*.ply"))
    if not ply_files:
        raise HTTPException(status_code=500, detail="预测完成但未生成 .ply 文件")

    ply_path = ply_files[0]  # 单图片只会生成一个 .ply
    LOGGER.info("Job %s: done in %.1fs → %s (%.1f MB)",
                job_id, duration, ply_path, ply_path.stat().st_size / 1024 / 1024)

    # 2026-04-05 | 优化 | 同时返回绝对路径和 HTTP 可访问的相对 URL
    # 设计思路：本地开发时前端通过 Vite /@fs 加载绝对路径；
    #          Docker 部署时通过 Nginx /output/ 映射加载。
    return {
        "job_id": job_id,
        "ply_path": str(ply_path),
        "ply_url": f"/output/{job_id}/{ply_path.name}",
        "filename": ply_path.name,
        "duration_s": round(duration, 1),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8321, log_level="info")
