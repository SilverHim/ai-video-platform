import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  type ControlCredentialStatus,
  type EndpointCreateInput,
  type EndpointCreatePlan,
  type EndpointInfo,
  type EndpointUpdateInput,
  type HealthInfo,
  type KeyStatus,
  type ProviderId,
} from '../../shared/api-contract';
import type { FormInput, Issue, MediaMeta } from '../../shared/catalog/types';
import type { I18nText } from '../../shared/i18n';
import { SseParser } from '../../shared/sse/parse';
import type { NormalizedError } from '../../shared/task/errors';
import type { ExchangeRecord, PresetRecord, ServerEvent, TaskRecord, TemplateRecord } from '../../shared/task/records';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly i18n?: I18nText,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set(CLIENT_HEADER, CLIENT_HEADER_VALUE);
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const h = headers(init.headers);
  if (init.body && typeof init.body === 'string' && !h.has('content-type')) h.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers: h, credentials: 'same-origin' });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; i18n?: I18nText; issues?: Issue[] } } | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'http_error', err?.message ?? `HTTP ${res.status}`, err?.i18n, err?.issues ?? []);
  }
  return data as T;
}

export interface ConsentInfo {
  required: boolean;
  target: { id: string; label: I18nText; ttlMs: number; maxBytes: number; homepage?: string };
  files: { name: string; bytes: number | null }[];
}

export interface SubmitOpts {
  /** 已同意把本地视频上传到公共临时托管站 */
  consent?: boolean;
  /** uguu / tmpfiles */
  tempHost?: string;
}

const submitHeaders = (o: SubmitOpts = {}): Record<string, string> => ({
  ...(o.consent ? { 'x-upload-consent': '1' } : {}),
  ...(o.tempHost ? { 'x-upload-target': o.tempHost } : {}),
});

export interface PreviewResponse {
  canSubmit: boolean;
  uploads: ConsentInfo;
  issues: Issue[];
  request: { method: string; url: string; body: Record<string, unknown>; bodyBytes: number; stream: boolean; endpointId: string };
  curl: string;
  cost: { amount: number; currency: 'USD'; basis: I18nText; confidence: string } | null;
  notes: I18nText[];
}

export interface UploadedAsset {
  id: string;
  sha256: string;
  filename: string | null;
  mime: string;
  bytes: number;
  meta: MediaMeta | null;
}

export interface StreamHandlers {
  onTask?: (taskId: string) => void;
  onCapture?: (data: { results: TaskRecord['results']; errors: string[] }) => void;
  onFailure?: (data: unknown) => void;
  onError?: (err: NormalizedError | { code: string; message: string }) => void;
}

/** 读 SSE 响应流（fetch 版，可以带自定义请求头） */
/** /api/events 超过这么久没有任何事件（含 ping）就视为断线 */
const SSE_IDLE_MS = 45_000;

