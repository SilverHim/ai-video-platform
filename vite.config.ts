import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const API_PORT = Number(process.env.ARK_API_PORT ?? 8787);
const target = `http://127.0.0.1:${API_PORT}`;
const proxy = { target, changeOrigin: false, ws: false, timeout: 0, proxyTimeout: 0 };

export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // 注意：src/web 下不能有 api/、files/、mcp/ 目录，否则源码请求会被代理到本机服务
    proxy: { '/api': proxy, '/files': proxy, '/mcp': proxy },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
