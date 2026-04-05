/*
 * 2026-04-05 | 新增 | 3DGS 预览组件
 * 功能描述：通过 react-three-fiber 挂接 GaussianSplats3D DropInViewer，并负责文件加载、替换与资源清理。
 * 设计思路：使用 R3F 的场景/相机/控制器承载交互，而将 3D Gaussian 的真实渲染交给 DropInViewer；路径资源走公开 URL 加载，上传资源走文件缓冲区转 SplatBuffer，再挂入 viewer，避免依赖 blob URL 的格式猜测。
 * 参数与返回值：`source` 描述待加载的资源 URL 与格式；`onStatusChange` 与 `onErrorChange` 用于向上游同步加载状态与错误。组件返回可交互的 Canvas 或空状态视图。
 * 影响范围：仅影响 web/ 子工程的浏览器预览；上游为 App 提供的数据源描述，下游为用户在网页中的相机交互与加载反馈。
 * 潜在风险：第三方 viewer 的内部 API 由库版本控制；当前实现除公开 DropInViewer 生命周期外，还依赖 Viewer.addSplatBuffers 完成上传文件注入，升级时需要回归验证。
 */
import { useEffect, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  DropInViewer,
  KSplatLoader,
  PlyLoader,
  SceneFormat,
  SplatLoader,
  SpzLoader,
  type SceneFormatValue,
  type SplatBuffer,
} from "@mkkellogg/gaussian-splats-3d";

import { KeyboardControls } from "./KeyboardControls";
import { SceneStatsCollector } from "./SceneStats";

export type ViewerSource =
  | {
      id: string;
      kind: "path";
      label: string;
      url: string;
      format: SceneFormatValue;
    }
  | {
      id: string;
      kind: "upload";
      label: string;
      fileData: ArrayBuffer;
      format: SceneFormatValue;
    };

type SplatViewerProps = {
  source: ViewerSource | null;
  onStatusChange: (statusText: string) => void;
  onErrorChange: (errorText: string | null) => void;
  showGrid?: boolean;
};

const DEFAULT_ALPHA_THRESHOLD = 1;
const DEFAULT_COMPRESSION_LEVEL = 1;

async function loadUploadedSplatBuffer(
  source: Extract<ViewerSource, { kind: "upload" }>,
): Promise<SplatBuffer> {
  // 上传文件无法依赖 URL 后缀做格式判断，因此这里显式按扩展名选择对应 loader，
  // 保证浏览器本地选择的 .ply/.splat/.ksplat/.spz 都能转成 viewer 可接受的 SplatBuffer。
  switch (source.format) {
    case SceneFormat.Ply:
      return PlyLoader.loadFromFileData(
        source.fileData,
        DEFAULT_ALPHA_THRESHOLD,
        DEFAULT_COMPRESSION_LEVEL,
        true,
        0,
      );
    case SceneFormat.Splat:
      return SplatLoader.loadFromFileData(
        source.fileData,
        DEFAULT_ALPHA_THRESHOLD,
        DEFAULT_COMPRESSION_LEVEL,
        true,
      );
    case SceneFormat.KSplat:
      return KSplatLoader.loadFromFileData(source.fileData);
    case SceneFormat.Spz:
      return SpzLoader.loadFromFileData(
        source.fileData,
        DEFAULT_ALPHA_THRESHOLD,
        DEFAULT_COMPRESSION_LEVEL,
        true,
        0,
      );
    default:
      throw new Error("不支持的上传文件格式");
  }
}

/*
 * 2026-04-05 | 修复 | DropInViewer 生命周期竞态
 * 根因：useMemo 按 source.id 缓存 viewer，useEffect 按 source 对象引用触发，
 *   同一 id 但新对象引用时 effect 重跑 → dispose 已有 viewer → 再调 addSplatScene → 崩溃。
 * 修复：viewer 改用 useRef（一次创建、一次销毁），effect 依赖为空数组。
 *   因为父组件已通过 key={source.id} 保证 source 身份变化时整个组件重新挂载，
 *   所以 effect 仅需处理单次 mount/unmount 周期，无需做 dispose-recreate。
 * 影响范围：仅此组件内部生命周期；上游 App 与下游 Canvas 无需修改。
 * 潜在风险：无已知风险。
 */
type ViewerPrimitiveProps = {
  source: ViewerSource;
  onStatusChange: (statusText: string) => void;
  onErrorChange: (errorText: string | null) => void;
};

