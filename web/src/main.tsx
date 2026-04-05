/*
 * 2026-04-05 | 新增 | Web 入口初始化
 * 功能描述：挂载 SHARP 的 React 预览页面，并注入全局样式。
 * 设计思路：保持入口极简，仅负责启动 React 树，让 viewer 逻辑集中在 App 与组件层，避免把渲染细节散落到启动代码；同时不启用 React.StrictMode，以规避外部 DropInViewer 在 dev 模式下被重复 dispose 的生命周期冲突。
 * 参数与返回值：当前模块无外部参数；无显式返回值，副作用是向 #root 挂载 React 应用。
 * 影响范围：仅影响 web/ 子工程入口；上游为 index.html 的 root 节点，下游为整个 React 页面生命周期。
 * 潜在风险：关闭 StrictMode 会减少开发期双重副作用探测，但能避免当前 imperative 3D viewer 在本地预览时直接崩溃。
 */
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element for SHARP web viewer.");
}

ReactDOM.createRoot(rootElement).render(<App />);
