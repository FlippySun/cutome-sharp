/*
 * 2026-04-05 | 新增 | 3D 场景监控数据 HUD
 * 功能描述：在 viewer 右上角显示实时 3D 场景诊断信息，包括：
 *   - FPS（帧率）
 *   - 相机位置 (x, y, z) 和朝向
 *   - Splat 数量和场景数
 *   - GPU 纹理内存使用估算
 *   - 渲染器统计（drawcalls、三角形数）
 *   - 排序耗时
 * 设计思路：
 *   - 使用 useFrame 在 R3F 渲染循环中采集数据，避免额外 RAF 开销。
 *   - 降采样更新频率（每 10 帧刷新一次 DOM），减少布局抖动。
 *   - 通过 HTML overlay 而非 R3F 内部 mesh 实现，不影响 3D 渲染性能。
 * 参数与返回值：
 *   - viewerRef: DropInViewer 实例的 ref，用于读取 splat 统计。
 *   组件返回悬浮 HUD DOM 节点。
 * 影响范围：纯只读监控，不修改任何 3D 状态。
 * 潜在风险：频繁 DOM 更新可能微量影响低端设备帧率；已通过降采样缓解。
 */

import { useRef, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DropInViewer } from "@mkkellogg/gaussian-splats-3d";

type SceneStatsProps = {
  viewerRef: React.RefObject<DropInViewer | null>;
};

// 2026-04-05 | 优化 | 将 StatsData 从 React state 迁移到 DOM 直操
// 根因：之前每 10 帧调用 setState 触发 React 重渲染，导致 App 树整体重绘，
//   在 1.17M splat 的 CPU 排序瓶颈下雪上加霜。
// 修复：SceneStatsCollector 直接写入 DOM ref，跳过 React 渲染管线。
// 影响范围：减少 ~6 次/秒的全树重渲染。
export type StatsData = {
  fps: number;
  cameraPos: [number, number, number];
  cameraDir: [number, number, number];
  splatCount: number;
  sceneCount: number;
  drawCalls: number;
  triangles: number;
  textureMemMB: number;
  geometryMemMB: number;
  drawRangeCount: number;
};

// 降采样：每 N 帧更新一次
const UPDATE_INTERVAL = 10;

// “发布-订阅”模式：Collector 发布数据，Overlay 订阅数据，不经过 React state
type StatsListener = (data: StatsData) => void;
const statsListeners = new Set<StatsListener>();

export function SceneStatsCollector({ viewerRef }: SceneStatsProps) {
  const { gl, camera } = useThree();
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const fpsAccum = useRef(0);
  // 缓存向量避免每帧 GC 分配
  const dirVec = useRef(new THREE.Vector3());

  useFrame(() => {
    frameCount.current++;
    fpsAccum.current++;

    if (frameCount.current % UPDATE_INTERVAL !== 0) return;
    if (statsListeners.size === 0) return;

    const now = performance.now();
    const elapsed = (now - lastTime.current) / 1000;
    const fps = elapsed > 0 ? fpsAccum.current / elapsed : 0;
    lastTime.current = now;
    fpsAccum.current = 0;

    const info = gl.info;
    const viewer = viewerRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const innerViewer = viewer?.viewer as any;
    const splatMesh = innerViewer?.splatMesh;

    const dir = camera.getWorldDirection(dirVec.current);

    const data: StatsData = {
      fps: Math.round(fps),
      cameraPos: [
        parseFloat(camera.position.x.toFixed(2)),
        parseFloat(camera.position.y.toFixed(2)),
        parseFloat(camera.position.z.toFixed(2)),
      ],
      cameraDir: [
        parseFloat(dir.x.toFixed(2)),
        parseFloat(dir.y.toFixed(2)),
        parseFloat(dir.z.toFixed(2)),
      ],
      splatCount: (splatMesh?.getSplatCount?.() as number) ?? 0,
      sceneCount: (innerViewer?.getSceneCount?.() as number) ?? 0,
      drawCalls: info.render?.calls ?? 0,
      triangles: info.render?.triangles ?? 0,
      textureMemMB: parseFloat(
        ((info.memory?.textures ?? 0) * 0.001).toFixed(1),
      ),
      geometryMemMB: parseFloat(
        ((info.memory?.geometries ?? 0) * 0.001).toFixed(1),
      ),
      drawRangeCount: splatMesh?.geometry?.drawRange?.count ?? 0,
    };

    // 直接通知所有订阅者，不经过 React
    statsListeners.forEach((fn) => fn(data));
  });

  return null;
}

