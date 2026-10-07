import type { ModelDef, ProviderDef, UpstreamResponse } from '../../shared/catalog/types.js';
import { T } from '../../shared/catalog/helpers.js';
import { safeJson } from '../../shared/task/errors.js';
import type { ResultAsset, TaskSnapshot } from '../../shared/task/results.js';
import { normalizeBytePlusError } from '../../shared/providers/byteplus/errors.js';
import type { Catalog } from '../tasks/task-service.js';

/** 测试用的假图像模型：响应格式与 Seedream 相同（data[].url / b64_json，流式 partial_* 事件） */
const parseItem = (d: Record<string, unknown>, i: number): ResultAsset => ({
  index: i,
  role: 'image',
  kind: 'image',
  source: typeof d.b64_json === 'string' ? { type: 'b64', data: d.b64_json, mime: 'image/png' } : { type: 'url', url: String(d.url) },
});

export const fakeModel: ModelDef = {
  id: 'fake/img',
  providerId: 'byteplus',
  apiModel: 'fake-img-001',
  family: 'fake',
  label: T('假图像模型', 'Fake image model'),
  output: 'image',
  kind: 'sync',
  lifecycle: { status: 'active' },
  docs: [],
  endpoints: { submit: 'image.generate', stream: 'image.stream' },
  modes: [
    {
      id: 'generate',
      label: T('生成', 'Generate'),
      slots: [{ id: 'image', kind: 'image', label: T('参考图', 'Reference'), min: 0, max: 2, sources: ['local', 'url', 'task-output'], spec: { formats: ['png', 'jpeg'], maxBytes: 10_000_000 } }],
      prompt: { required: true },
    },
  ],
  fields: [
    { key: 'stream', type: 'bool', label: T('流式', 'Stream'), group: 'output', wire: 'stream', default: false },
    { key: 'group', type: 'bool', label: T('组图', 'Group'), group: 'basic', wire: null, default: false, fragment: (v) => (v ? { sequential_image_generation: 'auto', sequential_image_generation_options: { max_images: 3 } } : null) },
    { key: 'b64', type: 'bool', label: T('base64', 'base64'), group: 'output', wire: null, default: false, fragment: (v) => (v ? { response_format: 'b64_json' } : null) },
  ],
  constraints: [],
  adapter: {
    compose: (c) => {
      const imgs = Object.keys(c.refOrder).map((id) => c.resolved[id]!.wire);
      return { model: c.model.apiModel, prompt: c.renderedPrompt, ...(imgs.length ? { image: imgs.length === 1 ? imgs[0] : imgs } : {}) };
    },
    normalizeSubmit: (res: UpstreamResponse) => {
      const body = safeJson(res.bodyText) as { data?: Record<string, unknown>[]; usage?: Record<string, unknown> } | undefined;
      const data = body?.data ?? [];
      const assets = data.map((d, i) => (d.error ? null : parseItem(d, i))).filter((a): a is ResultAsset => a !== null);
      const failures = data.flatMap((d, i) => (d.error ? [{ index: i, error: { providerId: 'byteplus', category: 'content_policy' as const, code: 'X', message: 'blocked', retryable: false } }] : []));
      return { kind: 'sync', status: failures.length ? 'partial' : 'succeeded', assets, failures, ...(body?.usage ? { usage: body.usage } : {}) };
    },
    parseStreamEvent: (ev) => {
      const d = safeJson(ev.data) as Record<string, unknown> | undefined;
      if (!d) return null;
      if (ev.event === 'image_generation.partial_succeeded') return { type: 'asset', asset: parseItem(d, Number(d.image_index)) };
      if (ev.event === 'image_generation.partial_failed') return { type: 'failure', failure: { index: Number(d.image_index), error: { providerId: 'byteplus', category: 'content_policy', code: 'X', message: 'blocked', retryable: false } } };
      if (ev.event === 'image_generation.completed') return { type: 'completed', ...(d.usage ? { usage: d.usage as Record<string, unknown> } : {}) };
      return null;
    },
  },
  estimateCost: () => ({ amount: 0.03, currency: 'USD', basis: T('$0.03/张', '$0.03/image'), confidence: 'list-price' }),
};

