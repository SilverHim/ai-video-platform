import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 把 URL 里的相对路径安全地拼到 root 下：拒绝 ..、绝对路径、NUL、反斜杠穿越。
 * 返回 null 表示非法。
 */
export function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const cleaned = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.split('/').some((seg) => seg === '..')) return null;
  const rootAbs = resolve(root);
  const full = resolve(rootAbs, cleaned);
  const rel = relative(rootAbs, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  if (full !== rootAbs && !full.startsWith(rootAbs + sep)) return null;
  return full;
}

export interface SendFileOptions {
  cacheControl?: string;
  /** 传文件名时以附件形式下载 */
  downloadName?: string;
}

/** 发送文件，支持单区间 Range（视频拖动进度条需要）和 HEAD */
export async function sendFile(req: Request, absPath: string, opts: SendFileOptions = {}): Promise<Response> {
  let st;
  try {
    st = await stat(absPath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }
  if (!st.isFile()) return new Response('Not Found', { status: 404 });

  const size = st.size;
  const headers = new Headers({
    'Content-Type': mimeFor(absPath),
    'Accept-Ranges': 'bytes',
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': opts.cacheControl ?? 'no-cache',
  });
  if (opts.downloadName) {
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`);
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    if (m[1] === '') {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(size === 0 ? 0 : end - start + 1));

  if (req.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
