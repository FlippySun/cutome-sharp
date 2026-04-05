/*
 * 2026-04-05 | 新增 | SHARP 网页预览主界面
 * 功能描述：提供默认样例加载、本地绝对路径加载、splat 文件上传、
 *          **图片上传 → SHARP predict → 自动 3DGS 预览** 全流程，驱动网页预览。
 * 设计思路：React 只负责数据源选择、状态管理与错误反馈；3D Gaussian 渲染下沉到 SplatViewer，
 *          避免在 UI 层手写 Three.js 资源生命周期。图片上传通过 /api/predict 代理至 FastAPI
 *          后端，后端调用 sharp predict CLI 生成 .ply 后返回路径，前端自动加载。
 * 参数与返回值：App 无外部参数；返回预览页面节点。
 * 影响范围：仅影响 web/ 子工程；上游为 SHARP 输出的 .ply/.splat/.ksplat 文件或图片，
 *          下游为浏览器中的交互预览。
 * 潜在风险：
 *   - 默认示例路径依赖本地 `/tmp/sharp-predict-sample/teaser.ply`
 *   - 图片 → PLY 转换需要后端 FastAPI 服务运行在 port 8321
 *   - 首次预测会下载模型 checkpoint (~500MB)
 */
import {
  type ChangeEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SceneFormat,
  type SceneFormatValue,
} from "@mkkellogg/gaussian-splats-3d";
import { Camera, FolderOpen, Grid3x3, Image, Upload } from "lucide-react";

import { SplatViewer, type ViewerSource } from "./components/SplatViewer";
import { SceneStatsOverlay, useStatsToggle } from "./components/SceneStats";

const DEFAULT_LOCAL_SAMPLE_PATH = "/tmp/sharp-predict-sample/teaser.ply";
const DEFAULT_REMOTE_SAMPLE_URL =
  "/@fs/private/tmp/sharp-predict-sample/teaser.ply";
// 2026-04-05 | 新增 | 默认示例图片（位于 web/public/teaser.png，Vite 静态服务）
const DEFAULT_EXAMPLE_IMAGE = "/teaser.png";

function normalizeLocalPathToFsUrl(inputPath: string): string {
  const trimmedPath = inputPath.trim();

  if (trimmedPath.startsWith("/@fs/")) {
    return trimmedPath;
  }

  if (
    trimmedPath.startsWith("http://") ||
    trimmedPath.startsWith("https://") ||
    trimmedPath.startsWith("blob:")
  ) {
    return trimmedPath;
  }

  const withoutFileScheme = trimmedPath.startsWith("file://")
    ? trimmedPath.slice("file://".length)
    : trimmedPath;
  const normalizedAbsolutePath = withoutFileScheme.startsWith("/tmp/")
    ? withoutFileScheme.replace(/^\/tmp\//, "/private/tmp/")
    : withoutFileScheme;

  if (!normalizedAbsolutePath.startsWith("/")) {
    return normalizedAbsolutePath;
  }

  return `/@fs${normalizedAbsolutePath}`;
}

function detectSceneFormat(fileName: string): SceneFormatValue | null {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName.endsWith(".ply")) {
    return SceneFormat.Ply;
  }

  if (normalizedName.endsWith(".splat")) {
    return SceneFormat.Splat;
  }

  if (normalizedName.endsWith(".ksplat")) {
    return SceneFormat.KSplat;
  }

  if (normalizedName.endsWith(".spz")) {
    return SceneFormat.Spz;
  }

  return null;
}

function createPathSource(inputPath: string): ViewerSource | null {
  const format = detectSceneFormat(inputPath);

  if (format === null) {
    return null;
  }

  return {
    id: `path:${inputPath}`,
    kind: "path",
    label: inputPath,
    url: normalizeLocalPathToFsUrl(inputPath),
    format,
  };
}

function createUploadSource(
  file: File,
  fileData: ArrayBuffer,
): ViewerSource | null {
  const format = detectSceneFormat(file.name);

  if (format === null) {
    return null;
  }

  return {
    id: `upload:${file.name}:${file.size}:${file.lastModified}`,
    kind: "upload",
    label: file.name,
    fileData,
    format,
  };
}

/*
 * 2026-04-05 | 新增 | 图片转换进度状态
 * idle: 等待用户上传图片
 * uploading: 图片上传中
 * predicting: 后端正在运行 SHARP predict
 * done: 转换完成
 * error: 转换失败
 */
