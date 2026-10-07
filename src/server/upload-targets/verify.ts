import { Agent, fetch as undiciFetch } from 'undici';
import { assertSafeRemoteUrl } from '../capture/net-guard.js';
import { USER_AGENT } from '../upstream/http.js';
import type { VerifyResult } from './types.js';

const agent = new Agent({ connectTimeout: 15_000, headersTimeout: 30_000, bodyTimeout: 30_000 });

/**
 * 直链自检：GET 前 1KB（Range），确认返回的是文件字节而不是 HTML 中间页 / 人机验证，
 * 并核对总大小与上传字节一致。
 */
export async function verifyDirectLink(url: string, expectBytes: number): Promise<VerifyResult> {
  try {
    const safe = await assertSafeRemoteUrl(url);
    const res = await undiciFetch(safe, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1023' }, dispatcher: agent, redirect: 'follow' });
    const ctype = res.headers.get('content-type');
    const range = res.headers.get('content-range');
    const total = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'));
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 512).toString('latin1').toLowerCase();
    if (res.status !== 200 && res.status !== 206) return { ok: false, status: res.status, contentType: ctype, note: `HTTP ${res.status}` };
    if ((ctype ?? '').includes('text/html') || head.includes('<!doctype html') || head.includes('<html')) return { ok: false, status: res.status, contentType: ctype, note: '直链返回的是网页（可能是中间页或人机验证）' };
    if (Number.isFinite(total) && total > 0 && total !== expectBytes) return { ok: false, status: res.status, contentType: ctype, totalBytes: total, note: `大小不一致：上传 ${expectBytes}，直链 ${total}` };
    return { ok: true, status: res.status, contentType: ctype, totalBytes: Number.isFinite(total) ? total : null };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}
