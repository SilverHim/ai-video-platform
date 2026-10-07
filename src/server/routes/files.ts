import { Hono } from 'hono';
import { safeJoin, sendFile } from '../http/send-file.js';
import type { AppDeps } from '../app.js';

/** 结果文件：/files/<日期>/<目录>/<文件>，支持 Range；?download=1 以附件下载 */
export function fileRoutes(deps: AppDeps) {
  const app = new Hono();
  app.get('/*', async (c) => {
    const rel = c.req.path.replace(/^\/files\//, '');
    const abs = safeJoin(deps.config.paths.outputs, `/${rel}`);
    if (!abs) return c.json({ error: { code: 'bad_path', message: '路径不合法' } }, 400);
    const name = rel.split('/').filter(Boolean).slice(-2).join('_');
    return sendFile(c.req.raw, abs, { cacheControl: 'private, max-age=3600', ...(c.req.query('download') ? { downloadName: name } : {}) });
  });
  return app;
}
