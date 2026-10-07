import type { ModelDef, PollingPolicy, ProviderDef } from '../../shared/catalog/types.js';
import { sanitizeForPreview } from '../../shared/request/sanitize.js';
import { makeError, safeJson } from '../../shared/task/errors.js';
import type { TaskRecord } from '../../shared/task/records.js';
import { isTerminal } from '../../shared/task/status.js';
import type { CaptureService } from '../capture/capture.js';
import type { Keystore } from '../keystore.js';
import type { PollState, Store } from '../store/store.js';
import { UpstreamError, type UpstreamClient } from '../upstream/http.js';
import type { Catalog } from './task-service.js';

const DEFAULT_POLICY: PollingPolicy = { firstDelayMs: 5_000, schedule: [], defaultIntervalMs: 15_000, queryWindowMs: 7 * 24 * 3600_000 };
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_BACKOFF_MS = 60_000;

export interface SchedulerDeps {
  store: Store;
  keystore: Keystore;
  upstream: UpstreamClient;
  capture: CaptureService;
  catalog: Catalog;
  emit: (taskId: string) => void;
  mock?: boolean;
  now?: () => number;
  /** 可注入定时器（测试用假时钟） */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  random?: () => number;
}

/** 下一次轮询间隔：按任务年龄匹配 schedule，±10% 抖动 */
export function nextInterval(policy: PollingPolicy, ageMs: number, random: () => number = Math.random): number {
  const step = policy.schedule.find((s) => ageMs < s.untilAgeMs);
  const base = step?.intervalMs ?? policy.defaultIntervalMs;
  return Math.round(base * (0.9 + random() * 0.2));
}

/**
 * 服务端轮询调度器：异步视频任务在这里查询状态，成功后自动落盘。
 * 状态存在 SQLite，服务重启后 start() 会接着轮询；与网页是否打开无关。
 */
export class Scheduler {
  private timers = new Map<string, unknown>();
  private inflight = new Set<string>();
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  private readonly random: () => number;

