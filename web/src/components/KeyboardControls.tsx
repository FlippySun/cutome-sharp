/*
 * 2026-04-05 | 修复 | WASD 键盘相机移动控制
 * 功能描述：在 R3F Canvas 内监听键盘事件，通过 WASD/QE/Space/C 实现
 *          第一人称风格的相机平移，与 OrbitControls 的鼠标旋转协同工作。
 * 设计思路：
 *   - 使用 useFrame 每帧读取按键状态，沿相机实际朝向平移（含仰角/俯角）。
 *   - W/S = 沿相机看向的方向前进/后退（包含垂直分量）。
 *   - A/D = 沿相机水平右方向的左右移动。
 *   - Space/E = 上升（世界 Y+），C/Q = 下降（世界 Y-）。
 *   - Shift = 加速（3x）。
 *   - OrbitControls.target 同步平移，保证轨道中心跟随相机移动。
 *   - 仅在 canvas 获得焦点时响应，避免与表单输入冲突。
 * 参数与返回值：
 *   - speed: 基础移动速度（单位/秒），默认 2.0
 *   - shiftMultiplier: Shift 加速倍率，默认 3.0
 *   组件无视觉输出，返回 null。
 * 影响范围：仅影响 R3F 相机位置；与 OrbitControls 共存。
 * 潜在风险：无已知风险。
 */

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

type KeyboardControlsProps = {
  speed?: number;
  shiftMultiplier?: number;
};

// 追踪的按键集合
const TRACKED_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "c",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
  " ",
]);

export function KeyboardControls({
  speed = 2.0,
  shiftMultiplier = 3.0,
}: KeyboardControlsProps) {
  const keysPressed = useRef<Set<string>>(new Set());
  const { camera, gl } = useThree();

  // 临时向量，避免每帧 GC
  const moveDir = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useEffect(() => {
    const canvas = gl.domElement;

    // 让 canvas 可聚焦以接收键盘事件
    if (!canvas.hasAttribute("tabindex")) {
      canvas.setAttribute("tabindex", "0");
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (TRACKED_KEYS.has(key)) {
        keysPressed.current.add(key);
        // 阻止 WASD/Space 的默认行为（如页面滚动）
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysPressed.current.delete(key);
    };

    // 失焦时清空所有按键状态，防止"粘键"
    const handleBlur = () => {
      keysPressed.current.clear();
    };

    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("blur", handleBlur);

    return () => {
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("blur", handleBlur);
    };
  }, [gl]);

  useFrame((_state, delta) => {
    const keys = keysPressed.current;
    if (keys.size === 0) return;

    // 2026-04-05 | 修复 | WASD 基于相机实际朝向移动
    // 根因：之前 forward.y = 0 强制水平投影，导致当相机仰角/俯角时
    //   W/S 移动方向与视觉中心不一致，用户感知为"固定方向移动"。
    // 修复：保留相机完整世界方向（含 Y 分量）作为前进方向，
    //   right 向量由 forward × worldUp 得到，始终在水平面内。
    camera.getWorldDirection(forward.current);
    // 不再归零 Y，forward 保留相机实际看向方向

    // right 向量 = forward × world up，始终在水平面内
    right.current.crossVectors(forward.current, camera.up).normalize();

    const move = moveDir.current.set(0, 0, 0);
    const isShift = keys.has("shift");
    const effectiveSpeed = speed * (isShift ? shiftMultiplier : 1) * delta;

    // W/S 或 ↑/↓ = 沿相机看向的方向前后（含仰角/俯角）
    if (keys.has("w") || keys.has("arrowup")) {
      move.add(forward.current);
    }
    if (keys.has("s") || keys.has("arrowdown")) {
      move.sub(forward.current);
    }

    // A/D 或 ←/→ = 左右（水平方向）
    if (keys.has("a") || keys.has("arrowleft")) {
      move.sub(right.current);
    }
    if (keys.has("d") || keys.has("arrowright")) {
      move.add(right.current);
    }

    // Space/E = 上升，Q/C = 下降（世界 Y 轴）
    if (keys.has("e") || keys.has(" ")) {
      move.y += 1;
    }
    if (keys.has("q") || keys.has("c")) {
      move.y -= 1;
    }

    if (move.lengthSq() === 0) return;

    move.normalize().multiplyScalar(effectiveSpeed);

    // 同时移动相机和 OrbitControls 的目标点
    camera.position.add(move);

    // 同步 OrbitControls target，保持轨道中心跟随相机
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = (_state as any).controls;
    if (controls && controls.target) {
      controls.target.add(move);
    }
  });

  return null;
}
