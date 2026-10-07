/** MiniMax V2 视频家族的请求组装与响应解析 */
import type { BuildCtx, FamilyAdapter, MediaKind, UpstreamResponse } from '../../../catalog/types.js';
import { orderedAssets } from '../../../engine/refs.js';
import { isPlainObject } from '../../../request/wire.js';
import { makeError, safeJson, type NormalizedError } from '../../../task/errors.js';
import type { NormalizedResult, ResultAsset, TaskSnapshot } from '../../../task/results.js';
import type { TaskStatus } from '../../../task/status.js';
import { normalizeMiniMaxError } from '../errors.js';

const URL_TYPE: Record<MediaKind, 'image_url' | 'video_url' | 'audio_url'> = { image: 'image_url', video: 'video_url', audio: 'audio_url' };

/**
 * content[] = 1 条 text + 按 orderedAssets 顺序的素材（与提示词里 Image n 的编号一致），每个素材都显式写 role。
 * resolution / duration / ratio / extra 由字段声明写入。
 */
export function composeH3(c: BuildCtx): Record<string, unknown> {
  const kindOf = new Map(c.mode.slots.map((s) => [s.id, s.kind]));
  const content: Record<string, unknown>[] = [{ type: 'text', text: c.renderedPrompt }];
  for (const { asset, slotId, role } of orderedAssets(c.mode, c.input.slots)) {
    const type = URL_TYPE[kindOf.get(slotId) ?? 'image'];
    content.push({ type, [type]: { url: c.resolved[asset.id]?.wire ?? '' }, ...(role ? { role } : {}) });
  }
  return { model: c.model.apiModel, content };
}

/** 任务 id 可能是大整数：数字形态时从原始文本取，避免丢精度 */
function idOf(v: unknown, raw: string, key: 'task_id' | 'id'): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(raw)?.[1] ?? String(v);
  return null;
}

function badResponse(res: UpstreamResponse, message: string): NormalizedError {
  return makeError({ providerId: 'minimax', category: 'unknown', code: 'BAD_RESPONSE', httpStatus: res.status, message });
}

/** 创建：先走错误归一化；成功只有 {task_id}，没有 base_resp */
export function normalizeH3Submit(res: UpstreamResponse): NormalizedResult {
  const err = normalizeMiniMaxError(res);
  if (err) return { kind: 'error', error: err };
  const body = safeJson(res.bodyText);
  const taskId = isPlainObject(body) ? idOf(body.task_id, res.bodyText, 'task_id') : null;
  return taskId ? { kind: 'task-created', taskId } : { kind: 'error', error: badResponse(res, `Response has no task_id: ${res.bodyText.slice(0, 200)}`) };
}

const STATUS: Record<string, TaskStatus> = { queued: 'queued', running: 'running', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled' };

/**
 * task.error.code 是字符串（如 "1026"）：借用 MiniMax 错误码表归类（拼成 base_resp 形态），不带 HTTP 状态。
 * 没有 error 的失败任务给通用错误。
 */
function taskError(raw: unknown, res: UpstreamResponse): NormalizedError {
  const e = isPlainObject(raw) ? raw : {};
  const code = typeof e.code === 'string' ? e.code : typeof e.code === 'number' ? String(e.code) : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (code && code !== '0') {
    const mapped = normalizeMiniMaxError({ status: 200, headers: res.headers, bodyText: JSON.stringify({ base_resp: { status_code: code, status_msg: message } }) });
    if (mapped) {
      const { httpStatus: _http, ...rest } = mapped;
      return { ...rest, message: message || `Video generation failed (${code})` };
    }
  }
  return makeError({ providerId: 'minimax', category: 'unknown', code: code || 'TASK_FAILED', message: message || 'Video generation failed' });
}

const secToMs = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v * 1000 : undefined);

/**
 * 查询：{task:{id,status,error,content:{url},resolution,duration,usage,ratio,task_type,modality,...}}。
 * - content.url 有时效，具体时长文档未说明 → 不写 expiresAt（过期后重新查询可换新链接）
 * - V2 不返回尾帧图片，只有 1 个视频
 * - usage 在非成功任务上可能是 {}，空对象不写入
 * - succeeded 却没有 url：判为 failed（EMPTY_RESULT），与 Seedance 一致
 */
export function normalizeH3Task(res: UpstreamResponse): TaskSnapshot {
  const err = normalizeMiniMaxError(res);
  if (err) return { taskId: '', status: 'unknown', rawStatus: '', assets: [], error: err };
  const body = safeJson(res.bodyText);
  const task = isPlainObject(body) && isPlainObject(body.task) ? body.task : null;
  if (!task) return { taskId: '', status: 'unknown', rawStatus: '', assets: [], error: badResponse(res, `Response has no task object: ${res.bodyText.slice(0, 200)}`) };

  const rawStatus = typeof task.status === 'string' ? task.status : '';
  let status: TaskStatus = STATUS[rawStatus] ?? 'unknown';
  const assets: ResultAsset[] = [];
  let error: NormalizedError | undefined;

  if (status === 'succeeded') {
    const url = isPlainObject(task.content) && typeof task.content.url === 'string' ? task.content.url : '';
    if (url) assets.push({ index: 0, role: 'video', kind: 'video', source: { type: 'url', url } });
    else {
      // 未核实：文档只写 content 在成功后返回，没有"成功但暂时没有 url"的说法 → 不当作暂态
      status = 'failed';
      error = makeError({ providerId: 'minimax', category: 'unknown', code: 'EMPTY_RESULT', message: 'Task succeeded but content.url is missing' });
    }
  }
  if (status === 'failed' && !error) error = taskError(task.error, res);

  const actual: Record<string, unknown> = {};
  for (const k of ['model', 'resolution', 'duration', 'ratio', 'task_type', 'modality'] as const) {
    const v = task[k];
    if (v !== undefined && v !== null && v !== '') actual[k] = v;
  }
  const usage = isPlainObject(task.usage) && Object.keys(task.usage).length ? task.usage : undefined;
  const createdAt = secToMs(task.created_at);
  const updatedAt = secToMs(task.updated_at);

  return {
    taskId: idOf(task.id, res.bodyText, 'id') ?? '',
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

export const h3Adapter: FamilyAdapter = {
  compose: composeH3,
  normalizeSubmit: normalizeH3Submit,
  normalizeTask: normalizeH3Task,
};