async function readSse(res: Response, onEvent: (event: string | null, data: string) => void, signal?: AbortSignal): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) onEvent(ev.event, ev.data);
    }
    for (const ev of parser.flush()) onEvent(ev.event, ev.data);
  } finally {
    reader.releaseLock();
  }
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  listKeys: () => request<{ keys: KeyStatus[] }>('/api/keys'),
  setKey: (provider: ProviderId, apiKey: string) => request<{ key: KeyStatus }>(`/api/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  clearKey: (provider: ProviderId) => request<{ key: KeyStatus }>(`/api/keys/${provider}`, { method: 'DELETE' }),

  /* BytePlus 控制面：AK/SK 与推理接入点（Endpoint）管理 */
  controlCredentials: () => request<{ credentials: ControlCredentialStatus }>('/api/control/credentials').then((r) => r.credentials),
  setControlCredentials: (accessKeyId: string, secretAccessKey: string) =>
    request<{ credentials: ControlCredentialStatus }>('/api/control/credentials', { method: 'PUT', body: JSON.stringify({ accessKeyId, secretAccessKey }) }).then((r) => r.credentials),
  clearControlCredentials: () => request<{ credentials: ControlCredentialStatus }>('/api/control/credentials', { method: 'DELETE' }).then((r) => r.credentials),
  testControlCredentials: () => request<{ ok: true; total: number | null }>('/api/control/credentials/test', { method: 'POST' }),
  listEndpoints: (opts: { modelId?: string; refresh?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.modelId) q.set('modelId', opts.modelId);
    if (opts.refresh) q.set('refresh', '1');
    const qs = q.toString();
    return request<{ items: EndpointInfo[] }>(`/api/endpoints${qs ? `?${qs}` : ''}`).then((r) => r.items);
  },
  planEndpoint: (input: EndpointCreateInput) => request<EndpointCreatePlan>('/api/endpoints/plan', { method: 'POST', body: JSON.stringify(input) }),
  createEndpoint: (input: EndpointCreateInput) => request<{ id: string; endpoint: EndpointInfo | null; warnings: I18nText[] }>('/api/endpoints', { method: 'POST', body: JSON.stringify(input) }),
  updateEndpoint: (id: string, input: EndpointUpdateInput) => request<{ ok: true; warnings: I18nText[] }>(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  startEndpoint: (id: string) => request<{ ok: true }>(`/api/endpoints/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  stopEndpoint: (id: string) => request<{ ok: true }>(`/api/endpoints/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  /** 删除需要确认头：值等于要删的 ID（界面二次确认后才调用） */
  deleteEndpoint: (id: string) => request<{ ok: true }>(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-confirm-delete': id } }),
  listPresets: (modelId?: string) => request<{ presets: PresetRecord[] }>(`/api/presets${modelId ? `?modelId=${encodeURIComponent(modelId)}` : ''}`).then((r) => r.presets),
  savePreset: (p: Pick<PresetRecord, 'name' | 'modelId' | 'modeId' | 'values' | 'prompt'> & { id?: string }) => request<{ preset: PresetRecord }>(`/api/presets${p.id ? `/${p.id}` : ''}`, { method: 'PUT', body: JSON.stringify(p) }).then((r) => r.preset),
  deletePreset: (id: string) => request<{ ok: true }>(`/api/presets/${id}`, { method: 'DELETE' }),
  listTemplates: () => request<{ templates: TemplateRecord[] }>('/api/templates').then((r) => r.templates),
  saveTemplate: (t: Pick<TemplateRecord, 'name' | 'text' | 'tags'> & { id?: string }) => request<{ template: TemplateRecord }>(`/api/templates${t.id ? `/${t.id}` : ''}`, { method: 'PUT', body: JSON.stringify(t) }).then((r) => r.template),
  deleteTemplate: (id: string) => request<{ ok: true }>(`/api/templates/${id}`, { method: 'DELETE' }),
  patchTask: (id: string, patch: { favorite?: boolean; note?: string | null }) => request<{ task: TaskRecord }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.task),
  reveal: (path: string, action: 'reveal' | 'open' = 'reveal') => request<{ ok: boolean }>(`/api/outputs/${action}`, { method: 'POST', body: JSON.stringify({ path }) }),
  rebuildHistory: () => request<{ scanned: number; restored: number }>('/api/outputs/rebuild', { method: 'POST', body: '{}' }),
  mcpInfo: () => request<{ url: string; token: string; command: string }>('/api/mcp'),
  rotateMcpToken: () => request<{ token: string }>('/api/mcp/rotate', { method: 'POST', body: '{}' }),
  testKey: (provider: ProviderId) => request<{ ok: boolean; status?: number; error?: NormalizedError }>(`/api/keys/${provider}/test`, { method: 'POST', body: '{}' }),

  preview: (form: FormInput, signal?: AbortSignal, opts: SubmitOpts = {}) => request<PreviewResponse>('/api/preview', { method: 'POST', body: JSON.stringify({ form }), headers: submitHeaders(opts), ...(signal ? { signal } : {}) }),
  submit: (form: FormInput, opts: SubmitOpts = {}) => request<{ task: TaskRecord }>('/api/tasks', { method: 'POST', body: JSON.stringify({ form }), headers: submitHeaders(opts) }).then((r) => r.task),

  /** 流式提交：返回最终任务；过程中通过回调推送进度 */
  async submitStream(form: FormInput, h: StreamHandlers = {}, opts: SubmitOpts = {}): Promise<TaskRecord | null> {
    const res = await fetch('/api/tasks/stream', { method: 'POST', headers: headers({ 'content-type': 'application/json', ...submitHeaders(opts) }), body: JSON.stringify({ form }), credentials: 'same-origin' });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; i18n?: I18nText; issues?: Issue[] } } | null;
      throw new ApiRequestError(res.status, err?.error?.code ?? 'http_error', err?.error?.message ?? `HTTP ${res.status}`, err?.error?.i18n, err?.error?.issues ?? []);
    }
    let final: TaskRecord | null = null;
    await readSse(res, (event, data) => {
      const parsed = JSON.parse(data) as unknown;
      if (event === 'ark.task') h.onTask?.((parsed as { taskId: string }).taskId);
      else if (event === 'ark.capture') h.onCapture?.(parsed as { results: TaskRecord['results']; errors: string[] });
      else if (event === 'ark.failure') h.onFailure?.(parsed);
      else if (event === 'ark.error') h.onError?.(parsed as NormalizedError);
      else if (event === 'ark.done') final = parsed as TaskRecord;
    });
    return final;
  },

  listTasks: (q: { limit?: number; before?: number; status?: string; providerId?: string; modelId?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return request<{ tasks: TaskRecord[] }>(`/api/tasks${qs.size ? `?${qs}` : ''}`).then((r) => r.tasks);
  },
  getTask: (id: string) => request<{ task: TaskRecord; exchanges: ExchangeRecord[] }>(`/api/tasks/${id}`),
  deleteTask: (id: string, remote = false) => request<{ ok: true }>(`/api/tasks/${id}${remote ? '?remote=1' : ''}`, { method: 'DELETE' }),
  cancelTask: (id: string) => request<{ ok: boolean; task: TaskRecord | null; error?: NormalizedError }>(`/api/tasks/${id}/cancel`, { method: 'POST', body: '{}' }),
  refreshTask: (id: string) => request<{ task: TaskRecord }>(`/api/tasks/${id}/refresh`, { method: 'POST', body: '{}' }).then((r) => r.task),

  async uploadAsset(file: File): Promise<UploadedAsset> {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: headers({ 'content-type': file.type || 'application/octet-stream', 'x-asset-filename': encodeURIComponent(file.name) }),
      body: file,
      credentials: 'same-origin',
    });
    const data = (await res.json()) as { asset?: UploadedAsset; error?: { code: string; message: string } };
    if (!res.ok || !data.asset) throw new ApiRequestError(res.status, data.error?.code ?? 'upload_failed', data.error?.message ?? '上传失败');
    return data.asset;
  },
  assetUrl: (id: string) => `/api/assets/${id}/content`,
  fileUrl: (path: string, download = false) => `/files/${path.split('/').map(encodeURIComponent).join('/')}${download ? '?download=1' : ''}`,

  /** 订阅服务端事件；断线自动重连；返回取消函数 */
  subscribe(onEvent: (ev: ServerEvent) => void, onStatus?: (connected: boolean) => void): () => void {
    let stopped = false;
    let ctrl: AbortController | null = null;
    const loop = async () => {
      let delay = 1000;
      while (!stopped) {
        const current = new AbortController();
        ctrl = current;
        // 看门狗：服务端每 20 秒发 ping；连接半死（如经代理时服务重启）收不到任何事件就主动断开重连
        let lastSeen = Date.now();
        const watchdog = setInterval(() => {
          if (Date.now() - lastSeen > SSE_IDLE_MS) current.abort();
        }, 5_000);
        try {
          const res = await fetch('/api/events', { headers: headers(), signal: current.signal, credentials: 'same-origin' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          onStatus?.(true);
          delay = 1000;
          await readSse(
            res,
            (event, data) => {
              lastSeen = Date.now();
              if (event === 'task.updated' || event === 'task.deleted') onEvent(JSON.parse(data) as ServerEvent);
            },
            current.signal,
          );
        } catch {
          // 断线：退避后重连
        } finally {
          clearInterval(watchdog);
        }
        onStatus?.(false);
        if (!stopped) await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15_000);
      }
    };
    void loop();
    return () => {
      stopped = true;
      ctrl?.abort();
    };
  },
};
