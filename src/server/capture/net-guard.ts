import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** 是否内网 / 回环 / 链路本地 / 保留地址 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
}

export class UnsafeUrlError extends Error {}

/**
 * 结果链接是 http 时改用 https 下载（实测 MiniMax image-01 返回阿里云 OSS 的 http 签名链接，
 * OSS 同时支持 https，且这类签名不含协议）。https 下载不了就按失败处理，不退回 http
 */
export function upgradeToHttps(raw: string): string {
  return /^http:\/\//i.test(raw) ? `https://${raw.slice(7)}` : raw;
}

/** 下载前检查：只允许 https，且主机不能解析到内网地址（防御性措施） */
export async function assertSafeRemoteUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('结果链接不是合法 URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('只允许下载 https 链接');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) throw new UnsafeUrlError('结果链接指向内网地址，已拒绝');
  return url;
}