  constructor(private readonly d: SchedulerDeps) {
    this.now = d.now ?? Date.now;
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref());
    this.clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
    this.random = d.random ?? Math.random;
  }

  /** 恢复所有未结束的异步任务 */
  start(): void {
    for (const t of this.d.store.listActiveAsync()) {
      const poll = this.d.store.getPoll(t.id);
      if (poll?.pausedReason) continue;
      this.schedule(t.id, Math.max(0, (poll?.nextAt ?? this.now()) - this.now()));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) this.clearTimer(t);
    this.timers.clear();
  }

  /** 新建任务后调用：按服务商策略安排首次查询 */
  track(taskId: string): void {
    const task = this.d.store.getTask(taskId);
    if (!task) return;
    const policy = this.policyOf(task);
    const nextAt = this.now() + policy.firstDelayMs;
    this.d.store.setPoll(taskId, { nextAt, attempts: 0, consecutiveErrors: 0 });
    this.schedule(taskId, policy.firstDelayMs);
  }

  /** 立即重查（手动刷新 / 恢复暂停的任务） */
  async refresh(taskId: string): Promise<TaskRecord | null> {
    const poll = this.d.store.getPoll(taskId);
    if (poll?.pausedReason) this.d.store.setPoll(taskId, { ...poll, pausedReason: undefined, consecutiveErrors: 0 } as PollState);
    const t = this.timers.get(taskId);
    if (t) this.clearTimer(t);
    this.timers.delete(taskId);
    await this.poll(taskId);
    return this.d.store.getTask(taskId);
  }

  isTracking(taskId: string): boolean {
    return this.timers.has(taskId) || this.inflight.has(taskId);
  }

  private policyOf(task: TaskRecord): PollingPolicy {
    return this.d.catalog.getProvider(task.providerId)?.polling ?? DEFAULT_POLICY;
  }

  private schedule(taskId: string, delayMs: number): void {
    if (this.stopped) return;
    const prev = this.timers.get(taskId);
    if (prev) this.clearTimer(prev);
    this.timers.set(
      taskId,
      this.setTimer(() => {
        this.timers.delete(taskId);
        void this.poll(taskId);
      }, delayMs),
    );
  }

  private resolve(task: TaskRecord): { provider: ProviderDef; model: ModelDef } | null {
    const found = this.d.catalog.getModel(task.modelId);
    return found && found.provider.id === task.providerId ? found : null;
  }

  async poll(taskId: string): Promise<void> {
    if (this.inflight.has(taskId) || this.stopped) return;
    this.inflight.add(taskId);
    try {
      await this.pollOnce(taskId);
    } finally {
      this.inflight.delete(taskId);
    }
  }

  private async pollOnce(taskId: string): Promise<void> {
    const task = this.d.store.getTask(taskId);
    if (!task || isTerminal(task.status) || !task.upstreamTaskId) return;
    const found = this.resolve(task);
    const getEp = found?.model.endpoints.get;
    if (!found || !getEp || !found.model.adapter.normalizeTask) {
      this.d.store.updateTask(taskId, { status: 'unknown', error: makeError({ providerId: task.providerId, category: 'unknown', code: 'MODEL_GONE', message: '模型声明已不存在，无法继续查询' }) });
      this.d.emit(taskId);
      return;
    }
    const policy = this.policyOf(task);
    const age = this.now() - task.createdAt;
    const poll: PollState = this.d.store.getPoll(taskId) ?? { nextAt: this.now(), attempts: 0, consecutiveErrors: 0 };

    if (age > policy.queryWindowMs) {
      this.d.store.updateTask(taskId, { status: 'unknown', error: makeError({ providerId: task.providerId, category: 'not_found', code: 'QUERY_WINDOW_EXCEEDED', message: '已超出服务商的 7 天查询窗口' }) });
      this.d.emit(taskId);
      return;
    }

    const apiKey = this.d.keystore.get(found.provider.id) ?? (this.d.mock ? 'mock-key' : null);
    if (!apiKey) {
      this.d.store.setPoll(taskId, { ...poll, pausedReason: 'missing_key' });
      this.d.store.updateTask(taskId, { error: makeError({ providerId: task.providerId, category: 'auth', code: 'MISSING_KEY', message: '缺少 API Key，已暂停轮询；在设置页填写后点"立即重查"' }) });
      this.d.emit(taskId);
      return;
    }

    let res;
    try {
      res = await this.d.upstream.call({ provider: found.provider, endpointId: getEp, baseUrlId: task.baseUrlId, apiKey, pathParams: { id: task.upstreamTaskId } });
    } catch (err) {
      return this.onPollError(task, poll, policy, err instanceof UpstreamError ? err.error : makeError({ providerId: task.providerId, category: 'network', code: 'NETWORK', message: String(err) }));
    }
    const parsed = safeJson(res.bodyText);
    this.d.store.addExchange({ taskId, at: this.now(), kind: 'poll', status: res.status, body: parsed === undefined ? res.bodyText.slice(0, 20_000) : JSON.stringify(sanitizeForPreview(parsed)) });

    // 任务本身失败时服务商仍返回 HTTP 200（失败原因在响应体里，由适配器解析），只有 ≥400 才是查询接口出错
    const err = res.status >= 400 ? found.provider.normalizeError(res) : null;
    if (err) {
      if (err.category === 'not_found' || res.status === 404) {
        // 取消的任务 24 小时后会被服务商删除；其余视为丢失
        this.d.store.updateTask(taskId, { status: task.status === 'cancelled' ? 'cancelled' : 'unknown', error: err });
        this.d.emit(taskId);
        return;
      }
      return this.onPollError(task, poll, policy, err);
    }

    const snap = found.model.adapter.normalizeTask(res);
    const patch = {
      ...(snap.actual ? { actual: snap.actual } : {}),
      ...(snap.usage ? { usage: snap.usage } : {}),
    };
    if (snap.status === 'succeeded') {
      this.d.store.updateTask(taskId, { ...patch, status: 'running', capture: 'pending', outputDir: task.outputDir ?? this.d.capture.outputDirFor(task) });
      this.d.emit(taskId);
      const out = await this.d.capture.capture(this.d.store.getTask(taskId)!, snap.assets);
      this.d.store.updateTask(taskId, {
        status: out.state === 'done' ? 'succeeded' : out.state === 'failed' && snap.assets.length ? 'failed' : 'partial',
        capture: out.state,
        outputDir: out.outputDir,
        ...(out.errors.length ? { error: makeError({ providerId: task.providerId, category: 'network', code: 'CAPTURE_FAILED', message: out.errors.join('；') }) } : {}),
      });
      this.d.store.setPoll(taskId, null);
      this.d.emit(taskId);
      return;
    }
    if (snap.status === 'failed' || snap.status === 'cancelled' || snap.status === 'expired') {
      this.d.store.updateTask(taskId, { ...patch, status: snap.status, ...(snap.error ? { error: snap.error } : {}) });
      this.d.store.setPoll(taskId, null);
      this.d.emit(taskId);
      return;
    }
    // queued / running / unknown：继续
    if (snap.status !== task.status || Object.keys(patch).length) {
      this.d.store.updateTask(taskId, { ...patch, status: snap.status === 'unknown' ? task.status : snap.status });
      this.d.emit(taskId);
    }
    const delay = nextInterval(policy, age, this.random);
    this.d.store.setPoll(taskId, { nextAt: this.now() + delay, attempts: poll.attempts + 1, consecutiveErrors: 0 });
    this.schedule(taskId, delay);
  }

  private onPollError(task: TaskRecord, poll: PollState, policy: PollingPolicy, error: ReturnType<typeof makeError>): void {
    const errors = poll.consecutiveErrors + 1;
    if (!error.retryable && error.category === 'auth') {
      this.d.store.setPoll(task.id, { ...poll, consecutiveErrors: errors, pausedReason: 'auth' });
      this.d.store.updateTask(task.id, { error });
      this.d.emit(task.id);
      return;
    }
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      this.d.store.setPoll(task.id, { ...poll, consecutiveErrors: errors, pausedReason: 'too_many_errors' });
      this.d.store.updateTask(task.id, { error });
      this.d.emit(task.id);
      return;
    }
    const base = error.retryAfterMs ?? nextInterval(policy, this.now() - task.createdAt, this.random) * 2 ** Math.min(errors, 3);
    const delay = Math.min(MAX_BACKOFF_MS, base);
    this.d.store.setPoll(task.id, { nextAt: this.now() + delay, attempts: poll.attempts + 1, consecutiveErrors: errors });
    this.schedule(task.id, delay);
  }
}
