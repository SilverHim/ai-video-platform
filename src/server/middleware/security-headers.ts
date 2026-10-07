import type { MiddlewareHandler } from 'hono';

/** 页面只加载自身资源；不允许任何第三方脚本，降低 XSS 读取本机数据的风险 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Frame-Options', 'DENY');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    if ((h.get('content-type') ?? '').includes('text/html')) h.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  };
}
