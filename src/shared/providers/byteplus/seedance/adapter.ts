/** Seedance 请求组装（content[]）与创建 / 查询响应解析 */
import type { BuildCtx, FamilyAdapter, MediaKind, UpstreamResponse } from '../../../catalog/types.js';
import { orderedAssets } from '../../../engine/refs.js';
import { isPlainObject } from '../../../request/wire.js';
import { makeError, safeJson, type NormalizedError } from '../../../task/errors.js';
import type { NormalizedResult, ResultAsset, TaskSnapshot } from '../../../task/results.js';
import type { TaskStatus } from '../../../task/status.js';
import { normalizeBytePlusError } from '../errors.js';
import { MODE, URL_TTL_MS } from './profile.js';

type Obj = Record<string, unknown>;

/**
 * content[]：text（渲染后的提示词，空则不发）在前，素材按 orderedAssets 顺序（与 "Image n" 编号一致），
 * 每项都显式写 role（首帧也写）；正片只有 draft_task 一项。
 */
export function composeSeedance(c: BuildCtx): Record<string, unknown> {
  if (c.mode.id === MODE.final) {
    return { model: c.model.apiModel, content: [{ type: 'draft_task', draft_task: { id: c.input.derivedFrom?.upstreamTaskId ?? '' } }] };
  }
  const kindOf = new Map<string, MediaKind>(c.mode.slots.map((s) => [s.id, s.kind]));
  const content: Obj[] = [];
  if (c.renderedPrompt) content.push({ type: 'text', text: c.renderedPrompt });
  for (const { asset, slotId, role } of orderedAssets(c.mode, c.input.slots)) {
    const type = `${kindOf.get(slotId) ?? 'image'}_url`;
    // 未解析的素材留空串，由 content-resolved guard 拦截，保证编号不错位
    content.push({ type, [type]: { url: c.resolved[asset.id]?.wire ?? '' }, ...(role ? { role } : {}) });
  }
  return { model: c.model.apiModel, content };
}

const badResponse = (status: number, message: string): NormalizedError => makeError({ providerId: 'byteplus', category: 'unknown', code: 'BAD_RESPONSE', httpStatus: status, message });

/** 创建任务：成功只返回 {id}；错误走 BytePlus 统一归一化 */
export function normalizeSeedanceSubmit(res: UpstreamResponse): NormalizedResult {
  const err = normalizeBytePlusError(res);
  if (err) return { kind: 'error', error: err };
  const body = safeJson(res.bodyText);
  if (isPlainObject(body) && typeof body.id === 'string' && body.id) return { kind: 'task-created', taskId: body.id };
  return { kind: 'error', error: badResponse(res.status, `创建任务的响应里没有 id：${res.bodyText.slice(0, 200)}`) };
}

/*
 * 推断：任务失败时的 error 没有独立 HTTP 状态，按错误码表的 HTTP 列推断状态，只用于复用 normalizeBytePlusError 的归类；
 * 推断不出时按 200 处理（只看错误码）。
 */
const CODE_STATUS: [RegExp, number][] = [
  [/^(BadRequest|MissingParameter|InvalidParameter|InvalidImageURL|InvalidEndpoint\.|\w*SensitiveContentDetected)/, 400],
  [/^(Unauthorized|AuthenticationError|InvalidAccountStatus)/, 401],
  [/^(Forbidden|AccessDenied|OperationDenied|AccountOverdueError)/, 403],
  [/^(NotFound|InvalidEndpointOrModel|ModelNotOpen)/, 404],
  [/^(TooManyRequests|\w*RateLimitExceeded|QuotaExceeded|SetLimitExceeded|InflightBatchsizeExceeded|ServerOverloaded|RequestBurstTooFast)/, 429],
  [/^(InternalServerError|InternalServiceError)/, 500],
];

/** GET 响应里的 error{code,message} → NormalizedError（不带推断出的 httpStatus） */
export function taskError(err: Obj): NormalizedError {
  const code = typeof err.code === 'string' && err.code ? err.code : 'TASK_FAILED';
  const message = typeof err.message === 'string' && err.message ? err.message : code;
  const status = CODE_STATUS.find(([re]) => re.test(code))?.[1] ?? 200;
  const e = normalizeBytePlusError({ status, headers: {}, bodyText: JSON.stringify({ error: { code, message } }) });
  if (!e) return makeError({ providerId: 'byteplus', category: 'unknown', code, message });
  const { httpStatus: _inferred, ...rest } = e;
  return rest;
}