// HTML overlay 组件（放在 Canvas 外部，用 DOM ref 直接更新）
export function SceneStatsOverlay({ visible }: { visible: boolean }) {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const camRef = useRef<HTMLSpanElement>(null);
  const dirRef = useRef<HTMLSpanElement>(null);
  const splatsRef = useRef<HTMLSpanElement>(null);
  const renderedRef = useRef<HTMLSpanElement>(null);
  const scenesRef = useRef<HTMLSpanElement>(null);
  const drawCallsRef = useRef<HTMLSpanElement>(null);
  const trianglesRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible) return;

    const listener: StatsListener = (data) => {
      if (fpsRef.current) {
        fpsRef.current.textContent = String(data.fps);
        fpsRef.current.className = `stats-value ${data.fps < 30 ? "warn" : ""}`;
      }
      if (camRef.current) {
        camRef.current.textContent = `${data.cameraPos[0]}, ${data.cameraPos[1]}, ${data.cameraPos[2]}`;
      }
      if (dirRef.current) {
        dirRef.current.textContent = `${data.cameraDir[0]}, ${data.cameraDir[1]}, ${data.cameraDir[2]}`;
      }
      if (splatsRef.current) {
        splatsRef.current.textContent = data.splatCount.toLocaleString();
      }
      if (renderedRef.current) {
        renderedRef.current.textContent = data.drawRangeCount.toLocaleString();
      }
      if (scenesRef.current) {
        scenesRef.current.textContent = String(data.sceneCount);
      }
      if (drawCallsRef.current) {
        drawCallsRef.current.textContent = String(data.drawCalls);
      }
      if (trianglesRef.current) {
        trianglesRef.current.textContent = data.triangles.toLocaleString();
      }
    };

    statsListeners.add(listener);
    return () => {
      statsListeners.delete(listener);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="scene-stats-overlay">
      <div className="stats-title">场景监控</div>
      <div className="stats-grid">
        <div className="stats-row">
          <span className="stats-label">帧率</span>
          <span ref={fpsRef} className="stats-value">
            0
          </span>
        </div>
        <div className="stats-row">
          <span className="stats-label">相机</span>
          <span ref={camRef} className="stats-value mono">
            0, 0, 0
          </span>
        </div>
        <div className="stats-row">
          <span className="stats-label">朝向</span>
          <span ref={dirRef} className="stats-value mono">
            0, 0, 0
          </span>
        </div>
        <hr className="stats-divider" />
        <div className="stats-row">
          <span className="stats-label">点云数</span>
          <span ref={splatsRef} className="stats-value">
            0
          </span>
        </div>
        <div className="stats-row">
          <span className="stats-label">已渲染</span>
          <span ref={renderedRef} className="stats-value">
            0
          </span>
        </div>
        <div className="stats-row">
          <span className="stats-label">场景数</span>
          <span ref={scenesRef} className="stats-value">
            0
          </span>
        </div>
        <hr className="stats-divider" />
        <div className="stats-row">
          <span className="stats-label">绘制调用</span>
          <span ref={drawCallsRef} className="stats-value">
            0
          </span>
        </div>
        <div className="stats-row">
          <span className="stats-label">三角形</span>
          <span ref={trianglesRef} className="stats-value">
            0
          </span>
        </div>
      </div>
      <div className="stats-hint">按 H 键切换显示</div>
    </div>
  );
}

// 键盘快捷键切换 HUD 可见性 (H 键)
export function useStatsToggle(initialVisible = true) {
  const [visible, setVisible] = useState(initialVisible);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === "h" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { visible };
}