/** 测试用的假视频模型：请求 / 响应格式与 Seedance 相同 */
export const fakeVideoModel: ModelDef = {
  id: 'fake/video',
  providerId: 'byteplus',
  apiModel: 'fake-video-001',
  family: 'fake-video',
  label: T('假视频模型', 'Fake video model'),
  output: 'video',
  kind: 'async',
  lifecycle: { status: 'active' },
  docs: [],
  endpoints: { submit: 'video.create', get: 'video.get', cancel: 'video.delete', list: 'video.list' },
  modes: [
    { id: 't2v', label: T('文生视频', 'T2V'), slots: [], prompt: { required: true } },
    {
      id: 'ref',
      label: T('参考视频', 'Reference video'),
      slots: [{ id: 'reference_video', kind: 'video', role: 'reference_video', label: T('参考视频', 'Reference video'), min: 1, max: 2, sources: ['local', 'url', 'task-output'], spec: { formats: ['mp4', 'mov'], maxBytes: 200 * 1024 * 1024 } }],
      prompt: { required: true },
    },
  ],
  fields: [
    { key: 'expires', type: 'int', label: T('超时', 'Expires'), group: 'advanced', wire: 'execution_expires_after', default: 172800, min: 3600, max: 259200 },
    { key: 'resolution', type: 'enum', label: T('分辨率', 'Resolution'), group: 'basic', wire: 'resolution', default: '480p', options: [{ value: '480p' }, { value: '720p' }] },
    { key: 'last', type: 'bool', label: T('返回尾帧', 'Last frame'), group: 'output', wire: 'return_last_frame', default: true },
  ],
  constraints: [],
  adapter: {
    compose: (c) => ({
      model: c.model.apiModel,
      content: [{ type: 'text', text: c.renderedPrompt }, ...Object.keys(c.refOrder).map((id) => ({ type: 'video_url', video_url: { url: c.resolved[id]!.wire }, role: 'reference_video' }))],
    }),
    normalizeSubmit: (res) => {
      const body = safeJson(res.bodyText) as { id?: string } | undefined;
      return body?.id ? { kind: 'task-created', taskId: body.id } : { kind: 'error', error: { providerId: 'byteplus', category: 'unknown', code: 'NO_ID', message: 'no id', retryable: false } };
    },
    normalizeTask: (res) => {
      const b = safeJson(res.bodyText) as { id: string; status: string; content?: { video_url?: string; last_frame_url?: string }; error?: { code: string; message: string }; usage?: Record<string, unknown> };
      const map: Record<string, TaskSnapshot['status']> = { queued: 'queued', running: 'running', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', expired: 'expired' };
      const assets: ResultAsset[] = [];
      if (b.content?.video_url) assets.push({ index: 0, role: 'video', kind: 'video', source: { type: 'url', url: b.content.video_url } });
      if (b.content?.last_frame_url) assets.push({ index: 0, role: 'last_frame', kind: 'image', source: { type: 'url', url: b.content.last_frame_url } });
      return {
        taskId: b.id,
        status: map[b.status] ?? 'unknown',
        rawStatus: b.status,
        assets,
        ...(b.error ? { error: { providerId: 'byteplus', category: 'task_type' as const, code: b.error.code, message: b.error.message, retryable: false } } : {}),
        ...(b.usage ? { usage: b.usage } : {}),
      };
    },
  },
};

export const fakeProvider: ProviderDef = {
  id: 'byteplus',
  label: T('假服务商', 'Fake provider'),
  baseUrls: [{ id: 'ap-southeast-1', label: T('AP', 'AP'), url: 'https://ark.ap-southeast.bytepluses.com/api/v3', default: true }],
  auth: { scheme: 'bearer', keyHelpUrl: 'https://example.invalid' },
  endpoints: {
    'image.generate': { id: 'image.generate', method: 'POST', path: '/images/generations', timeoutMs: 10_000, retry: 'none' },
    'image.stream': { id: 'image.stream', method: 'POST', path: '/images/generations', timeoutMs: 10_000, retry: 'none', stream: true },
    'video.create': { id: 'video.create', method: 'POST', path: '/contents/generations/tasks', timeoutMs: 10_000, retry: 'none' },
    'video.get': { id: 'video.get', method: 'GET', path: '/contents/generations/tasks/{id}', timeoutMs: 10_000, retry: 'idempotent' },
    'video.delete': { id: 'video.delete', method: 'DELETE', path: '/contents/generations/tasks/{id}', timeoutMs: 10_000, retry: 'none' },
    'video.list': { id: 'video.list', method: 'GET', path: '/contents/generations/tasks', timeoutMs: 10_000, retry: 'idempotent' },
  },
  keyTest: { endpointId: 'video.list', query: { page_num: '1', page_size: '1' } },
  limits: { maxRequestBytes: 64_000_000 },
  polling: { firstDelayMs: 60_000, schedule: [], defaultIntervalMs: 60_000, queryWindowMs: 7 * 24 * 3600_000 },
  models: [fakeModel, fakeVideoModel],
  normalizeError: normalizeBytePlusError,
};

export const fakeCatalog: Catalog = {
  getProvider: (id) => (id === 'byteplus' ? fakeProvider : undefined),
  getModel: (id) => {
    const model = fakeProvider.models.find((m) => m.id === id);
    return model ? { provider: fakeProvider, model } : undefined;
  },
  listModels: () => fakeProvider.models.map((model) => ({ provider: fakeProvider, model })),
};

export const fakeForm = (over: Record<string, unknown> = {}) => ({ providerId: 'byteplus', modelId: 'fake/img', modeId: 'generate', values: {}, slots: {}, prompt: 'a cat', ...over });
