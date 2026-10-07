import { openAsBlob } from 'node:fs';
import { Agent, fetch as undiciFetch, FormData } from 'undici';
import { T } from '../../shared/catalog/helpers.js';
import { normalizeMiniMaxError } from '../../shared/providers/minimax/errors.js';
import { MINIMAX_BASE_URL } from '../../shared/providers/minimax/index.js';
import { USER_AGENT, headersToObject } from '../upstream/http.js';
import { UploadError, type UploadTarget } from './types.js';

const MiB = 1024 * 1024;
const agent = new Agent({ connectTimeout: 15_000, headersTimeout: 10 * 60_000, bodyTimeout: 10 * 60_000 });

/** file_id 可能超过 2^53：直接从原始 JSON 文本里取，保持字符串 */
export function extractFileId(text: string): string | null {
  const m = /"file_id"\s*:\s*"?(\d+)"?/.exec(text);
  return m?.[1] ?? null;
}

/**
 * MiniMax 官方文件上传：POST /v1/files/upload（multipart：purpose=video_generation_input + file），
 * 返回 file_id，在 V2 视频请求里写成 mm_file://<file_id>，有效期 7 天。只给 MiniMax 用，不公开。
 */
export const minimaxFiles: UploadTarget = {
  id: 'minimax-files',
  kind: 'provider-files',
  label: T('MiniMax 文件存储（仅 MiniMax 可读，7 天）', 'MiniMax file storage (private, 7 days)'),
  privacy: 'provider-private',
  maxBytes: 50 * MiB,
  ttlMs: 7 * 24 * 3600_000,
  providers: ['minimax'],
  async upload(file, opts) {
    if (!opts.providerKey) throw new UploadError('缺少 MiniMax API Key', 'MISSING_KEY');
    const form = new FormData();
    form.append('purpose', 'video_generation_input');
    form.append('file', await openAsBlob(file.path, { type: file.mime }), file.filename);
    const startedAt = Date.now();
    const res = await undiciFetch(`${MINIMAX_BASE_URL}/v1/files/upload`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${opts.providerKey}`, 'User-Agent': USER_AGENT },
      dispatcher: agent,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const text = await res.text();
    const err = normalizeMiniMaxError({ status: res.status, headers: headersToObject(res.headers), bodyText: text });
    if (err) throw new UploadError(`MiniMax 文件上传失败：${err.code} ${err.message}`, err.code);
    const id = extractFileId(text);
    if (!id) throw new UploadError('MiniMax 文件上传没有返回 file_id');
    return { url: `mm_file://${id}`, expiresAt: startedAt + this.ttlMs };
  },
};