function ViewerPrimitive({
  source,
  onStatusChange,
  onErrorChange,
}: ViewerPrimitiveProps) {
  // useRef 持有 viewer 实例，确保同一挂载周期内只创建一次
  const viewerRef = useRef<DropInViewer | null>(null);
  if (!viewerRef.current) {
    // 2026-04-05 | 修复+优化 | 排序性能
    // gpuAcceleratedSort 在 DropIn 模式下有 bug（drawRange.count=0，splat 不渲染），
    //   已确认即使 SharedArrayBuffer 可用也无法修复，必须禁用。
    // CPU 排序优化策略：
    //   - sharedMemoryForWorkers: true → 零拷贝共享排序索引（需 COOP/COEP 头）。
    //   - integerBasedSort: true → 整数距离计算，减少浮点开销。
    //   - enableSIMDInSort: true → WASM SIMD 加速排序（浏览器支持时）。
    //   - dynamicScene: false → 静态场景，跳过不必要的重排序。
    // 影响范围：排序性能；1.17M splat 预期 ~25-40FPS。
    // 潜在风险：若浏览器不支持 SIMD，库自动回退到标量排序。
    viewerRef.current = new DropInViewer({
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: true,
      ...({
        integerBasedSort: true,
        enableSIMDInSort: true,
        dynamicScene: false,
      } as Record<string, unknown>),
    });
  }
  const viewer = viewerRef.current;

  useEffect(() => {
    let isMounted = true;

    onErrorChange(null);
    onStatusChange(`正在加载 ${source.label}…`);

    const loadPromise =
      source.kind === "path"
        ? viewer.addSplatScene(source.url, {
            format: source.format,
            showLoadingUI: false,
            splatAlphaRemovalThreshold: DEFAULT_ALPHA_THRESHOLD,
          })
        : loadUploadedSplatBuffer(source).then((splatBuffer) =>
            viewer.viewer.addSplatBuffers(
              [splatBuffer],
              [{ splatAlphaRemovalThreshold: DEFAULT_ALPHA_THRESHOLD }],
              true,
              false,
              false,
              true,
              false,
            ),
          );

    loadPromise
      .then(() => {
        if (!isMounted) {
          return;
        }

        onStatusChange(`已加载 ${source.label}`);
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : "未知渲染错误";
        onErrorChange(errorMessage);
        onStatusChange(`加载失败：${source.label}`);
      });

    return () => {
      isMounted = false;
      viewer.dispose();
    };
    // 组件通过 key={source.id} 挂载，effect 只需运行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-04-05 | 修复 | 场景坐标系翻转
  // 根因：SHARP 输出的 PLY 使用 COLMAP/OpenCV 坐标系（Y 朝下，Z 朝前），
  //   Three.js 使用 Y-up 坐标系，直接加载会导致场景上下颠倒。
  // 修复：用 Three.js group 绕 X 轴旋转 180°（π 弧度）包裹 viewer 对象。
  // 影响范围：仅影响 splat 场景方向；不影响网格/坐标轴辅助线。
  return (
    <>
      <group rotation={[Math.PI, 0, 0]}>
        <primitive object={viewer} dispose={null} />
      </group>
      <SceneStatsCollector viewerRef={viewerRef} />
    </>
  );
}

export function SplatViewer({
  source,
  onStatusChange,
  onErrorChange,
  showGrid = false,
}: SplatViewerProps) {
  if (!source) {
    return (
      <div className="viewer-empty-state">
        <h2>未选择场景</h2>
        <p>请选择 SHARP 输出文件或上传兼容的 Splat 场景文件开始预览。</p>
      </div>
    );
  }

  return (
    // 2026-04-05 | 修复 | 初始相机位置和朝向
    // 场景经 <group rotation={[PI,0,0]}> 绕 X 轴翻转 180° 后，
    //   原始正面（COLMAP +Z）变为 Three.js -Z 方向。
    // 相机放在 [0, 1, 4]（+Z 侧），lookAt 原点 → 朝 -Z 看，正对场景正面。
    <Canvas
      camera={{ position: [0, 1, 4], fov: 55, near: 0.01, far: 1000 }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#020617"]} />
      {/* 2026-04-05 | 修改 | 网格默认关闭，可通过 UI 开关控制；axesHelper 已移除 */}
      {showGrid && (
        <gridHelper
          args={[8, 8, "#1d4ed8", "#1e293b"]}
          position={[0, -1.5, 0]}
        />
      )}
      <ViewerPrimitive
        key={source.id}
        source={source}
        onStatusChange={onStatusChange}
        onErrorChange={onErrorChange}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      <KeyboardControls speed={2.0} shiftMultiplier={3.0} />
    </Canvas>
  );
}
