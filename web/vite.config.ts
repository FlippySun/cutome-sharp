/*
 * 2026-04-05 | 新增 | Vite 开发服务器配置
 * 功能描述：为 SHARP 的本地网页预览器提供 React 构建入口，并放开对仓库目录与 /tmp 输出目录的只读访问。
 * 设计思路：浏览器不能直接读取本地绝对路径，因此通过 Vite 的 /@fs 映射把受控目录暴露给本地开发服务器；这能兼容 SHARP 生成在 /tmp 下的 .ply 结果。
 * 参数与返回值：当前模块无外部参数；默认导出 Vite 配置对象供 dev/build/preview 脚本使用。
 * 影响范围：仅影响 web/ 子工程的开发服务器行为；上游为本地文件路径输入，下游为浏览器内的 3DGS 资源加载。
 * 潜在风险：/@fs 目录访问仅适用于本地开发，若误用于公网部署会暴露额外文件读取面；当前配置仅建议本机使用。
 */
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoots = ["/tmp", "/private/tmp"];

// 2026-04-05 | 新增 | 启用 SharedArrayBuffer 所需的安全头
// 根因：GaussianSplats3D 的 sort worker 使用 SharedArrayBuffer 在主线程和
//   worker 之间零拷贝共享排序索引。缺少 COOP/COEP 头时浏览器禁用 SAB，
//   库回退到结构化克隆（每帧拷贝数 MB 数据），导致 FPS 骤降。
// 影响范围：仅 dev server 响应头；不影响构建产物。
function crossOriginIsolation(): Plugin {
  return {
    name: "cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [webRoot, repoRoot, ...tempRoots],
    },
    // 2026-04-05 | 新增 | API 代理
    // 功能描述：将 /api/* 请求转发至 FastAPI 后端（port 8321），避免跨域问题。
    // 影响范围：仅影响开发服务器；生产构建需另行配置反向代理。
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8321",
        changeOrigin: true,
      },
    },
  },
});
