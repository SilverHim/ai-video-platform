import type { BuildCtx, FamilyAdapter, UpstreamResponse } from '../../../catalog/types.js';
import type { LayerInfo, NormalizedResult, PartialFailure, ResultAsset, StreamUpdate } from '../../../task/results.js';
import { makeError, safeJson, type NormalizedError } from '../../../task/errors.js';
import { normalizeBytePlusError } from '../errors.js';

/** 结果 URL 生成后 24 小时内有效 */
export const URL_TTL_MS = 24 * 60 * 60 * 1000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 请求体里 Seedream 特有部分：model、prompt、image（1 张字符串、多张数组）。
 * 本平台保证数组顺序与提示词里渲染出的 "Image n" 编号一致；官方按数组顺序解释 Image n 的依据见 models.ts 的 refLabel 注释
 */
export function composeSeedream(c: BuildCtx): Record<string, unknown> {
  const ids = Object.entries(c.refOrder)
    .filter(([, r]) => r.kind === 'image')
    .sort((a, b) => a[1].n - b[1].n)
    .map(([id]) => id);
  // 未解析的素材留空串，由 image-resolved guard 拦截，保证编号不错位
  const images = ids.map((id) => c.resolved[id]?.wire ?? '');
  return {
    model: c.model.apiModel,
    ...(c.renderedPrompt ? { prompt: c.renderedPrompt } : {}),
    ...(images.length === 1 ? { image: images[0] } : images.length > 1 ? { image: images } : {}),
  };
}

/*
 * 文档冲突：error.code 可能是错误码表的 Type 列（如流式样例的 BadRequest）也可能是 Code 列；
 * 单张失败与流式错误没有独立 HTTP 状态，按错误码表的 HTTP 列推断，只用于归类。
 */
const CODE_STATUS: [RegExp, number][] = [
  [/^(BadRequest|MissingParameter|InvalidParameter|InvalidImageURL|InvalidEndpoint\.|\w*SensitiveContentDetected)/, 400],
  [/^(Unauthorized|AuthenticationError|InvalidAccountStatus)/, 401],
  [/^(Forbidden|AccessDenied|OperationDenied|AccountOverdueError)/, 403],
  [/^(NotFound|InvalidEndpointOrModel|ModelNotOpen)/, 404],
  [/^(TooManyRequests|\w*RateLimitExceeded|QuotaExceeded|SetLimitExceeded|InflightBatchsizeExceeded|ServerOverloaded|RequestBurstTooFast)/, 429],
  [/^(InternalServerError|InternalServiceError)/, 500],
];

function embeddedError(err: Obj): NormalizedError {
  const code = typeof err.code === 'string' ? err.code : '';
  // 推断不出时按 200 处理：归类只看错误码
  const status = CODE_STATUS.find(([re]) => re.test(code))?.[1] ?? 200;
  const e = normalizeBytePlusError({ status, headers: {}, bodyText: JSON.stringify({ error: err }) });
  if (!e) return makeError({ providerId: 'byteplus', category: 'unknown', code: code || 'UNKNOWN', message: String(err.message ?? '') });
  const { httpStatus: _inferred, ...rest } = e;
  return rest;
}

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg' };

