# cutome-sharp

[![Project Page](https://img.shields.io/badge/Project-Page-green)](https://apple.github.io/ml-sharp/)
[![arXiv](https://img.shields.io/badge/arXiv-2512.10685-b31b1b.svg)](https://arxiv.org/abs/2512.10685)
[![Python](https://img.shields.io/badge/Python-3.13-blue)](https://python.org)

个人维护的 [apple/ml-sharp](https://github.com/apple/ml-sharp) fork。

给它一张照片，30 秒内（GPU）吐出一个可实时渲染的 3D Gaussian Splatting 场景。不需要深度相机，不需要多角度拍摄，就一张普通照片。

在 Apple 原版 CLI 基础上，这个 fork 加了三件事：一个跑在浏览器里的 3DGS 查看器、一个 FastAPI 预测接口、还有 Docker 一键部署配置。模型代码没动过，新增内容都在 `server/`、`web/`、`scripts/` 和 `docker-compose.yml` 里。

---

## 目录

- [这个 fork 加了什么](#这个-fork-加了什么)
- [安装](#安装)
- [CLI 用法](#cli-用法)
- [网页查看器](#网页查看器)
- [Docker 部署](#docker-部署)
- [项目结构](#项目结构)
- [坐标系说明](#坐标系说明)
- [原论文 & 引用](#原论文--引用)
- [License](#license)

---

## 这个 fork 加了什么

| 功能                                   | 上游 ml-sharp |            本 fork             |
| -------------------------------------- | :-----------: | :----------------------------: |
| CLI 预测                               |      ✅       |               ✅               |
| 视频渲染（CUDA）                       |      ✅       |               ✅               |
| 浏览器 3DGS 查看器                     |      ❌       |               ✅               |
| 图片上传 → 自动预测 → 实时预览         |      ❌       |               ✅               |
| `.splat` / `.ksplat` / `.spz` 文件支持 |      ❌       |               ✅               |
| FastAPI 预测接口                       |      ❌       |               ✅               |
| Docker 一键部署                        |      ❌       |               ✅               |
| CPU / MPS 稳定运行                     |     部分      | ✅（修复了无 CUDA 时崩溃问题） |

---

## 安装

需要 Python 3.13。

```bash
# 创建虚拟环境（推荐 uv）
uv venv --python 3.13 .venv
source .venv/bin/activate

# 或用 conda
conda create -n sharp python=3.13 && conda activate sharp

# 安装依赖
pip install -r requirements.txt

# 验证安装
sharp --help
```

模型权重（~500 MB）首次运行时自动下载，缓存到 `~/.cache/torch/hub/checkpoints/`。

也可以手动下载：

```bash
wget https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt
```

---

## CLI 用法

### 预测（CPU / MPS / CUDA 均支持）

```bash
sharp predict -i /path/to/photo.jpg -o /path/to/output/
```

输出是 `.ply` 格式的 3D Gaussian Splat 文件，兼容常见的 3DGS 渲染器。

指定手动下载的模型权重：

```bash
sharp predict -i photo.jpg -o output/ -c sharp_2572gikvuh.pt
```

### 渲染视频（仅 CUDA）

```bash
# 预测 + 渲染一步完成
sharp predict -i photo.jpg -o output/ --render

# 或从已有的 .ply 出发
sharp render -i output/ -o renderings/
```

gsplat 渲染器第一次启动会初始化一段时间，不是卡死。

---

## 网页查看器

浏览器里直接预览 3DGS 场景，不用装任何桌面软件。

**支持四种使用方式：**

1. **上传图片 → 自动预测 → 实时加载**（需要后端服务）
2. 输入本地 `.ply` 文件路径直接加载（开发模式）
3. 上传已有的 `.ply` / `.splat` / `.ksplat` / `.spz` 文件
4. 自动加载默认示例（`teaser.ply`）

**快捷键：** `H` 键切换场景统计 HUD（高斯点数、帧率、内存等）。

### 本地开发

```bash
# 一条命令同时启动后端（8321）和前端（5173）
./scripts/dev-all.sh
```

打开 http://127.0.0.1:5173 即可。

两个服务分别是：

- **前端**：Vite 开发服务器，React 19 + Three.js + `@mkkellogg/gaussian-splats-3d`
- **后端**：FastAPI（`server/app.py`），接收图片 → 调用 `sharp predict` → 返回 `.ply` 路径

分开启动：

```bash
./scripts/dev-backend.sh   # 只启后端
./scripts/dev-frontend.sh  # 只启前端
```

前端依赖：

```bash
cd web && pnpm install
```

### 图片上传流程

前端把图片 POST 到 `/api/predict`，后端接收后：

1. 保存图片到 `/tmp/sharp-output/<job_id>/input/`
2. 调用 `sharp predict` 生成 `.ply`
3. 返回 `{ job_id, ply_path, ply_url, duration_s }`
4. 前端自动加载生成的场景

预测时间参考：MPS（Apple Silicon）约 30 秒，CPU 约 1–3 分钟，首次运行需额外等待模型下载。

---

## Docker 部署

```bash
docker compose up --build
```

访问 http://localhost:8380。

Nginx 在容器内反代前后端，模型权重通过 named volume 持久化，重启不用重新下载。

资源要求：推理峰值内存约 6–7 GB（CPU），预留 2 GB 起步。生产部署建议给 7 GB 以上内存限制，否则大图片容易 OOM。

```yaml
# docker-compose.yml 中的关键配置
deploy:
  resources:
    limits:
      memory: 7G
    reservations:
      memory: 2G
```

自定义端口或设备：

```bash
SHARP_DEVICE=mps docker compose up
```

---

## 项目结构

```
cutome-sharp/
├── src/sharp/              # 模型核心代码（来自上游）
│   ├── cli/                # CLI 入口（predict + render）
│   ├── models/             # 神经网络架构
│   └── utils/              # IO、几何工具
├── server/
│   └── app.py              # FastAPI 预测 API（本 fork 新增）
├── web/                    # 浏览器查看器（本 fork 新增）
│   └── src/
│       ├── App.tsx          # 主界面：数据源选择 / 上传 / 预测流程
│       └── components/     # SplatViewer（Three.js 封装）、SceneStats HUD
├── scripts/
│   ├── setup.sh            # 首次环境初始化
│   ├── dev-all.sh          # 一键启动前后端开发服务器
│   ├── dev-backend.sh      # 单独启动后端
│   ├── dev-frontend.sh     # 单独启动前端
│   └── predict.sh          # CLI 预测快捷脚本
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── requirements.txt
```

---

## 坐标系说明

SHARP 使用 OpenCV 坐标系：x 向右，y 向下，z 向前。场景中心大致在 `(0, 0, +z)`。

接入第三方渲染器时可能需要旋转或缩放以对齐场景中心，具体取决于渲染器的坐标约定。

---

## 原论文 & 引用

原始模型来自 Apple 研究团队，论文：

> **Sharp Monocular View Synthesis in Less Than a Second**
> Lars Mescheder, Wei Dong, Shiwei Li, Xuyang Bai, Marcel Santos, Peiyun Hu, Bruno Lecouat, Mingmin Zhen, Amaël Delaunoy, Tian Fang, Yanghai Tsin, Stephan Richter, Vladlen Koltun
> [arXiv:2512.10685](https://arxiv.org/abs/2512.10685) · [Project Page](https://apple.github.io/ml-sharp/)

```bibtex
@inproceedings{Sharp2025:arxiv,
  title   = {Sharp Monocular View Synthesis in Less Than a Second},
  author  = {Lars Mescheder and Wei Dong and Shiwei Li and Xuyang Bai and Marcel Santos
             and Peiyun Hu and Bruno Lecouat and Mingmin Zhen and Ama\"{e}l Delaunoy
             and Tian Fang and Yanghai Tsin and Stephan R. Richter and Vladlen Koltun},
  journal = {arXiv preprint arXiv:2512.10685},
  year    = {2025},
  url     = {https://arxiv.org/abs/2512.10685},
}
```

---

## Acknowledgements

模型代码依赖的开源组件详见 [ACKNOWLEDGEMENTS](ACKNOWLEDGEMENTS)。

---

## License

代码：[LICENSE](LICENSE)　｜　模型权重：[LICENSE_MODEL](LICENSE_MODEL)
