import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { EvaluatedForm, FormInput, Issue, ModelDef, ProviderDef, ResolvedAssets, UpstreamResponse } from '../../shared/catalog/types.js';
import { evaluate, CatalogLookupError } from '../../shared/engine/evaluate.js';
import type { I18nText } from '../../shared/i18n.js';
import * as registry from '../../shared/providers/registry.js';
import { buildRequest, type BuiltRequest } from '../../shared/request/build.js';
import { toCurl } from '../../shared/request/curl.js';
import { sanitizeForPreview } from '../../shared/request/sanitize.js';
import { SseParser, type SseEvent } from '../../shared/sse/parse.js';
import { makeError, safeJson, type NormalizedError } from '../../shared/task/errors.js';
import type { TaskOrigin, TaskRecord } from '../../shared/task/records.js';
import type { PartialFailure, ResultAsset } from '../../shared/task/results.js';
import { ResolveError, type AssetResolver, type ConsentInfo } from '../assets/resolver.js';
import type { CaptureService } from '../capture/capture.js';
import type { EventBus } from '../events.js';
import type { Keystore } from '../keystore.js';
import type { Store } from '../store/store.js';
import { headersToObject, resolveUrl, UpstreamError, type UpstreamClient } from '../upstream/http.js';

export const KEY_ENV_BY_PROVIDER: Record<string, string> = { byteplus: 'ARK_API_KEY', minimax: 'MINIMAX_API_KEY' };

export class TaskInputError extends Error {
  constructor(
    readonly code: string,
    readonly i18n: I18nText,
    readonly issues: Issue[] = [],
    readonly status = 400,
  ) {
    super(i18n.zh);
  }
}

export interface SubmitOptions {
  /** 用户已同意把本地视频上传到公共临时托管站 */
  publicUploadConsent?: boolean;
  /** 选用的临时托管站 id（uguu / tmpfiles） */
  tempHost?: string;
}

export interface PreviewResult {
  canSubmit: boolean;
  /** 需要上传到公共托管的素材（提交前要征得同意） */
  uploads: ConsentInfo;
  issues: Issue[];
  request: { method: string; url: string; body: Record<string, unknown>; bodyBytes: number; stream: boolean; endpointId: string };
  curl: string;
  cost: { amount: number; currency: 'USD'; basis: I18nText; confidence: string } | null;
  notes: I18nText[];
}

/** 模型目录（默认用全局注册表；测试可注入） */
export interface Catalog {
  getProvider: (id: string) => ProviderDef | undefined;
  getModel: (id: string) => { provider: ProviderDef; model: ModelDef } | undefined;
  listModels: (opts?: { includeHidden?: boolean }) => { provider: ProviderDef; model: ModelDef }[];
}

export interface TaskServiceDeps {
  catalog?: Catalog;
  store: Store;
  keystore: Keystore;
  upstream: UpstreamClient;
  capture: CaptureService;
  resolver: AssetResolver;
  events: EventBus;
  /** mock 模式下没有配置 Key 也能跑 */
  mock?: boolean;
  /** 异步任务创建成功后通知调度器开始轮询 */
  onTaskCreated?: (taskId: string) => void;
  now?: () => number;
}

interface Prepared {
  provider: ProviderDef;
  model: ModelDef;
  evaluated: EvaluatedForm;
}

const truncateBody = (text: string) => {
  const parsed = safeJson(text);
  return parsed === undefined ? text.slice(0, 20_000) : JSON.stringify(sanitizeForPreview(parsed));
};

/** 网页与 MCP 共用的任务入口：预览 / 提交 / 流式提交 / 落盘 */
export class TaskService {
  private readonly now: () => number;
  private readonly catalog: Catalog;

  constructor(private readonly d: TaskServiceDeps) {
    this.now = d.now ?? Date.now;
    this.catalog = d.catalog ?? registry;
  }

