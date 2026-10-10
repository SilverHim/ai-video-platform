import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { isKeyId, KEY_SLOTS, keyKindsOf } from '../../shared/api-contract.js';
import { parsePlanRemains, type PlanQuotaItem } from '../../shared/providers/minimax/quota.js';
import type { CredentialKind, EvaluatedForm, FormInput, Issue, ModelDef, ProviderDef, ResolvedAssets, UpstreamResponse } from '../../shared/catalog/types.js';
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
import { isTerminal } from '../../shared/task/status.js';
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
  /** 任务记录建好时回调（解析素材、调用上游之前）：调用方可以先拿到任务 id */
  onRegistered?: (taskId: string) => void;
}

export interface PreviewResult {
  canSubmit: boolean;
  /** 需要上传到公共托管的素材（提交前要征得同意） */
  uploads: ConsentInfo;
  issues: Issue[];
  request: { method: string; url: string; body: Record<string, unknown>; bodyBytes: number; stream: boolean; endpointId: string };
  curl: string;
  cost: { amount: number; currency: 'USD'; basis: I18nText; confidence: string } | null;
  /** 有多种 Key 的服务商：这次会用哪种（订阅 Key 按接口单价从订阅额度扣，不扣余额）；只有一种 Key 时为 null */
  credential: { kind: CredentialKind; configured: boolean } | null;
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
    const assets = this.d.resolver.preview(evaluated, provider.id, opts.tempHost, Boolean(opts.publicUploadConsent));
    const built = buildRequest(provider, model, evaluated, assets, 'preview');
    noteReusedResults(built, assets);
    const uploads = this.d.resolver.consentInfo(evaluated, provider.id, opts.tempHost);
    noteInlinedForLackOfConsent(built, uploads, opts);
    // 与提交时一致：按已知的链接寿命（复用的原始链接、上传目标的保留时长）缩短执行超时
    adjustExpiryForUploads(built, assets, this.now());
    const ep = provider.endpoints[built.endpointId]!;
    const url = resolveUrl(provider, ep, defaultBaseUrlId(provider));
    const body = sanitizeForPreview(built.body);
    const issues = [...evaluated.issues, ...built.issues];
    const cost = model.estimateCost?.(evaluated.ctx) ?? null;
    const multiKey = keyKindsOf(provider.id).length > 1;
    const resolved = multiKey ? this.d.keystore.resolve(provider.id, form.credential) : null;
    const credential = multiKey ? { kind: resolved?.kind ?? form.credential ?? 'paygo', configured: Boolean(resolved) } : null;
    const keyEnvVar = credential?.kind === 'subscription' ? 'MINIMAX_SUBSCRIPTION_KEY' : (KEY_ENV_BY_PROVIDER[provider.id] ?? 'API_KEY');
    return {
      canSubmit: !issues.some((i) => i.severity === 'error'),
      uploads,
      issues,
      request: { method: built.method, url, body, bodyBytes: built.bodyBytes, stream: built.stream, endpointId: built.endpointId },
      curl: toCurl({ method: built.method, url, body, stream: built.stream, keyEnvVar }).command,
      cost,
      credential,
      notes: built.notes,
    };
  }

  /** 取 Key：指定了类型只用那种（不擅自换成按量）；没指定时有订阅用订阅，否则按量 */
  private credentials(provider: ProviderDef, pref?: CredentialKind): { key: string; kind: CredentialKind } {
    const r = this.d.keystore.resolve(provider.id, pref);
    if (r) return { key: r.key, kind: r.kind };
    if (this.d.mock) return { key: 'mock-key', kind: pref ?? 'paygo' };
    if (pref === 'subscription') throw new TaskInputError('missing_key', { zh: `还没有配置 ${provider.label.zh} 的订阅 Key（设置页填写）`, en: `No subscription key for ${provider.label.en} (set it in Settings)` }, [], 400);
    if (pref === 'paygo' && keyKindsOf(provider.id).length > 1) {
      throw new TaskInputError('missing_key', { zh: `还没有配置 ${provider.label.zh} 的按量 Key：可在设置页填写，或把「用哪个 Key」改选订阅 Key`, en: `No pay-as-you-go key for ${provider.label.en}: add one in Settings, or switch "Key" to the subscription key` }, [], 400);
    }
    throw new TaskInputError('missing_key', { zh: `还没有配置 ${provider.label.zh} 的 API Key（设置页填写）`, en: `No API key for ${provider.label.en} (set it in Settings)` }, [], 400);
  }

  private apiKey(provider: ProviderDef, pref?: CredentialKind): string {
    return this.credentials(provider, pref).key;
  }

  /** 这次提交会公开上传哪些素材（不读文件）：MCP 用来提示「同意公开上传可以加快提交」 */
  uploadPlan(form: FormInput, opts: SubmitOptions = {}): ConsentInfo {
    const p = this.prepare(form);
    return this.d.resolver.consentInfo(p.evaluated, p.provider.id, opts.tempHost);
  }

  /** 第一阶段：校验、建任务记录、解析素材、构建请求 */
  private async begin(form: FormInput, origin: TaskOrigin, opts: SubmitOptions = {}): Promise<{ p: Prepared; task: TaskRecord; built: BuiltRequest; apiKey: string }> {
    const p = this.prepare(form);
    const cred = this.credentials(p.provider, form.credential);
    const apiKey = cred.key;
    if (!p.evaluated.canSubmit) {
      throw new TaskInputError('invalid_form', { zh: '参数校验未通过', en: 'Validation failed' }, p.evaluated.issues.filter((i) => i.severity === 'error'));
    }
    const consent = this.d.resolver.consentInfo(p.evaluated, p.provider.id, opts.tempHost);
    if (consent.required && !opts.publicUploadConsent) {
      throw new TaskInputError('consent_required', { zh: `有 ${consent.files.filter((f) => !f.optional).length} 个本地视频需要上传到 ${consent.target.label.zh}（任何拿到链接的人都能下载），请确认后再提交`, en: `${consent.files.filter((f) => !f.optional).length} local video(s) must be uploaded to ${consent.target.label.en} (anyone with the link can download); confirm first` }, [], 428);
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
      // 有多种 Key 的服务商记下实际用的那种：之后轮询、取消用同一种
      form: { ...normalizeForm(form), ...(keyKindsOf(p.provider.id).length > 1 ? { credential: cred.kind } : {}) },
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
    opts.onRegistered?.(task.id);

    let built: BuiltRequest;
    try {
      const resolved = await this.d.resolver.resolve(p.evaluated, {
        providerId: p.provider.id,
        ...(opts.publicUploadConsent ? { publicUploadConsent: true } : {}),
        ...(opts.tempHost ? { tempHost: opts.tempHost } : {}),
        providerKey: apiKey,
      });
      built = buildRequest(p.provider, p.model, p.evaluated, resolved, 'send');
      noteReusedResults(built, resolved);
      noteInlinedForLackOfConsent(built, consent, opts);
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

  /**
   * 提交但不等上游完成：校验、建好任务就返回，上游调用与落盘在后台继续（done 在完成时兑现）。
   * MCP 的生成工具用它限定调用时长（opts.onRegistered 在解析素材之前就给出任务 id）；后台出意外时把任务记为失败，done 不会拒绝
   */
  async start(form: FormInput, origin: TaskOrigin, opts: SubmitOptions = {}): Promise<{ task: TaskRecord; done: Promise<TaskRecord> }> {
    if (this.closing) throw new TaskInputError('shutting_down', { zh: '服务正在关闭，请稍后再提交', en: 'The server is shutting down; submit again later' }, [], 503);
    // 从入口就登记：关闭时连还在解析素材（begin）的提交也要等
    let settle!: () => void;
    const op = new Promise<void>((resolve) => (settle = resolve));
    this.inflight.add(op);
    const finish = () => {
      settle();
      this.inflight.delete(op);
    };
    // 交给后台之前的任何失败（解析素材、读快照）都要撤销登记，否则 drain 只能等到超时
    let snapshot: TaskRecord;
    let started: Promise<TaskRecord>;
    let pTask: { providerId: string; id: string };
    try {
      const { p, task, built, apiKey } = await this.begin(form, origin, opts);
      snapshot = this.d.store.getTask(task.id) ?? task;
      pTask = { providerId: p.provider.id, id: task.id };
      started = this.execute(p, task, built, apiKey);
    } catch (err) {
      finish();
      throw err;
    }
    const task = pTask;
    const done = started.catch((err: unknown) => {
      // 兜底本身也可能失败（例如服务关闭时数据库已关）：只记日志，不再抛出
      try {
        const current = this.d.store.getTask(task.id);
        if (current && !isTerminal(current.status)) this.fail(task.id, makeError({ providerId: task.providerId, category: 'unknown', code: 'INTERNAL', message: String(err) }));
        return this.d.store.getTask(task.id) ?? snapshot;
      } catch (inner) {
        console.error(`[tasks] 后台任务 ${task.id} 出错且无法记录：`, err, inner);
        return snapshot;
      }
    });
    void done.finally(finish);
    return { task: snapshot, done };
  }

  /**
   * 服务启动时调用：把上次关闭时被打断的任务标成 submit_unknown（上游可能已生成并计费），
   * 避免它们永远停在「提交中」，也提醒不要直接重复提交
   */
  recoverInterrupted(): number {
    const stuck = this.d.store.listInterrupted();
    for (const t of stuck) {
      this.d.store.updateTask(t.id, {
        status: 'submit_unknown',
        error: makeError({
          providerId: t.providerId,
          category: 'unknown',
          code: 'INTERRUPTED',
          message: '服务关闭时任务还在进行，结果未知：上游可能已经生成并计费。请到服务商控制台核对，确认前不要直接重复提交',
        }),
      });
    }
    return stuck.length;
  }

  /** 正在上传的提交请求（只在内存里）：MCP 等待时报「已上传 x / y MB」 */
  private readonly uploads = new Map<string, { sent: number; total: number; startedAt: number; lastEmit: number }>();

  uploadProgress(taskId: string): { sent: number; total: number; startedAt: number } | null {
    const u = this.uploads.get(taskId);
    return u ? { sent: u.sent, total: u.total, startedAt: u.startedAt } : null;
  }

  /** start 发起、还没结束的提交（从入口算起，含解析素材阶段） */
  private readonly inflight = new Set<Promise<void>>();
  /** 已进入关闭流程：不再接受 start */
  private closing = false;

  /** 关闭前调用：不再接受新的 start，并等已有的提交收尾，最多等 timeoutMs；超时的任务在下次启动时按中断处理 */
  async drain(timeoutMs: number): Promise<void> {
    this.closing = true;
    if (this.inflight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled([...this.inflight]), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  }

  private async execute(p: Prepared, task: TaskRecord, built: BuiltRequest, apiKey: string): Promise<TaskRecord> {
    let res: UpstreamResponse;
    const bodyText = JSON.stringify(built.body);
    // 记下请求体大小与发送到响应的耗时：本地素材内联成 base64 时请求体可能有几十 MB，上传要几分钟
    const sent = { requestBytes: Buffer.byteLength(bodyText), startedAt: this.now() };
    const timing = () => ({ requestBytes: sent.requestBytes, durationMs: this.now() - sent.startedAt });
    const onUploadProgress = (bytes: number, total: number) => {
      const now = this.now();
      const cur = this.uploads.get(task.id) ?? { sent: 0, total, startedAt: sent.startedAt, lastEmit: 0 };
      cur.sent = bytes;
      cur.total = total;
      this.uploads.set(task.id, cur);
      if (bytes < total && now - cur.lastEmit < 1000) return;
      cur.lastEmit = now;
      this.d.events.emit({ type: 'task.progress', taskId: task.id, sent: bytes, total });
    };
    try {
      res = await this.d.upstream.call({ provider: p.provider, endpointId: built.endpointId, baseUrlId: task.baseUrlId, apiKey, bodyText, onUploadProgress });
    } catch (err) {
      const incomplete = err instanceof UpstreamError && err.requestIncomplete;
      const raw = err instanceof UpstreamError ? err.error : makeError({ providerId: p.provider.id, category: 'network', code: 'NETWORK', message: String(err) });
      // 请求体还没发完就断了：服务商不可能收到完整请求，不会建任务，可以放心重试
      const e = incomplete ? { ...raw, message: `${raw.message}。请求没有发完，服务商不会建任务，可以直接重新提交`, retryable: true } : raw;
      // 创建类请求不重试：请求已经发完、却没拿到响应时，上游可能已经建好任务，结果未知
      if (p.model.kind === 'async' && !incomplete) this.d.store.updateTask(task.id, { status: 'submit_unknown', error: e });
      else this.d.store.updateTask(task.id, { status: 'failed', error: e });
      this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'error', status: null, body: e.message, ...timing() });
      this.emit(task.id);
      return this.d.store.getTask(task.id)!;
    } finally {
      this.uploads.delete(task.id);
    }
    this.d.store.addExchange({ taskId: task.id, at: this.now(), kind: 'submit', status: res.status, body: truncateBody(res.bodyText), ...timing() });
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
   * 重新下载没落盘成功的结果（用保存的原始链接；链接已过期的跳过）。
   * 全部补齐后，因落盘失败而记为 partial 的任务改回 succeeded，并清掉落盘错误
   */
  async recapture(taskId: string): Promise<TaskRecord> {
    const task = this.d.store.getTask(taskId);
    if (!task) throw new TaskInputError('not_found', { zh: '任务不存在', en: 'Task not found' }, [], 404);
    const now = this.now();
    const pending = task.results.filter((r) => !r.path && r.remoteUrl && (r.remoteExpiresAt === null || r.remoteExpiresAt > now));
    if (pending.length === 0) {
      throw new TaskInputError('nothing_to_capture', { zh: '没有可以重新下载的结果（都已保存，或原始链接已过期）', en: 'Nothing to re-download (all saved, or links expired)' }, [], 409);
    }
    const assets: ResultAsset[] = pending.map((r) => ({
      index: r.index,
      role: r.role,
      kind: r.kind,
      source: { type: 'url', url: r.remoteUrl!, ...(r.remoteExpiresAt !== null ? { expiresAt: r.remoteExpiresAt } : {}) },
      ...(r.mime ? { mime: r.mime } : {}),
      ...(r.width ? { width: r.width } : {}),
      ...(r.height ? { height: r.height } : {}),
      ...(r.layer ? { layer: r.layer } : {}),
    }));
    this.d.store.updateTask(taskId, { capture: 'pending', outputDir: task.outputDir ?? this.d.capture.outputDirFor(task) });
    const out = await this.d.capture.capture(this.d.store.getTask(taskId)!, assets);
    const after = this.d.store.getTask(taskId)!;
    const allSaved = after.results.every((r) => r.path);
    const captureFailedOnly = after.error?.code === 'CAPTURE_FAILED';
    this.d.store.updateTask(taskId, {
      capture: allSaved ? 'done' : out.state === 'failed' ? 'failed' : 'partial',
      ...(allSaved && captureFailedOnly ? { error: null } : !allSaved ? { error: makeError({ providerId: task.providerId, category: 'network', code: 'CAPTURE_FAILED', message: out.errors.join('；') }) } : {}),
      ...(allSaved && captureFailedOnly && task.status === 'partial' && task.failures.length === 0 ? { status: 'succeeded' as const } : {}),
    });
    this.emit(taskId);
    return this.d.store.getTask(taskId)!;
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
    const apiKey = this.apiKey(found.provider, task.form.credential);
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
    // 云端任务列表用默认 Key（有订阅用订阅）：两种 Key 属于同一账号
    const err = provider.normalizeError(res);
    if (err) throw new TaskInputError('upstream_error', { zh: err.message, en: err.message }, [], res.status >= 400 ? res.status : 502);
    return { status: res.status, body: sanitizeForPreview(safeJson(res.bodyText) ?? null) };
  }

  /** 免费校验 Key（BytePlus / MiniMax 的任务列表接口） */
  /** 订阅 Key 的剩余额度（免费只读）。返回格式文档未写，按实测结构解析；不认识时 quota 为 null，界面展示原样 body */
  async quota(keyId: string): Promise<{ status: number; body: unknown; quota: PlanQuotaItem[] | null; error?: NormalizedError }> {
    if (!isKeyId(keyId) || KEY_SLOTS[keyId].kind !== 'subscription') throw new TaskInputError('not_supported', { zh: '只有订阅 Key 能查剩余额度', en: 'Only subscription keys have a quota' }, [], 400);
    const provider = this.catalog.getProvider(KEY_SLOTS[keyId].provider);
    if (!provider) throw new TaskInputError('unknown_provider', { zh: '未知服务商', en: 'Unknown provider' }, [], 404);
    const apiKey = this.apiKey(provider, 'subscription');
    try {
      const res = await this.d.upstream.call({ provider, endpointId: 'plan.remains', baseUrlId: 'www', apiKey });
      const err = provider.normalizeError(res);
      const body = safeJson(res.bodyText) ?? null;
      return { status: res.status, body, quota: err ? null : parsePlanRemains(body), ...(err ? { error: err } : {}) };
    } catch (err) {
      // 网络错误 / 超时 / 本机限速：带上具体原因，不要变成笼统的 500
      return { status: 0, body: null, quota: null, error: err instanceof UpstreamError ? err.error : makeError({ providerId: provider.id, category: 'network', code: 'NETWORK', message: String(err) }) };
    }
  }

  /** 免费校验某个 Key 槽位：订阅 Key 查剩余额度，按量 Key 走服务商的 keyTest */
  async testKey(keyId: string): Promise<{ ok: boolean; error?: NormalizedError; status?: number }> {
    if (!isKeyId(keyId)) throw new TaskInputError('unknown_key', { zh: `未知的 Key 槽位：${keyId}`, en: `Unknown key slot: ${keyId}` }, [], 404);
    const slot = KEY_SLOTS[keyId];
    const provider = this.catalog.getProvider(slot.provider);
    if (!provider?.keyTest) throw new TaskInputError('unknown_provider', { zh: `未知服务商：${slot.provider}`, en: `Unknown provider: ${slot.provider}` }, [], 404);
    const apiKey = this.apiKey(provider, slot.kind);
    const call =
      slot.kind === 'subscription'
        ? { endpointId: 'plan.remains', baseUrlId: 'www' }
        : { endpointId: provider.keyTest.endpointId, ...(provider.keyTest.query ? { query: provider.keyTest.query } : {}) };
    try {
      const res = await this.d.upstream.call({ provider, apiKey, ...call });
      const err = provider.normalizeError(res);
      return err ? { ok: false, error: err, status: res.status } : { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: err instanceof UpstreamError ? err.error : makeError({ providerId: slot.provider, category: 'network', code: 'NETWORK', message: String(err) }) };
    }
  }
}

/**
 * 用了有寿命的托管直链时（例如 uguu 3 小时），把 execution_expires_after 缩到"直链剩余寿命 − 1 小时"，
 * 避免任务排队太久、开始执行时素材链接已失效（下限 3600 秒）。
 */
/** 没同意公开上传：可选上传的本地图片按 base64 内联了，提示同意后可以加快 */
export function noteInlinedForLackOfConsent(built: BuiltRequest, uploads: ConsentInfo, opts: SubmitOptions): void {
  const n = uploads.files.filter((f) => f.optional).length;
  if (!n || opts.publicUploadConsent) return;
  built.notes.push({
    zh: `${n} 张本地图片按 base64 内联进请求体（没有同意公开上传）。同意公开上传后会先传到 ${uploads.target.label.zh}、请求里只放链接，提交快得多`,
    en: `${n} local image(s) are inlined as base64 (public upload not consented). With consent they are uploaded to ${uploads.target.label.en} first and only links are sent, which is much faster`,
  });
}

/** 本地素材改用了历史结果的原始链接：在说明里写清楚 */
export function noteReusedResults(built: BuiltRequest, resolved: ResolvedAssets): void {
  const refs = Object.values(resolved).flatMap((r) => (r.reusedFrom ? [`task:${r.reusedFrom.taskId}#${r.reusedFrom.index}`] : []));
  if (!refs.length) return;
  built.notes.push({
    zh: `${refs.length} 个本地素材就是以前的生成结果，已改用服务商的原始链接（${refs.join('、')}），不再内联或上传`,
    en: `${refs.length} local asset(s) are earlier results; using the provider's original links instead (${refs.join(', ')})`,
  });
}

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
    ...(form.credential === 'paygo' || form.credential === 'subscription' ? { credential: form.credential } : {}),
  };
}
