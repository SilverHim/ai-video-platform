import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { safeJoin, sendFile } from './http/send-file.js';

/** 生产模式托管 dist/web；未知路径回退到 index.html（前端路由） */
export function staticSite(staticDir: string): MiddlewareHandler {
  const indexHtml = join(staticDir, 'index.html');
  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    if ((method !== 'GET' && method !== 'HEAD') || path.startsWith('/api/') || path.startsWith('/files/') || path === '/mcp') {
      return next();
    }
    const file = safeJoin(staticDir, path);
    if (file && existsSync(file) && statSync(file).isFile()) {
      const immutable = path.startsWith('/assets/');
      return sendFile(c.req.raw, file, { cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    }
    if (existsSync(indexHtml)) return sendFile(c.req.raw, indexHtml, { cacheControl: 'no-cache' });
    return next();
  };
}