  private prepare(form: FormInput): Prepared {
    const found = this.catalog.getModel(form.modelId);
    const provider = this.catalog.getProvider(form.providerId);
    if (!found || !provider || found.provider.id !== provider.id) {
      throw new TaskInputError('unknown_model', { zh: `未知模型：${form.providerId}/${form.modelId}`, en: `Unknown model: ${form.providerId}/${form.modelId}` }, [], 404);
    }
    try {
      return { provider, model: found.model, evaluated: evaluate(provider, found.model, normalizeForm(form)) };
    } catch (err) {
      if (err instanceof CatalogLookupError) throw new TaskInputError('unknown_mode', { zh: err.message, en: err.message }, [], 400);
      throw err;
    }
  }

  preview(form: FormInput, opts: SubmitOptions = {}): PreviewResult {
    const { provider, model, evaluated } = this.prepare(form);
    const built = buildRequest(provider, model, evaluated, this.d.resolver.preview(evaluated, provider.id, opts.tempHost), 'preview');
    const ep = provider.endpoints[built.endpointId]!;
    const url = resolveUrl(provider, ep, defaultBaseUrlId(provider));
    const body = sanitizeForPreview(built.body);
    const issues = [...evaluated.issues, ...built.issues];
    const cost = model.estimateCost?.(evaluated.ctx) ?? null;
    return {
      canSubmit: !issues.some((i) => i.severity === 'error'),
      uploads: this.d.resolver.consentInfo(evaluated, provider.id, opts.tempHost),
      issues,
      request: { method: built.method, url, body, bodyBytes: built.bodyBytes, stream: built.stream, endpointId: built.endpointId },
      curl: toCurl({ method: built.method, url, body, stream: built.stream, keyEnvVar: KEY_ENV_BY_PROVIDER[provider.id] ?? 'API_KEY' }).command,
      cost,
      notes: built.notes,
    };
  }

  private apiKey(provider: ProviderDef): string {
    const key = this.d.keystore.get(provider.id);
    if (key) return key;
    if (this.d.mock) return 'mock-key';
    throw new TaskInputError('missing_key', { zh: `还没有配置 ${provider.label.zh} 的 API Key（设置页填写）`, en: `No API key for ${provider.label.en} (set it in Settings)` }, [], 400);
  }

  /** 第一阶段：校验、建任务记录、解析素材、构建请求 */
  private async begin(form: FormInput, origin: TaskOrigin, opts: SubmitOptions = {}): Promise<{ p: Prepared; task: TaskRecord; built: BuiltRequest; apiKey: string }> {
    const p = this.prepare(form);
    const apiKey = this.apiKey(p.provider);
    if (!p.evaluated.canSubmit) {
      throw new TaskInputError('invalid_form', { zh: '参数校验未通过', en: 'Validation failed' }, p.evaluated.issues.filter((i) => i.severity === 'error'));
    }
    const consent = this.d.resolver.consentInfo(p.evaluated, p.provider.id, opts.tempHost);
    if (consent.required && !opts.publicUploadConsent) {
      throw new TaskInputError('consent_required', { zh: `有 ${consent.files.length} 个本地视频需要上传到 ${consent.target.label.zh}（任何拿到链接的人都能下载），请确认后再提交`, en: `${consent.files.length} local video(s) must be uploaded to ${consent.target.label.en} (anyone with the link can download); confirm first` }, [], 428);
    }
    const now = this.now();
    const task: TaskRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      origin,
      providerId: p.provider.id,
      modelId: p.model.id,
      apiModel: (p.model.allowModelOverride && form.modelOverride) || p.model.apiModel,
      modeId: form.modeId,
      kind: p.model.kind,
      status: 'resolving_assets',
      upstreamTaskId: null,
      baseUrlId: defaultBaseUrlId(p.provider),
      form: normalizeForm(form),
      request: null,
      error: null,
      failures: [],
      usage: null,
      actual: null,
      capture: 'none',
      outputDir: null,
      parentTaskId: null,
      costEstimate: (() => {
        const c = p.model.estimateCost?.(p.evaluated.ctx);
        return c ? { amount: c.amount, currency: c.currency } : null;
      })(),
      favorite: false,
      note: null,
      results: [],
    };
    this.d.store.insertTask(task);
    this.emit(task.id);

