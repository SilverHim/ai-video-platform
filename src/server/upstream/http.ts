import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { EndpointDef, ProviderDef, UpstreamResponse } from '../../shared/catalog/types.js';
import { makeError, type NormalizedError } from '../../shared/task/errors.js';
import { RateLimiter, RateLimitedLocally, sleep } from './limiter.js';

export const USER_AGENT = 'ai-video-platform/0.1 (+https://github.com/SilverHim/ai-video-platform)';

export interface UpstreamCall {
  provider: ProviderDef;
  endpointId: string;
  baseUrlId?: string;
  apiKey: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  /** 原样发送的请求体文本（预览 = 发送，逐字节一致）；优先于 body */
  bodyText?: string;
  signal?: AbortSignal;
}

/** 可替换的底层 fetch（mock 模式 / 测试注入） */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData; signal?: AbortSignal; dispatcher?: Dispatcher }) => Promise<Response>;

export class UpstreamError extends Error {
  constructor(readonly error: NormalizedError) {
    super(error.message);
  }
}

const SAFE_PARAM = /^[A-Za-z0-9._:-]+$/;

export function resolveUrl(provider: ProviderDef, ep: EndpointDef, baseUrlId?: string, pathParams: Record<string, string> = {}, query?: Record<string, string | string[]>): string {
  const base = (provider.baseUrls.find((b) => b.id === baseUrlId) ?? provider.baseUrls.find((b) => b.default) ?? provider.baseUrls[0])!.url;
  const path = ep.path.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = pathParams[k];
    if (!v || !SAFE_PARAM.test(v)) throw new Error(`路径参数 ${k} 不合法`);
    return encodeURIComponent(v);
  });
  const url = new URL(base.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(query ?? {})) for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
  return url.toString();
}

export class UpstreamClient {
  private readonly agents = new Map<number, Agent>();
  readonly limiter = new RateLimiter();

  constructor(private readonly fetchImpl: FetchLike = undiciFetch as unknown as FetchLike) {}

  private agent(timeoutMs: number): Agent {
    let a = this.agents.get(timeoutMs);
    if (!a) {
      // undici 默认 headersTimeout / bodyTimeout 都是 300s，长时间生成不够用
      a = new Agent({ connectTimeout: 15_000, headersTimeout: timeoutMs, bodyTimeout: timeoutMs, keepAliveTimeout: 10_000 });
      this.agents.set(timeoutMs, a);
    }
    return a;
  }

  /** 发请求并读完响应体；网络错误 / 超时抛 UpstreamError */
  async call(c: UpstreamCall): Promise<UpstreamResponse & { durationMs: number; url: string }> {
    const ep = c.provider.endpoints[c.endpointId];
    if (!ep) throw new Error(`服务商 ${c.provider.id} 没有 endpoint ${c.endpointId}`);
    const url = resolveUrl(c.provider, ep, c.baseUrlId, c.pathParams, c.query);
    const attempts = ep.retry === 'idempotent' ? 2 : 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (ep.rps) await this.limiter.acquire(`${c.provider.id}:${ep.id}`, ep.rps, { ...(ep.burst ? { burst: ep.burst } : {}), ...(c.signal ? { signal: c.signal } : {}) });
        const started = Date.now();
        const res = await this.raw(c, ep, url);
        const bodyText = await res.text();
        const out = { status: res.status, headers: headersToObject(res.headers), bodyText, durationMs: Date.now() - started, url };
        if (attempt < attempts && (res.status >= 500 || res.status === 429)) {
          lastErr = out;
          await sleep(500 * attempt, c.signal);
          continue;
        }
        return out;
      } catch (err) {
        lastErr = err;
        if (err instanceof RateLimitedLocally) throw new UpstreamError(makeError({ providerId: c.provider.id, category: 'rate_limit', code: 'LOCAL_RATE_LIMIT', message: err.message }));
        if (c.signal?.aborted || attempt >= attempts) break;
        await sleep(500 * attempt, c.signal).catch(() => undefined);
      }
    }
    if (lastErr && typeof lastErr === 'object' && 'status' in lastErr) return lastErr as UpstreamResponse & { durationMs: number; url: string };
    throw new UpstreamError(toTransportError(c.provider.id, lastErr));
  }

  /** 返回原始 Response（流式调用自己读 body） */
  async raw(c: UpstreamCall, ep: EndpointDef, url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${c.apiKey}`,
      'User-Agent': USER_AGENT,
      Accept: ep.stream ? 'text/event-stream, application/json' : 'application/json',
    };
    let body: string | undefined;
    if (c.bodyText !== undefined || c.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = c.bodyText ?? JSON.stringify(c.body);
    }
    return this.fetchImpl(url, {
      method: ep.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(c.signal ? { signal: c.signal } : {}),
      dispatcher: this.agent(ep.timeoutMs),
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.agents.values()].map((a) => a.close()));
    this.agents.clear();
  }
}

export function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

export function toTransportError(providerId: string, err: unknown): NormalizedError {
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? e?.code ?? e?.name ?? 'NETWORK_ERROR';
  const timeout = /Timeout|ETIMEDOUT|UND_ERR_(HEADERS|BODY|CONNECT)_TIMEOUT/i.test(String(code)) || e?.name === 'TimeoutError';
  return makeError({
    providerId,
    category: timeout ? 'timeout' : 'network',
    code: String(code),
    message: e?.cause?.message ?? e?.message ?? '网络错误',
  });
}
