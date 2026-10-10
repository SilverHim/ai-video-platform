import { describe, expect, it } from 'vitest';
import { resolveUrl, UpstreamClient, UpstreamError, type FetchLike } from '../upstream/http.js';
import { fakeProvider } from './fake-catalog.js';

function recorder(responses: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  };
  return { calls, fetchImpl };
}

describe('resolveUrl', () => {
  it('拼接 baseUrl、路径参数与查询', () => {
    const ep = { id: 'x', method: 'GET' as const, path: '/tasks/{id}', timeoutMs: 1, retry: 'none' as const };
    expect(resolveUrl(fakeProvider, ep, undefined, { id: 'cgt-123' }, { 'filter.task_ids': ['a', 'b'] })).toBe('https://ark.ap-southeast.bytepluses.com/api/v3/tasks/cgt-123?filter.task_ids=a&filter.task_ids=b');
    expect(() => resolveUrl(fakeProvider, ep, undefined, { id: '../x' })).toThrow('不合法');
  });
});

describe('UpstreamClient', () => {
  it('请求头从零构建：只有 Authorization / UA / Accept / Content-Type', async () => {
    const { calls, fetchImpl } = recorder([() => new Response('{"data":[]}', { status: 200 })]);
    const c = new UpstreamClient(fetchImpl);
    const res = await c.call({ provider: fakeProvider, endpointId: 'image.generate', apiKey: 'sk-secret', bodyText: '{"a":1}' });
    expect(res.status).toBe(200);
    expect(Object.keys(calls[0]!.init.headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type', 'User-Agent']);
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer sk-secret');
    expect(calls[0]!.init.body).toBe('{"a":1}');
    await c.close();
  });

  it('创建类请求（retry: none）遇 503 不重试', async () => {
    const { calls, fetchImpl } = recorder([() => new Response('{}', { status: 503 }), () => new Response('{}', { status: 200 })]);
    const c = new UpstreamClient(fetchImpl);
    const res = await c.call({ provider: fakeProvider, endpointId: 'image.generate', apiKey: 'k', bodyText: '{}' });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(1);
    await c.close();
  });

  it('幂等请求遇 503 重试一次', async () => {
    const { calls, fetchImpl } = recorder([() => new Response('{}', { status: 503 }), () => new Response('{"items":[]}', { status: 200 })]);
    const c = new UpstreamClient(fetchImpl);
    const res = await c.call({ provider: fakeProvider, endpointId: 'video.list', apiKey: 'k' });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    await c.close();
  });

  it('网络错误转成 UpstreamError（timeout / network）', async () => {
    const c = new UpstreamClient(async () => {
      const e = new Error('headers timeout') as Error & { cause?: unknown };
      e.cause = { code: 'UND_ERR_HEADERS_TIMEOUT', message: 'Headers Timeout Error' };
      throw e;
    });
    const err = await c.call({ provider: fakeProvider, endpointId: 'image.generate', apiKey: 'k', bodyText: '{}' }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).error.category).toBe('timeout');
    await c.close();
  });
});

describe('大请求体：分片发送、进度、停滞与响应超时', () => {
  const big = JSON.stringify({ image: 'x'.repeat(200_000) });
  const tuning = { chunked: true, chunkMinBytes: 1000, chunkBytes: 64 * 1024, stallMs: 80 };
  /** 按节奏读请求体的假 fetch：读完返回 200；stopAfter 片之后不再读（模拟上行卡住） */
  function reader(opts: { stopAfter?: number; respond?: 'ok' | 'never' } = {}) {
    const seen: { headers: Record<string, string>; bytes: number; duplex?: string } = { headers: {}, bytes: 0 };
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.headers = init.headers;
      if (init.duplex) seen.duplex = init.duplex;
      const aborted = new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      let n = 0;
      for await (const chunk of init.body as AsyncIterable<Uint8Array>) {
        seen.bytes += chunk.length;
        n += 1;
        if (opts.stopAfter !== undefined && n >= opts.stopAfter) await aborted;
      }
      if (opts.respond === 'never') await aborted;
      return new Response('{"id":"cgt-1"}', { status: 200 });
    };
    return { seen, fetchImpl };
  }

  it('分片发送：带 Content-Length，进度单调递增到总量，内容完整', async () => {
    const { seen, fetchImpl } = reader();
    const c = new UpstreamClient(fetchImpl, tuning);
    const progress: number[] = [];
    const res = await c.call({ provider: fakeProvider, endpointId: 'video.create', apiKey: 'k', bodyText: big, onUploadProgress: (sent) => progress.push(sent) });
    expect(res.status).toBe(200);
    expect(seen.headers['Content-Length']).toBe(String(Buffer.byteLength(big)));
    expect(seen.duplex).toBe('half');
    expect(seen.bytes).toBe(Buffer.byteLength(big));
    expect(progress.at(-1)).toBe(Buffer.byteLength(big));
    expect(progress.every((v, i) => i === 0 || v >= progress[i - 1]!)).toBe(true);
    await c.close();
  });

  it('小请求体照旧整段发送', async () => {
    const { calls, fetchImpl } = recorder([() => new Response('{}', { status: 200 })]);
    const c = new UpstreamClient(fetchImpl, tuning);
    await c.call({ provider: fakeProvider, endpointId: 'video.create', apiKey: 'k', bodyText: '{"a":1}' });
    expect(calls[0]!.init.body).toBe('{"a":1}');
    await c.close();
  });

  it('上传停滞：中止，记为请求没发完（可以放心重试）', async () => {
    const c = new UpstreamClient(reader({ stopAfter: 1 }).fetchImpl, tuning);
    const err = (await c.call({ provider: fakeProvider, endpointId: 'video.create', apiKey: 'k', bodyText: big }).catch((e) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.error.code).toBe('UPLOAD_STALLED');
    expect(err.requestIncomplete).toBe(true);
    await c.close();
  });

  it('最后一片交出后卡住（还没读到结尾）：按停滞中止，但记为结果未知', async () => {
    const total = Buffer.byteLength(big);
    const fetchImpl: FetchLike = async (_url, init) => {
      const it = (init.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      let got = 0;
      while (got < total) got += (await it.next()).value!.length;
      // 尾片已经拿到，但不再读（不触发结尾）：模拟尾部写不出去
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    };
    const c = new UpstreamClient(fetchImpl, tuning);
    const err = (await c.call({ provider: fakeProvider, endpointId: 'video.create', apiKey: 'k', bodyText: big }).catch((e) => e)) as UpstreamError;
    expect(err.error.code).toBe('UPLOAD_STALLED');
    expect(err.requestIncomplete).toBe(false);
    await c.close();
  });

  it('服务商提前响应后生成器还被读：不再报进度，计时器也不会再中止请求', async () => {
    let signal: AbortSignal | undefined;
    let rest: AsyncIterator<Uint8Array> | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      signal = init.signal;
      rest = (init.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      await rest.next();
      return new Response('{"error":{"code":"InvalidParameter"}}', { status: 400 });
    };
    const c = new UpstreamClient(fetchImpl, tuning);
    const progress: number[] = [];
    const res = await c.call({ provider: fakeProvider, endpointId: 'video.create', apiKey: 'k', bodyText: big, onUploadProgress: (sent) => progress.push(sent) });
    expect(res.status).toBe(400);
    const before = progress.length;
    for (let r = await rest!.next(); !r.done; r = await rest!.next());
    await new Promise((r) => setTimeout(r, tuning.stallMs * 3));
    expect(progress.length).toBe(before);
    expect(signal!.aborted).toBe(false);
    await c.close();
  });

  it('发完之后才按接口超时等响应：超时记为结果未知（不是请求没发完）', async () => {
    const provider = { ...fakeProvider, endpoints: { ...fakeProvider.endpoints, 'video.create': { ...fakeProvider.endpoints['video.create']!, timeoutMs: 60 } } };
    const c = new UpstreamClient(reader({ respond: 'never' }).fetchImpl, { ...tuning, stallMs: 5000 });
    const err = (await c.call({ provider, endpointId: 'video.create', apiKey: 'k', bodyText: big }).catch((e) => e)) as UpstreamError;
    expect(err.error.code).toBe('RESPONSE_TIMEOUT');
    expect(err.requestIncomplete).toBe(false);
    await c.close();
  });
});