    let built: BuiltRequest;
    try {
      const resolved = await this.d.resolver.resolve(p.evaluated, {
        providerId: p.provider.id,
        ...(opts.publicUploadConsent ? { publicUploadConsent: true } : {}),
        ...(opts.tempHost ? { tempHost: opts.tempHost } : {}),
        providerKey: apiKey,
      });
      built = buildRequest(p.provider, p.model, p.evaluated, resolved, 'send');
      adjustExpiryForUploads(built, resolved, this.now());
    } catch (err) {
      const e = err instanceof ResolveError ? err.i18n : { zh: String(err), en: String(err) };
      const code = err instanceof ResolveError ? err.code : 'ASSET_RESOLVE_FAILED';
      this.fail(task.id, makeError({ providerId: p.provider.id, category: code.startsWith('UPLOAD') ? 'upload' : 'local_validation', code, message: e.zh }));
      throw new TaskInputError('asset_resolve_failed', e, [], 400);
    }
    const blocking = built.issues.filter((i) => i.severity === 'error');
    if (blocking.length) {
      this.fail(task.id, makeError({ providerId: p.provider.id, category: blocking.some((i) => i.id === 'body:too-large') ? 'too_large' : 'local_validation', code: blocking[0]!.id, message: blocking.map((i) => i.message.zh).join('；') }));
      throw new TaskInputError('invalid_request', { zh: '请求未通过最终检查', en: 'Request failed final checks' }, blocking);
    }
    this.d.store.updateTask(task.id, { status: 'submitting', request: sanitizeForPreview(built.body) });
    this.emit(task.id);
    return { p, task: this.d.store.getTask(task.id)!, built, apiKey };
  }

  /** 非流式提交：同步图像在返回前完成落盘 */
  async submit(form: FormInput, origin: TaskOrigin, opts: SubmitOptions = {}): Promise<TaskRecord> {
    const { p, task, built, apiKey } = await this.begin(form, origin, opts);
    return this.execute(p, task, built, apiKey);
  }

  private async execute(p: Prepared, task: TaskRecord, built: BuiltRequest, apiKey: string): Promise<TaskRecord> {
    let res: UpstreamResponse;
    try {
      res = await this.d.upstream.call({ provider: p.provider, endpointId: built.endpointId, baseUrlId: task.baseUrlId, apiKey, bodyText: JSON.stringify(built.body) });
    } catch (err) {
      const e = err instanceof UpstreamError ? err.error : makeError({ providerId: p.provider.id, category: 'network', code: 'NETWORK', message: String(err) });
      // 创建类请求不重试：网络中断时结果未知
      if (p.model.kind === 'async') this.d.store.updateTask(task.id, { status: 'submit_unknown', error: e });
      else this.d.store.updateTask(task.id, { status: 'failed', error: e });
      this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'error', status: null, body: e.message });
      this.emit(task.id);
      return this.d.store.getTask(task.id)!;
    }
    this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'submit', status: res.status, body: truncateBody(res.bodyText) });
    return this.handleSubmitResponse(p, task, res);
  }

  private async handleSubmitResponse(p: Prepared, task: TaskRecord, res: UpstreamResponse): Promise<TaskRecord> {
    const err = p.provider.normalizeError(res);
    if (err) {
      this.fail(task.id, err);
      return this.d.store.getTask(task.id)!;
    }
    const normalized = p.model.adapter.normalizeSubmit(res);
    if (normalized.kind === 'error') {
      this.fail(task.id, normalized.error);
    } else if (normalized.kind === 'task-created') {
      this.d.store.updateTask(task.id, { status: 'queued', upstreamTaskId: normalized.taskId, outputDir: this.d.capture.outputDirFor({ ...task, upstreamTaskId: normalized.taskId }) });
      this.emit(task.id);
      this.d.onTaskCreated?.(task.id);
    } else {
      this.d.store.updateTask(task.id, { status: 'running', failures: normalized.failures, usage: normalized.usage ?? null });
      this.emit(task.id);
      await this.captureAndFinish(task.id, normalized.assets, normalized.status, normalized.failures, normalized.error);
    }
    return this.d.store.getTask(task.id)!;
  }

  private async captureAndFinish(taskId: string, assets: ResultAsset[], status: 'succeeded' | 'partial' | 'failed', failures: PartialFailure[], error?: NormalizedError): Promise<void> {
    const task = this.d.store.getTask(taskId)!;
    this.d.store.updateTask(taskId, { capture: 'pending', outputDir: task.outputDir ?? this.d.capture.outputDirFor(task) });
    const out = await this.d.capture.capture(this.d.store.getTask(taskId)!, assets);
    const finalStatus = status === 'succeeded' && out.state !== 'done' ? 'partial' : status;
    this.d.store.updateTask(taskId, {
      status: finalStatus,
      capture: out.state,
      outputDir: out.outputDir,
      failures,
      ...(error ? { error } : out.errors.length ? { error: makeError({ providerId: task.providerId, category: 'network', code: 'CAPTURE_FAILED', message: out.errors.join('；') }) } : {}),
    });
    this.emit(taskId);
  }

  /**
   * 流式提交（Seedream SSE）：每收到一张图立刻落盘，并把事件转发给调用方。
   * 调用方断开不影响上游读取与落盘。
   */
  async submitStream(form: FormInput, origin: TaskOrigin, send: (ev: { event: string; data: string }) => void, opts: SubmitOptions = {}): Promise<TaskRecord> {
    const { p, task, built, apiKey } = await this.begin(form, origin, opts);
    const safeSend = (event: string, data: unknown) => {
      try {
        send({ event, data: typeof data === 'string' ? data : JSON.stringify(data) });
      } catch {
        // 客户端已断开：继续落盘
      }
    };
    safeSend('ark.task', { taskId: task.id });
    if (!built.stream || !p.model.adapter.parseStreamEvent) {
      const done = await this.execute(p, task, built, apiKey);
      safeSend(done.status === 'failed' ? 'ark.error' : 'ark.done', done.status === 'failed' ? done.error : done);
      return done;
    }
    const ep = p.provider.endpoints[built.endpointId]!;
    let response: Response;
    try {
      response = await this.d.upstream.raw({ provider: p.provider, endpointId: built.endpointId, baseUrlId: task.baseUrlId, apiKey, bodyText: JSON.stringify(built.body) }, ep, resolveUrl(p.provider, ep, task.baseUrlId));
    } catch (err) {
      const e = err instanceof UpstreamError ? err.error : makeError({ providerId: p.provider.id, category: 'network', code: 'NETWORK', message: String(err) });
      this.fail(task.id, e);
      safeSend('ark.error', e);
      return this.d.store.getTask(task.id)!;
    }
    const ctype = response.headers.get('content-type') ?? '';
    if (!ctype.includes('text/event-stream')) {
      const res: UpstreamResponse = { status: response.status, headers: headersToObject(response.headers), bodyText: await response.text() };
      this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'submit', status: res.status, body: truncateBody(res.bodyText) });
      const done = await this.handleSubmitResponse(p, task, res);
      safeSend(done.status === 'failed' ? 'ark.error' : 'ark.done', done.status === 'failed' ? done.error : done);
      return done;
    }

    this.d.store.updateTask(task.id, { status: 'streaming', capture: 'pending', outputDir: this.d.capture.outputDirFor(task) });
    this.emit(task.id);
    const parser = new SseParser();
    const failures: PartialFailure[] = [];
    const assets: ResultAsset[] = [];
    let streamError: NormalizedError | undefined;
    let usage: Record<string, unknown> | undefined;
    const log: string[] = [];
    const captures: Promise<void>[] = [];

    const onEvent = (ev: SseEvent) => {
      log.push(`${ev.event ? `event: ${ev.event}\n` : ''}data: ${truncateBody(ev.data)}`);
      if (ev.data === '[DONE]') return;
      const upd = p.model.adapter.parseStreamEvent!({ event: ev.event, data: ev.data });
      if (!upd) return;
      if (upd.type === 'asset') {
        assets.push(upd.asset);
        const asset = upd.asset;
        safeSend('ark.asset', { index: asset.index, role: asset.role });
        captures.push(
          this.d.capture
            .capture(this.d.store.getTask(task.id)!, [asset])
            .then((out) => {
              safeSend('ark.capture', { results: out.results, errors: out.errors });
              this.emit(task.id);
            }),
        );
      } else if (upd.type === 'failure') {
        failures.push(upd.failure);
        safeSend('ark.failure', upd.failure);
      } else if (upd.type === 'completed') {
        usage = upd.usage;
      } else if (upd.type === 'error') {
        streamError = upd.error;
        safeSend('ark.error', upd.error);
      }
    };

    try {
      const decoder = new TextDecoder();
      for await (const chunk of Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)) {
        for (const ev of parser.feed(decoder.decode(chunk as Uint8Array, { stream: true }))) onEvent(ev);
      }
      for (const ev of parser.flush()) onEvent(ev);
    } catch (err) {
      streamError ??= makeError({ providerId: p.provider.id, category: 'network', code: 'STREAM_INTERRUPTED', message: err instanceof Error ? err.message : String(err) });
      safeSend('ark.error', streamError);
    }
    await Promise.allSettled(captures);
    this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'sse', status: response.status, body: log.join('\n\n') });

    const results = this.d.store.listResults(task.id);
    const saved = results.filter((r) => r.path).length;
    const status = streamError && saved === 0 ? 'failed' : streamError || failures.length || saved < assets.length ? 'partial' : 'succeeded';
    this.d.store.updateTask(task.id, {
      status: assets.length === 0 && !streamError ? 'failed' : status,
      capture: assets.length === 0 ? 'none' : saved === assets.length ? 'done' : saved === 0 ? 'failed' : 'partial',
      failures,
      usage: usage ?? null,
      ...(streamError ? { error: streamError } : assets.length === 0 ? { error: makeError({ providerId: p.provider.id, category: 'unknown', code: 'EMPTY_STREAM', message: '流式响应没有返回任何图片' }) } : {}),
    });
    this.emit(task.id);
    const done = this.d.store.getTask(task.id)!;
    safeSend('ark.done', done);
    return done;
  }

  private fail(taskId: string, error: NormalizedError): void {
    this.d.store.updateTask(taskId, { status: 'failed', error });
    this.d.store.addExchange({ taskId, at: this.now(), kind: 'error', status: error.httpStatus ?? null, body: JSON.stringify(error) });
    this.emit(taskId);
  }

  emit(taskId: string): void {
    const task = this.d.store.getTask(taskId);
    if (task) this.d.events.emit({ type: 'task.updated', task });
  }

  /**
   * 取消排队中的任务，或删除云端记录（服务商规则：queued → 取消；succeeded/failed/expired → 删除记录；running/cancelled 不能操作）
   */
  async cancelOrDeleteRemote(taskId: string): Promise<{ ok: boolean; task: TaskRecord | null; error?: NormalizedError }> {
    const task = this.d.store.getTask(taskId);
    if (!task) throw new TaskInputError('not_found', { zh: '任务不存在', en: 'Task not found' }, [], 404);
    const found = this.catalog.getModel(task.modelId);
    const ep = found?.model.endpoints.cancel;
    if (!found || !ep || !task.upstreamTaskId) throw new TaskInputError('not_supported', { zh: '该任务不支持取消或删除云端记录', en: 'Cancel/delete is not supported for this task' }, [], 400);
    if (task.status === 'running' || task.status === 'streaming') throw new TaskInputError('not_allowed', { zh: '生成中的任务不能取消', en: 'Running tasks cannot be cancelled' }, [], 409);
    const apiKey = this.apiKey(found.provider);
    const res = await this.d.upstream.call({ provider: found.provider, endpointId: ep, baseUrlId: task.baseUrlId, apiKey, pathParams: { id: task.upstreamTaskId } }).catch((err: unknown) => {
      throw new TaskInputError('upstream_error', { zh: err instanceof Error ? err.message : String(err), en: err instanceof Error ? err.message : String(err) }, [], 502);
    });
    this.d.store.addExchange({ taskId, at: this.now(), kind: 'cancel', status: res.status, body: truncateBody(res.bodyText) });
    const err = found.provider.normalizeError(res);
    if (err) return { ok: false, task: this.d.store.getTask(taskId), error: err };
    if (task.status === 'queued') {
      this.d.store.updateTask(taskId, { status: 'cancelled' });
      this.emit(taskId);
    }
    return { ok: true, task: this.d.store.getTask(taskId) };
  }

  /** 云端任务列表（手动刷新用；BytePlus 列表接口 QPS 只有 1） */
  async listRemote(providerId: string, query: Record<string, string>): Promise<{ status: number; body: unknown }> {
    const provider = this.catalog.getProvider(providerId);
    const ep = provider && Object.values(provider.endpoints).find((e) => e.id === 'video.list');
    if (!provider || !ep) throw new TaskInputError('unknown_provider', { zh: `未知服务商：${providerId}`, en: `Unknown provider: ${providerId}` }, [], 404);
    const res = await this.d.upstream.call({ provider, endpointId: ep.id, apiKey: this.apiKey(provider), query });
    const err = provider.normalizeError(res);
    if (err) throw new TaskInputError('upstream_error', { zh: err.message, en: err.message }, [], res.status >= 400 ? res.status : 502);
    return { status: res.status, body: sanitizeForPreview(safeJson(res.bodyText) ?? null) };
  }

  /** 免费校验 Key（BytePlus / MiniMax 的任务列表接口） */
  async testKey(providerId: string): Promise<{ ok: boolean; error?: NormalizedError; status?: number }> {
    const provider = this.catalog.getProvider(providerId);
    if (!provider?.keyTest) throw new TaskInputError('unknown_provider', { zh: `未知服务商：${providerId}`, en: `Unknown provider: ${providerId}` }, [], 404);
    const apiKey = this.apiKey(provider);
    try {
      const res = await this.d.upstream.call({ provider, endpointId: provider.keyTest.endpointId, apiKey, ...(provider.keyTest.query ? { query: provider.keyTest.query } : {}) });
      const err = provider.normalizeError(res);
      return err ? { ok: false, error: err, status: res.status } : { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: err instanceof UpstreamError ? err.error : makeError({ providerId, category: 'network', code: 'NETWORK', message: String(err) }) };
    }
  }
}

