import { openAsBlob } from 'node:fs';
import { Agent, fetch as undiciFetch, FormData } from 'undici';
import { T } from '../../shared/catalog/helpers.js';
import { USER_AGENT } from '../upstream/http.js';
import { UploadError, type SpooledFile, type UploadTarget } from './types.js';
import { verifyDirectLink } from './verify.js';

const MiB = 1024 * 1024;
const agent = new Agent({ connectTimeout: 15_000, headersTimeout: 10 * 60_000, bodyTimeout: 10 * 60_000 });

async function formWithFile(field: string, file: SpooledFile, extra: Record<string, string> = {}): Promise<FormData> {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const blob = await openAsBlob(file.path, { type: file.mime });
  form.append(field, blob, file.filename);
  return form;
}

async function postForm(url: string, form: FormData, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  const res = await undiciFetch(url, { method: 'POST', body: form, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, dispatcher: agent, ...(signal ? { signal } : {}) });
  return { status: res.status, text: await res.text() };
}

/**
 * uguu.se：POST https://uguu.se/upload，字段 files[]，返回 {success, files:[{url,…}]}，url 即直链。
 * 单文件 128 MiB，固定保留 3 小时（从上传时起算），不能删除。见 docs/research/temp-hosts/。
 */
export const uguu: UploadTarget = {
  id: 'uguu',
  kind: 'temp-host',
  label: T('uguu.se（公开链接，保留 3 小时）', 'uguu.se (public link, kept 3 hours)'),
  privacy: 'public-link',
  maxBytes: 128 * MiB,
  ttlMs: 3 * 3600_000,
  homepage: 'https://uguu.se/faq',
  async upload(file, opts) {
    if (file.bytes > this.maxBytes) throw new UploadError(`文件 ${(file.bytes / MiB).toFixed(1)} MiB 超过 uguu 上限 128 MiB`, 'TOO_LARGE');
    const startedAt = Date.now();
    const { status, text } = await postForm('https://uguu.se/upload', await formWithFile('files[]', file), opts.signal);
    let body: { success?: boolean; files?: { url?: string; size?: number }[]; description?: string };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new UploadError(`uguu 返回了非 JSON 响应（HTTP ${status}）`);
    }
    const url = body.files?.[0]?.url;
    if (status !== 200 || !body.success || !url) throw new UploadError(`uguu 上传失败（HTTP ${status}）${body.description ? `：${body.description}` : ''}`);
    const verified = await verifyDirectLink(url, file.bytes);
    if (!verified.ok) throw new UploadError(`uguu 直链自检失败：${verified.note ?? ''}`, 'VERIFY_FAILED');
    return { url, expiresAt: startedAt + this.ttlMs, verified };
  },
};

/** 页面链接 https://tmpfiles.org/{id}/{name} → 直链 https://tmpfiles.org/dl/{id}/{name}（官方未写明，靠自检确认） */
export function tmpfilesDirectUrl(pageUrl: string): string {
  const u = new URL(pageUrl.replace(/^http:/, 'https:'));
  if (!u.pathname.startsWith('/dl/')) u.pathname = `/dl${u.pathname}`;
  return u.toString();
}

/**
 * tmpfiles.org：POST https://tmpfiles.org/api/v1/upload，字段 file + expire（秒，60–172800），
 * 返回 {status:'success', data:{url}}。单文件 100 MiB，不能删除；站点在 Cloudflare 后面。
 */
export const tmpfiles: UploadTarget = {
  id: 'tmpfiles',
  kind: 'temp-host',
  label: T('tmpfiles.org（公开链接，保留 24 小时）', 'tmpfiles.org (public link, kept 24 hours)'),
  privacy: 'public-link',
  maxBytes: 100 * MiB,
  ttlMs: 24 * 3600_000,
  homepage: 'https://tmpfiles.org/tos',
  async upload(file, opts) {
    if (file.bytes > this.maxBytes) throw new UploadError(`文件 ${(file.bytes / MiB).toFixed(1)} MiB 超过 tmpfiles 上限 100 MiB`, 'TOO_LARGE');
    const startedAt = Date.now();
    const { status, text } = await postForm('https://tmpfiles.org/api/v1/upload', await formWithFile('file', file, { expire: String(this.ttlMs / 1000) }), opts.signal);
    let body: { status?: string; data?: { url?: string }; url?: string };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new UploadError(`tmpfiles 返回了非 JSON 响应（HTTP ${status}，可能被人机验证拦截）`);
    }
    const page = body.data?.url ?? body.url;
    if (status !== 200 || !page) throw new UploadError(`tmpfiles 上传失败（HTTP ${status}）`);
    const url = tmpfilesDirectUrl(page);
    const verified = await verifyDirectLink(url, file.bytes);
    if (!verified.ok) throw new UploadError(`tmpfiles 直链自检失败：${verified.note ?? ''}`, 'VERIFY_FAILED');
    return { url, expiresAt: startedAt + this.ttlMs, verified };
  },
};
