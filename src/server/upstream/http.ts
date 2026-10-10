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
  /** 大请求体分片发送时的上传进度（已交给连接的字节数 / 总字节数） */
  onUploadProgress?: (sent: number, total: number) => void;
}

/** 可替换的底层 fetch（mock 模式 / 测试注入） */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData | AsyncIterable<Uint8Array>; duplex?: 'half'; signal?: AbortSignal; dispatcher?: Dispatcher },
) => Promise<Response>;

export class UpstreamError extends Error {
  constructor(
    readonly error: NormalizedError,
    /** 请求体还没发完就出错了：服务商不可能收到完整请求（创建类请求可以放心重试） */
    readonly requestIncomplete = false,
  ) {
    super(error.message);
  }
}

/**
 * 大请求体的发送方式（本地素材以 base64 内联时可能有几十 MB）：
 * - 超过 chunkMinBytes 就分片发送：能统计已发字节（上传进度、停滞检测）；
 * - 改走 HTTP/1.1：实测到 BytePlus 新加坡，同样 19 MB 的请求体 HTTP/1.1 约 170–230 KB/s，HTTP/2 约 120 KB/s；
 * - 计时自己管：上传期间 stallMs 内没有新字节就中止；发完才开始按接口的 timeoutMs 等响应
 *   （undici 的 headersTimeout 在 HTTP/1.1 下从请求开始就计时，大上传会被误杀）
 */
export interface UploadTuning {
  /** 分片发送（默认只在用真实 undici fetch 时开启；mock / 测试注入的 fetch 只认字符串请求体） */
  chunked?: boolean;
  chunkMinBytes?: number;
  chunkBytes?: number;
  stallMs?: number;
}
const DEFAULT_TUNING = { chunkMinBytes: 1_000_000, chunkBytes: 256 * 1024, stallMs: 60_000 };

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
  private readonly uploadAgents = new Map<number, Agent>();
  readonly limiter = new RateLimiter();
  private readonly fetchImpl: FetchLike;
  private readonly tuning: Required<UploadTuning>;

  constructor(fetchImpl?: FetchLike, tuning: UploadTuning = {}) {
    this.fetchImpl = fetchImpl ?? (undiciFetch as unknown as FetchLike);
    this.tuning = { ...DEFAULT_TUNING, chunked: fetchImpl === undefined, ...tuning };
  }

  /** 大请求体用：HTTP/1.1，等响应头的超时放宽（发完之后由 rawChunked 自己按 timeoutMs 计时） */
  private uploadAgent(timeoutMs: number): Agent {
    let a = this.uploadAgents.get(timeoutMs);
    if (!a) {
      a = new Agent({ allowH2: false, connectTimeout: 15_000, headersTimeout: 60 * 60_000, bodyTimeout: timeoutMs, keepAliveTimeout: 10_000 });
      this.uploadAgents.set(timeoutMs, a);
    }
    return a;
  }

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
        if (err instanceof UpstreamError) throw err;
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
    if (body !== undefined && this.tuning.chunked && Buffer.byteLength(body) >= this.tuning.chunkMinBytes) return this.rawChunked(c, ep, url, headers, Buffer.from(body));
    return this.fetchImpl(url, {
      method: ep.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(c.signal ? { signal: c.signal } : {}),
      dispatcher: this.agent(ep.timeoutMs),
    });
  }

  /**
   * 大请求体：分片发送、报进度、上传停滞就中止；全部交给连接后才开始按接口超时等响应（见 UploadTuning）。
   * 「请求没发完」只在最后一片从没交给连接时成立：那时服务商不可能收到完整请求；
   * 最后一片交出去之后再出错（包括尾部卡住），服务商可能已经收到，只能按结果未知处理
   */
  private async rawChunked(c: UpstreamCall, ep: EndpointDef, url: string, headers: Record<string, string>, buf: Buffer): Promise<Response> {
    const { chunkBytes, stallMs } = this.tuning;
    const total = buf.length;
    const ctrl = new AbortController();
    const signal = c.signal ? AbortSignal.any([c.signal, ctrl.signal]) : ctrl.signal;
    let sent = 0;
    let lastHandedOver = false;
    /** 已收到响应头或已出错：不再计时、不再报进度（服务商提前响应时，生成器可能还会被读几片） */
    let settled = false;
    let why: 'stall' | 'response' | null = null;
    let timer: NodeJS.Timeout | undefined;
    const arm = (ms: number, reason: 'stall' | 'response') => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        why = reason;
        ctrl.abort();
      }, ms);
    };
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let off = 0; off < total; off += chunkBytes) {
        // 拉取下一片时，前面的片已经交给连接写出：按此计进度，并重新开始停滞计时（尾片交出后仍计时，直到被读到结尾）
        sent = off;
        if (!settled) c.onUploadProgress?.(sent, total);
        arm(stallMs, 'stall');
        const end = Math.min(total, off + chunkBytes);
        if (end === total) lastHandedOver = true;
        yield buf.subarray(off, end);
      }
      sent = total;
      if (!settled) c.onUploadProgress?.(total, total);
      // 全部交给了连接：按接口超时等响应（尾部可能还在系统缓冲区里发送，这段时间也算在内）
      arm(ep.timeoutMs, 'response');
    }
    arm(stallMs, 'stall');
    try {
      return await this.fetchImpl(url, { method: ep.method, headers: { ...headers, 'Content-Length': String(total) }, body: chunks(), duplex: 'half', signal, dispatcher: this.uploadAgent(ep.timeoutMs) });
    } catch (err) {
      const mb = (n: number) => (n / 1048576).toFixed(1);
      if (why === 'stall') {
        const where = lastHandedOver ? '最后一段已交给连接，服务商可能已经收到完整请求' : `已发送 ${mb(sent)} / ${mb(total)} MB`;
        throw new UpstreamError(makeError({ providerId: c.provider.id, category: 'timeout', code: 'UPLOAD_STALLED', message: `上传请求体停滞超过 ${Math.round(stallMs / 1000)} 秒（${where}）` }), !lastHandedOver);
      }
      if (why === 'response') {
        throw new UpstreamError(makeError({ providerId: c.provider.id, category: 'timeout', code: 'RESPONSE_TIMEOUT', message: `请求体已全部交给连接，${Math.round(ep.timeoutMs / 1000)} 秒内没有收到响应` }));
      }
      throw new UpstreamError(toTransportError(c.provider.id, err), !lastHandedOver);
    } finally {
      settled = true;
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.agents.values(), ...this.uploadAgents.values()].map((a) => a.close()));
    this.agents.clear();
    this.uploadAgents.clear();
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