/**
 * 用了有寿命的托管直链时（例如 uguu 3 小时），把 execution_expires_after 缩到"直链剩余寿命 − 1 小时"，
 * 避免任务排队太久、开始执行时素材链接已失效（下限 3600 秒）。
 */
export function adjustExpiryForUploads(built: BuiltRequest, resolved: ResolvedAssets, now: number): void {
  if (!('execution_expires_after' in built.body)) return;
  const expiries = Object.values(resolved).map((r) => r.expiresAt).filter((x): x is number => typeof x === 'number' && x > now);
  if (!expiries.length) return;
  const limit = Math.floor((Math.min(...expiries) - now) / 1000) - 3600;
  const current = Number(built.body.execution_expires_after);
  const next = Math.max(3600, Math.min(Number.isFinite(current) ? current : 172800, limit));
  if (next !== current) {
    built.body.execution_expires_after = next;
    built.notes.push({ zh: `素材直链约 ${Math.round((Math.min(...expiries) - now) / 3600_000)} 小时后过期，已把 execution_expires_after 调整为 ${next} 秒`, en: `Asset links expire in ~${Math.round((Math.min(...expiries) - now) / 3600_000)}h; execution_expires_after set to ${next}s` });
  }
}

function defaultBaseUrlId(provider: ProviderDef): string {
  return (provider.baseUrls.find((b) => b.default) ?? provider.baseUrls[0])!.id;
}

/** 规范化表单：补齐缺省字段 */
export function normalizeForm(form: FormInput): FormInput {
  return {
    providerId: form.providerId,
    modelId: form.modelId,
    modeId: form.modeId,
    values: form.values ?? {},
    slots: form.slots ?? {},
    prompt: form.prompt ?? '',
    ...(form.rawOverrides ? { rawOverrides: form.rawOverrides } : {}),
    ...(form.modelOverride ? { modelOverride: form.modelOverride } : {}),
    ...(form.derivedFrom ? { derivedFrom: form.derivedFrom } : {}),
  };
}
