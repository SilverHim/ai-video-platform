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
