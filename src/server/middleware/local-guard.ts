import type { MiddlewareHandler } from 'hono';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '../../shared/api-contract.js';

export interface LocalGuardOptions {
  /** 当前允许的 Host 头（含端口），随实际监听端口变化，所以用函数取 */
  allowedHosts: () => ReadonlySet<string>;
  /** 当前允许的 Origin */
  allowedOrigins: () => ReadonlySet<string>;
}

const SAFE_FETCH_SITES = new Set(['same-origin', 'none']);

/**
 * 素材原文件：网页用 <img> 直接加载，带不了 X-Ark-Client，所以只对 GET/HEAD 免这个头，
 * 其余检查与 /files/* 相同（Host、Origin、Sec-Fetch-Site）
 */
const ASSET_CONTENT_PATH = /^\/api\/assets\/[^/]+\/content$/;

function deny(code: string, message: string) {
  return Response.json({ error: { code, message } }, { status: 403 });
}

/**
 * 本机防护：
 * - Host 白名单（防 DNS 重绑定）
 * - Origin 若存在必须同源（MCP 规范要求非法 Origin 返回 403）
 * - /api/* 必须带自定义头 X-Ark-Client，且 Sec-Fetch-Site 只能是 same-origin/none
 *   （GET/HEAD /api/assets/:id/content 例外：不要求自定义头，其余同上）
 * - /files/* 也拒绝跨站页面嵌入读取
 */
export function localGuard(opts: LocalGuardOptions): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    if (!opts.allowedHosts().has(host)) return deny('forbidden_host', '只接受来自本机地址的请求');

    const origin = c.req.header('origin');
    if (origin !== undefined && !opts.allowedOrigins().has(origin.toLowerCase())) {
      return deny('forbidden_origin', '不接受跨源请求');
    }

    const path = c.req.path;
    const site = c.req.header('sec-fetch-site');
    if (path.startsWith('/api/') || path === '/api') {
      const mediaRead = (c.req.method === 'GET' || c.req.method === 'HEAD') && ASSET_CONTENT_PATH.test(path);
      if (!mediaRead && c.req.header(CLIENT_HEADER) !== CLIENT_HEADER_VALUE) return deny('missing_client_header', `缺少 ${CLIENT_HEADER} 请求头`);
      if (site !== undefined && !SAFE_FETCH_SITES.has(site)) return deny('forbidden_fetch_site', '不接受跨站请求');
    } else if (path.startsWith('/files/')) {
      if (site !== undefined && !SAFE_FETCH_SITES.has(site)) return deny('forbidden_fetch_site', '不接受跨站请求');
    }
    await next();
  };
}

export function localHostSet(ports: number[]): Set<string> {
  const s = new Set<string>();
  for (const p of ports) {
    s.add(`127.0.0.1:${p}`);
    s.add(`localhost:${p}`);
  }
  return s;
}

export function localOriginSet(ports: number[]): Set<string> {
  const s = new Set<string>();
  for (const p of ports) {
    s.add(`http://127.0.0.1:${p}`);
    s.add(`http://localhost:${p}`);
  }
  return s;
}