function parseSize(s: unknown): { width: number; height: number } | null {
  const m = typeof s === 'string' ? /^(\d+)x(\d+)$/.exec(s.trim()) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

type Box = [number, number, number, number];

function box(v: unknown): Box | undefined {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number') ? (v as Box) : undefined;
}

/** bounding_box.normalized 是 [0,1000] 的整数（不同于交互式编辑输入的 0–999），换算成 0–1 */
export const BBOX_NORM_SCALE = 1000;
const toUnit = (b: Box): Box => b.map((n) => n / BBOX_NORM_SCALE) as Box;

/** data[] 中的一项（或流式 partial_succeeded 事件）→ ResultAsset */
function toAsset(item: Obj, index: number, created: number | undefined): ResultAsset | null {
  const mime = typeof item.output_format === 'string' ? MIME[item.output_format] : undefined;
  let source: ResultAsset['source'];
  if (typeof item.url === 'string' && item.url) {
    // created 是请求创建时间，按它推算过期时间偏保守
    source = { type: 'url', url: item.url, ...(created !== undefined ? { expiresAt: created * 1000 + URL_TTL_MS } : {}) };
  } else if (typeof item.b64_json === 'string' && item.b64_json) {
    source = { type: 'b64', data: item.b64_json, ...(mime ? { mime } : {}) };
  } else return null;

  const size = parseSize(item.size);
  const asset: ResultAsset = { index, role: 'image', kind: 'image', source, ...(size ?? {}), ...(mime ? { mime } : {}) };
  if (typeof item.z_index === 'number') {
    // 图层分解：z_index 0 为底图，图层从 1 递增；bounding_box 只有图层返回
    asset.role = item.z_index === 0 ? 'base' : 'layer';
    const bb = isObj(item.bounding_box) ? item.bounding_box : {};
    const abs = box(bb.absolute);
    const norm = box(bb.normalized);
    const layer: LayerInfo = {
      zIndex: item.z_index,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(abs ? { bboxAbs: abs } : {}),
      ...(norm ? { bboxNorm: toUnit(norm) } : {}),
    };
    asset.layer = layer;
  }
  return asset;
}

const badResponse = (status: number, message: string): NormalizedResult => ({
  kind: 'error',
  error: makeError({ providerId: 'byteplus', category: 'unknown', code: 'BAD_RESPONSE', httpStatus: status, message }),
});

/** 同步响应：data[] 成功项 → assets，data[].error → failures；顶层 error → kind:'error' */
export function normalizeSeedreamSubmit(res: UpstreamResponse): NormalizedResult {
  const err = normalizeBytePlusError(res);
  if (err) return { kind: 'error', error: err };
  const body = safeJson(res.bodyText);
  if (!isObj(body) || !Array.isArray(body.data)) return badResponse(res.status, '响应里没有 data 数组');

  const created = typeof body.created === 'number' ? body.created : undefined;
  const assets: ResultAsset[] = [];
  const failures: PartialFailure[] = [];
  body.data.forEach((item: unknown, i) => {
    if (!isObj(item)) return;
    if (isObj(item.error)) {
      failures.push({ index: i, error: embeddedError(item.error) });
      return;
    }
    const a = toAsset(item, i, created);
    if (a) assets.push(a);
    else failures.push({ index: i, error: makeError({ providerId: 'byteplus', category: 'unknown', code: 'EMPTY_ITEM', message: '该项既没有 url 也没有 b64_json' }) });
  });

  const usage = isObj(body.usage) ? body.usage : undefined;
  const status = assets.length === 0 ? 'failed' : failures.length ? 'partial' : 'succeeded';
  const error = status === 'failed' ? (failures[0]?.error ?? makeError({ providerId: 'byteplus', category: 'unknown', code: 'EMPTY_RESULT', httpStatus: res.status, message: '响应没有返回任何图片' })) : undefined;
  return { kind: 'sync', status, assets, failures, ...(usage ? { usage } : {}), ...(error ? { error } : {}) };
}

/** 流式事件：partial_succeeded / partial_failed / completed / 顶层 error；[DONE] 与未知事件返回 null */
export function parseSeedreamStreamEvent(ev: { event: string | null; data: string }): StreamUpdate | null {
  const raw = ev.data.trim();
  if (!raw || raw === '[DONE]') return null;
  const body = safeJson(raw);
  if (!isObj(body)) return null;
  const type = ev.event ?? (typeof body.type === 'string' ? body.type : null);
  const created = typeof body.created === 'number' ? body.created : undefined;
  const index = typeof body.image_index === 'number' ? body.image_index : 0;

  if (type === 'image_generation.partial_succeeded') {
    const asset = toAsset(body, index, created);
    return asset ? { type: 'asset', asset } : { type: 'failure', failure: { index, error: makeError({ providerId: 'byteplus', category: 'unknown', code: 'EMPTY_ITEM', message: '事件既没有 url 也没有 b64_json' }) } };
  }
  if (type === 'image_generation.partial_failed') {
    const error = isObj(body.error) ? embeddedError(body.error) : makeError({ providerId: 'byteplus', category: 'unknown', code: 'UNKNOWN', message: '单张生成失败' });
    return { type: 'failure', failure: { index, error } };
  }
  if (type === 'image_generation.completed') {
    // input_images 文档只标给不支持流式的 pro/flash，按可选字段透传
    return { type: 'completed', ...(isObj(body.usage) ? { usage: body.usage } : {}) };
  }
  // 未核实：整单失败时帧里是否带 "event: error" 行，按 data 里的 error.error 判断
  if (isObj(body.error)) return { type: 'error', error: embeddedError(body.error) };
  // 未核实：image_generation.partial_image 只出现在 Python SDK 示例，事件文档未定义，忽略
  return null;
}

export const SEEDREAM_ADAPTER: FamilyAdapter = {
  compose: composeSeedream,
  normalizeSubmit: normalizeSeedreamSubmit,
};

export const SEEDREAM_STREAM_ADAPTER: FamilyAdapter = {
  ...SEEDREAM_ADAPTER,
  parseStreamEvent: parseSeedreamStreamEvent,
};