type PredictStatus = "idle" | "uploading" | "predicting" | "done" | "error";

// 支持的图片扩展名（与后端 SUPPORTED_EXTENSIONS 保持一致）
const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.tiff";

export default function App() {
  const initialSource = useMemo(
    () =>
      createPathSource(DEFAULT_LOCAL_SAMPLE_PATH) ?? {
        id: "fallback-default-sample",
        kind: "path" as const,
        label: DEFAULT_LOCAL_SAMPLE_PATH,
        url: DEFAULT_REMOTE_SAMPLE_URL,
        format: SceneFormat.Ply,
      },
    [],
  );
  const [inputPath, setInputPath] = useState(DEFAULT_LOCAL_SAMPLE_PATH);
  const [activeSource, setActiveSource] = useState<ViewerSource | null>(
    initialSource,
  );
  const [statusText, setStatusText] = useState("等待加载数据源");
  // 2026-04-05 | 新增 | 3D 空间网格开关，默认关闭
  const [showGrid, setShowGrid] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // ── 图片 → PLY 转换状态 ──
  const [predictStatus, setPredictStatus] = useState<PredictStatus>("idle");
  const [predictMessage, setPredictMessage] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  function handleLoadDefaultSample() {
    setErrorText(null);
    setInputPath(DEFAULT_LOCAL_SAMPLE_PATH);
    setActiveSource({
      id: "default-local-sample",
      kind: "path",
      label: DEFAULT_LOCAL_SAMPLE_PATH,
      url: DEFAULT_REMOTE_SAMPLE_URL,
      format: SceneFormat.Ply,
    });
  }

  function handleLoadPath() {
    const source = createPathSource(inputPath);

    if (!source) {
      setErrorText("仅支持 .ply、.splat、.ksplat 和 .spz 格式的文件");
      return;
    }

    setErrorText(null);
    setActiveSource(source);
  }

  async function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileData = await file.arrayBuffer();
    const source = createUploadSource(file, fileData);

    if (!source) {
      setErrorText("上传文件必须为 .ply、.splat、.ksplat 或 .spz 格式");
      event.target.value = "";
      return;
    }

    setErrorText(null);
    setActiveSource(source);
    event.target.value = "";
  }

  // 2026-04-05 | 新增 | 图片上传 → SHARP predict → 自动加载 .ply
  // 功能描述：选择图片后通过 /api/predict 调用后端，后端运行 sharp predict 生成 .ply，
  //          返回路径后自动加载到 viewer。
  // 设计思路：使用 FormData 上传图片，轮询-等待模式（实际是同步等待后端响应），
  //          转换过程中展示进度状态防止用户困惑。
  // 影响范围：新增前端交互流程；依赖后端 /api/predict 端点。
  // 潜在风险：大图片上传或模型首次下载可能导致长时间等待；超时设为 10 分钟。
  const handleImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // 显示图片预览
      const previewUrl = URL.createObjectURL(file);
      setImagePreviewUrl(previewUrl);

      setPredictStatus("uploading");
      setPredictMessage(
        `正在上传 ${file.name}（${(file.size / 1024).toFixed(0)} KB）…`,
      );
      setErrorText(null);

      try {
        const formData = new FormData();
        formData.append("image", file);

        setPredictStatus("predicting");
        setPredictMessage(
          `正在对 ${file.name} 运行 SHARP 预测… 耗时约 30秒~2分钟`,
        );

        const response = await fetch("/api/predict", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          const detail = errorData?.detail || `HTTP ${response.status}`;
          throw new Error(detail);
        }

        const data = await response.json();
        const { ply_path, duration_s, filename } = data as {
          ply_path: string;
          duration_s: number;
          filename: string;
        };

        setPredictStatus("done");
        setPredictMessage(
          `转换完成：${filename}（耗时 ${duration_s}秒），正在自动加载…`,
        );

        // 自动加载生成的 .ply 到 viewer
        const source = createPathSource(ply_path);
        if (source) {
          setInputPath(ply_path);
          setActiveSource(source);
        }
      } catch (err) {
        setPredictStatus("error");
        const msg = err instanceof Error ? err.message : "Unknown error";
        setPredictMessage(`预测失败：${msg}`);
        setErrorText(msg);
      } finally {
        // 清理预览 URL 和 input
        URL.revokeObjectURL(previewUrl);
        if (imageInputRef.current) {
          imageInputRef.current.value = "";
        }
      }
    },
    [],
  );

  // 2026-04-05 | 新增 | 3D 场景监控 HUD（H 键切换显示/隐藏）
  // 优化：stats 数据通过 pub-sub 直接写入 DOM，不经过 React state
  const { visible: statsVisible } = useStatsToggle(true);

  const sourceSummary = activeSource
    ? `${activeSource.kind === "upload" ? "上传" : "路径"} · ${activeSource.label}`
    : "尚未选择数据源";

  return (
    <main className="app-shell">
      <section className="control-panel">
        <div>
          <p className="eyebrow">SHARP 高斯预览</p>
          <h1>本地 3DGS 查看器</h1>
          <p className="panel-copy">
            上传图片自动生成 3D 高斯溢出场景，或直接加载已有的 <code>.ply</code>{" "}
            文件。
          </p>
        </div>

        {/* ── 图片上传 → PLY 转换 ── */}
        <div className="control-group highlight-group">
          <label htmlFor="image-upload" className="label-with-icon">
            <Image size={16} />
            上传图片 → 生成 3DGS
          </label>
          <p className="hint-text">
            上传照片后 SHARP 将自动预测并生成 3D 高斯溢出场景。 需要 API
            服务运行在端口 8321。
          </p>
          <div className="inline-row">
            <input
              ref={imageInputRef}
              id="image-upload"
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={handleImageUpload}
              disabled={
                predictStatus === "uploading" || predictStatus === "predicting"
              }
            />
          </div>
          {/* 图片预览 + 转换状态 */}
          {predictStatus !== "idle" ? (
            <div className="predict-status-area">
              {imagePreviewUrl && (
                <img
                  src={imagePreviewUrl}
                  alt="上传预览"
                  className="image-preview"
                />
              )}
              {predictMessage && (
                <p className={`predict-message ${predictStatus}`}>
                  {predictStatus === "predicting" && (
                    <span className="spinner" />
                  )}
                  {predictMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="example-image-area">
              <p className="hint-text">默认示例图片：</p>
              <img
                src={DEFAULT_EXAMPLE_IMAGE}
                alt="默认示例 - teaser.png"
                className="image-preview"
              />
            </div>
          )}
        </div>

        <hr className="section-divider" />

        {/* ── 直接加载 .ply 路径 ── */}
        <div className="control-group">
          <label htmlFor="source-path" className="label-with-icon">
            <FolderOpen size={16} />
            通过本地路径加载 .ply
          </label>
          <div className="inline-row">
            <input
              id="source-path"
              value={inputPath}
              onChange={(event) => setInputPath(event.target.value)}
              placeholder="/tmp/sharp-predict-sample/teaser.ply"
            />
            <button type="button" onClick={handleLoadPath}>
              加载路径
            </button>
          </div>
          <p className="hint-text">
            本地绝对路径会自动转换为 Vite <code>/@fs</code> URL。
          </p>
        </div>

        {/* ── 上传已有 splat 文件 ── */}
        <div className="control-group">
          <label htmlFor="upload-file" className="label-with-icon">
            <Upload size={16} />
            上传 Splat 文件
          </label>
          <div className="inline-row">
            <input
              id="upload-file"
              type="file"
              accept=".ply,.splat,.ksplat,.spz"
              onChange={handleUploadChange}
            />
            <button type="button" onClick={handleLoadDefaultSample}>
              加载示例
            </button>
          </div>
        </div>

        {/* ── 视图控制 ── */}
        <div className="control-group">
          <label className="label-with-icon">
            <Camera size={16} />
            视图控制
          </label>
          <div className="inline-row">
            <button
              type="button"
              className={`toggle-btn ${showGrid ? "active" : ""}`}
              onClick={() => setShowGrid((v) => !v)}
            >
              <Grid3x3 size={14} />
              网格 {showGrid ? "已开" : "已关"}
            </button>
          </div>
        </div>

        {/* ── 状态面板 ── */}
        <dl className="status-grid">
          <div>
            <dt>当前数据源</dt>
            <dd>{sourceSummary}</dd>
          </div>
          <div>
            <dt>查看器状态</dt>
            <dd>{statusText}</dd>
          </div>
        </dl>

        {errorText ? <p className="message error">{errorText}</p> : null}
      </section>

      <section className="viewer-panel">
        <SplatViewer
          source={activeSource}
          onStatusChange={setStatusText}
          onErrorChange={setErrorText}
          showGrid={showGrid}
        />
        <SceneStatsOverlay visible={statsVisible} />
      </section>
    </main>
  );
}
