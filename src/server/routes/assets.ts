import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { AssetTooLargeError } from '../assets/asset-store.js';
import { sendFile } from '../http/send-file.js';
import type { AppDeps } from '../app.js';

/**
 * 素材内容不要求 X-Ark-Client（见 local-guard），也就能在地址栏直接打开；素材是用户上传的任意文件（可能是 HTML/SVG），
 * 所以加沙箱 CSP：直接打开时不执行其中的脚本，<img>/<video> 加载不受影响
 */
const ASSET_CONTENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function assetRoutes(deps: AppDeps) {
  const app = new Hono();

  /** 上传素材：请求体是文件原始字节；文件名放在 X-Asset-Filename（URL 编码） */
  app.post('/', async (c) => {
    const body = c.req.raw.body;
    if (!body) return c.json({ error: { code: 'empty_body', message: '请求体为空' } }, 400);
    const rawName = c.req.header('x-asset-filename');
    let filename: string | undefined;
    try {
      filename = rawName ? decodeURIComponent(rawName) : undefined;
    } catch {
      filename = undefined;
    }
    try {
      const asset = await deps.services.assets.save(Readable.fromWeb(body as WebReadableStream), {
        ...(filename ? { filename } : {}),
        ...(c.req.header('content-type') ? { mime: c.req.header('content-type')! } : {}),
      });
      return c.json({ asset: { id: asset.id, sha256: asset.sha256, filename: asset.filename, mime: asset.mime, bytes: asset.bytes, meta: asset.meta } });
    } catch (err) {
      if (err instanceof AssetTooLargeError) return c.json({ error: { code: 'too_large', message: err.message } }, 413);
      throw err;
    }
  });

  app.get('/:id/content', async (c) => {
    const asset = deps.store.getAsset(c.req.param('id'));
    if (!asset) return c.json({ error: { code: 'not_found', message: '素材不存在' } }, 404);
    const res = await sendFile(c.req.raw, deps.services.assets.absPath(asset), { cacheControl: 'private, max-age=31536000, immutable' });
    res.headers.set('Content-Security-Policy', ASSET_CONTENT_CSP);
    return res;
  });

  return app;
}