/** 文档列出的状态；expired 不在查询接口枚举里，但删除表 / 回调 / 超时说明都有 */
const STATUS = new Map<string, TaskStatus>([
  ['queued', 'queued'],
  ['running', 'running'],
  ['succeeded', 'succeeded'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
  ['expired', 'expired'],
]);

/**
 * 原样记录的实际参数（ratio 可能是 5:4 这类不在枚举里的值；duration 为帧数 / 24 向下取整）。
 * draft：GET 文档写只有 1.5 pro 返回（官方示例里 2.0 也返回了 draft:false），判断是否样片要看本地请求记录，不能靠这里
 */
const ACTUAL_KEYS = ['model', 'resolution', 'ratio', 'duration', 'frames', 'framespersecond', 'seed', 'generate_audio', 'output_format', 'draft', 'draft_task_id', 'service_tier', 'priority', 'execution_expires_after'];

/** created_at / updated_at 为 Unix 秒 → 毫秒（已是毫秒的不再换算） */
function toMs(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return v > 1e12 ? v : v * 1000;
}

function resultAssets(content: unknown, base: number | undefined, outputFormat: unknown): ResultAsset[] {
  if (!isPlainObject(content)) return [];
  const expiry = base !== undefined ? { expiresAt: base + URL_TTL_MS } : {};
  const assets: ResultAsset[] = [];
  if (typeof content.video_url === 'string' && content.video_url) {
    // 只有 2.5 可选 mov，其余模型输出固定 mp4
    const mime = outputFormat === 'mov' ? 'video/quicktime' : 'video/mp4';
    assets.push({ index: 0, role: 'video', kind: 'video', source: { type: 'url', url: content.video_url, ...expiry }, mime });
  }
  if (typeof content.last_frame_url === 'string' && content.last_frame_url) {
    // 尾帧为 jpeg，尺寸与视频一致
    assets.push({ index: assets.length, role: 'last_frame', kind: 'image', source: { type: 'url', url: content.last_frame_url, ...expiry }, mime: 'image/jpeg' });
  }
  return assets;
}

/** 查询任务：状态映射、结果视频与尾帧、失败原因、usage、实际参数 */
export function normalizeSeedanceTask(res: UpstreamResponse): TaskSnapshot {
  const body = safeJson(res.bodyText);
  const obj: Obj = isPlainObject(body) ? body : {};
  const taskId = typeof obj.id === 'string' ? obj.id : '';
  const rawStatus = typeof obj.status === 'string' ? obj.status : '';

  if (res.status >= 400) {
    return { taskId, status: 'unknown', rawStatus, assets: [], error: normalizeBytePlusError(res) ?? badResponse(res.status, `HTTP ${res.status}`) };
  }
  if (!isPlainObject(body)) return { taskId, status: 'unknown', rawStatus, assets: [], error: badResponse(res.status, `查询响应不是 JSON 对象：${res.bodyText.slice(0, 200)}`) };

  let status: TaskStatus = STATUS.get(rawStatus) ?? 'unknown';
  const createdAt = toMs(obj.created_at);
  const updatedAt = toMs(obj.updated_at);
  // 未核实：URL "valid for 24 hours" 的起算点文档没写，取较早的时间（created_at）保守估计，避免把有效期估长
  const base = createdAt !== undefined && updatedAt !== undefined ? Math.min(createdAt, updatedAt) : (createdAt ?? updatedAt);
  const assets = resultAssets(obj.content, base, obj.output_format);
  let error = isPlainObject(obj.error) ? taskError(obj.error) : undefined;
  if (status === 'succeeded' && !assets.some((a) => a.role === 'video')) {
    status = 'failed';
    error = makeError({ providerId: 'byteplus', category: 'unknown', code: 'EMPTY_RESULT', message: '任务成功但响应里没有 content.video_url' });
  }
  if (status === 'failed' && !error) error = makeError({ providerId: 'byteplus', category: 'unknown', code: 'TASK_FAILED', message: '任务失败，响应没有给出原因' });

  const actual: Obj = {};
  for (const k of ACTUAL_KEYS) if (obj[k] !== undefined && obj[k] !== null) actual[k] = obj[k];
  const usage = isPlainObject(obj.usage) ? obj.usage : undefined;

  return {
    taskId,
    status,
    rawStatus,
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    assets,
    ...(error ? { error } : {}),
    ...(usage ? { usage } : {}),
    ...(Object.keys(actual).length ? { actual } : {}),
  };
}

export const SEEDANCE_ADAPTER: FamilyAdapter = {
  compose: composeSeedance,
  normalizeSubmit: normalizeSeedanceSubmit,
  normalizeTask: normalizeSeedanceTask,
};
