import { formatBytes } from '../engine/media.js';
import { isPlainObject } from './wire.js';

const DATA_URI = /^data:([^;,]+)(;base64)?,/i;

/** 预览用：截断 data URI / 长 base64，保留结构 */
export function sanitizeForPreview<T>(value: T, maxLen = 120): T {
  if (typeof value === 'string') {
    const m = DATA_URI.exec(value);
    if (m && value.length > maxLen) {
      const payload = value.length - m[0].length;
      const bytes = m[2] ? Math.floor((payload * 3) / 4) : payload;
      return `${m[0]}…(${formatBytes(bytes)})` as T;
    }
    if (value.length > 4096 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 256))) {
      return `${value.slice(0, 32)}…(base64 ${formatBytes(Math.floor((value.length * 3) / 4))})` as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeForPreview(v, maxLen)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeForPreview(v, maxLen);
    return out as T;
  }
  return value;
}

/** 打码 URL 中的签名 / 凭据类查询参数 */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:X-Tos-Signature|X-Tos-Credential|X-Amz-Signature|X-Amz-Credential|Signature|token|key|sig)=)[^&#]+/gi, '$1***');
}
