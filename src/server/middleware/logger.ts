import type { MiddlewareHandler } from 'hono';

/** 访问日志：只记方法、路径（不含查询串）、状态、耗时；绝不记录请求头与请求体 */
export function accessLog(enabled = true): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    await next();
    if (!enabled) return;
    const path = c.req.path.startsWith('/files/') ? '/files/…' : c.req.path;
    if (path === '/api/health' || path === '/api/events') return;
    console.log(`[http] ${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`);
  };
}
