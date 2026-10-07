/** image-01 家族的请求组装与响应解析（未核实：按同步返回实现属推断，见 index.ts） */
import type { BuildCtx, FamilyAdapter, UpstreamResponse } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { orderedAssets } from '../../../engine/refs.js';
import { isPlainObject } from '../../../request/wire.js';
import { makeError, safeJson, type NormalizedError } from '../../../task/errors.js';
import type { NormalizedResult, PartialFailure, ResultAsset } from '../../../task/results.js';
import { normalizeMiniMaxError } from '../errors.js';
import { MODE_SUBJECT } from './spec.js';

/** 原文 "url expires in 24 hours"；起算点未说明，按收到响应时刻计 */
export const RESULT_URL_TTL_MS = 24 * 60 * 60 * 1000;
/** n 的文档上限，防止异常 failed_count 撑出超长数组 */
const MAX_FAILURES = 9;

export function composeImage01(c: BuildCtx): Record<string, unknown> {
  const body: Record<string, unknown> = { model: c.model.apiModel, prompt: c.renderedPrompt };
  if (c.mode.id === MODE_SUBJECT) {
    // type 无 enum，描述原文 "Currently only supports character (portrait)"
    const refs = orderedAssets(c.mode, c.input.slots, 'image').map(({ asset }) => ({ type: 'character', image_file: c.resolved[asset.id]?.wire ?? '' }));
    if (refs.length) body.subject_reference = refs;
  }
  return body;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** schema 写 integer，官方示例却是字符串（"3"），统一 Number() */
function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function numeric(v: unknown): unknown {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? n : v;
}

// 未核实：输出编码文档未说明（Guide 存为 .jpeg 只是示例）；只按文件头识别，识别不出不标 mime，交给落盘时嗅探
function base64Mime(b64: string): string | undefined {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  return undefined;
}

function blockedError(message: string, hint: ReturnType<typeof T>, requestId: string | undefined): NormalizedError {
  return makeError({ providerId: 'minimax', category: 'content_policy', code: 'failed_count', message, hint, ...(requestId ? { requestId } : {}) });
}

function countMismatchError(reported: number, returned: number, requestId: string | undefined): NormalizedError {
  return makeError({
    providerId: 'minimax',
    category: 'unknown',
    code: 'COUNT_MISMATCH',
    message: `metadata.success_count=${reported} but ${returned} image(s) returned`,
    hint: T(`服务商报告成功 ${reported} 张，响应里只有 ${returned} 张（位置未知）`, `Provider reported ${reported} successful image(s) but returned ${returned} (position unknown)`),
    ...(requestId ? { requestId } : {}),
  });
}

function badResponse(res: UpstreamResponse, message: string, requestId?: string): NormalizedError {
  return makeError({ providerId: 'minimax', category: 'unknown', code: 'BAD_RESPONSE', httpStatus: res.status, message, ...(requestId ? { requestId } : {}) });
}

/**
 * 同步响应：HTTP 200 也可能是业务错误（base_resp.status_code ≠ 0），先走错误归一化。
 * 成功时 data.image_urls / data.image_base64 → assets；metadata.failed_count 为被内容安全拦截的张数，位置未知（index = -1）。
 * metadata.success_count 多于实际返回张数时，差额同样记为位置未知的失败（部分成功时数组长度行为文档未说明）。
 */
export function normalizeImage01Submit(res: UpstreamResponse): NormalizedResult {
  const err = normalizeMiniMaxError(res);
  if (err) return { kind: 'error', error: err };

  const body = safeJson(res.bodyText);
  if (!isPlainObject(body)) return { kind: 'error', error: badResponse(res, `Response is not a JSON object: ${res.bodyText.slice(0, 200)}`) };
  const requestId = typeof body.id === 'string' && body.id ? body.id : res.headers['trace-id'];
  const data = isPlainObject(body.data) ? body.data : {};
  const meta = isPlainObject(body.metadata) ? body.metadata : undefined;

  const assets: ResultAsset[] = [];
  const expiresAt = Date.now() + RESULT_URL_TTL_MS;
  for (const url of strings(data.image_urls)) {
    assets.push({ index: assets.length, role: 'image', kind: 'image', source: { type: 'url', url, expiresAt } });
  }
  for (const b64 of strings(data.image_base64)) {
    const mime = base64Mime(b64);
    assets.push({ index: assets.length, role: 'image', kind: 'image', source: { type: 'b64', data: b64, ...(mime ? { mime } : {}) }, ...(mime ? { mime } : {}) });
  }

  const blocked = count(meta?.failed_count);
  const failures: PartialFailure[] = Array.from({ length: Math.min(blocked, MAX_FAILURES) }, () => ({
    index: -1,
    error: blockedError('Image blocked due to content safety (metadata.failed_count)', T('该图片被内容安全审核拦截（位置未知）', 'This image was blocked by content safety (position unknown)'), requestId),
  }));
  const reported = count(meta?.success_count);
  const missing = assets.length ? Math.min(Math.max(0, reported - assets.length), MAX_FAILURES - failures.length) : 0;
  for (let i = 0; i < missing; i++) failures.push({ index: -1, error: countMismatchError(reported, assets.length, requestId) });
  const usage = meta ? { ...meta, ...('success_count' in meta ? { success_count: numeric(meta.success_count) } : {}), ...('failed_count' in meta ? { failed_count: numeric(meta.failed_count) } : {}) } : undefined;
  const withUsage = usage ? { usage } : {};

  if (!assets.length) {
    const error = blocked
      ? blockedError(`All ${blocked} image(s) blocked due to content safety`, T(`${blocked} 张图片全部被内容安全审核拦截`, `All ${blocked} image(s) were blocked by content safety`), requestId)
      : badResponse(res, 'Response contains no images', requestId);
    return { kind: 'sync', status: 'failed', assets, failures, ...withUsage, error };
  }
  return { kind: 'sync', status: failures.length ? 'partial' : 'succeeded', assets, failures, ...withUsage };
}

export const image01Adapter: FamilyAdapter = {
  compose: composeImage01,
  normalizeSubmit: normalizeImage01Submit,
};
