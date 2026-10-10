import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderDef } from '../../shared/catalog/types.js';
import { UpstreamClient, UpstreamError } from '../upstream/http.js';
import { fakeProvider } from './fake-catalog.js';

// 用本机真实 HTTP 服务（不联网）测分片上传：覆盖 undici 的实际读写、背压与提前响应
let server: Server | null = null;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void, timeoutMs = 10_000): Promise<ProviderDef> {
  server = createServer(handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    ...fakeProvider,
    baseUrls: [{ id: 'local', label: fakeProvider.baseUrls[0]!.label, url: `http://127.0.0.1:${port}/api/v3`, default: true }],
    endpoints: { ...fakeProvider.endpoints, 'video.create': { ...fakeProvider.endpoints['video.create']!, timeoutMs } },
  };
}

const body = (mb: number) => JSON.stringify({ image: 'x'.repeat(mb * 1024 * 1024) });
// 停滞时限放宽到 2 秒：慢机器上正常上传的两次拉取之间也可能停顿几百毫秒
const client = () => new UpstreamClient(undefined, { chunked: true, chunkMinBytes: 1000, chunkBytes: 64 * 1024, stallMs: 2000 });

describe('分片上传（本机真实 HTTP 服务）', () => {
  it('正常：服务端收到的字节数与 Content-Length 一致', async () => {
    const provider = await serve((req, res) => {
      let n = 0;
      req.on('data', (c: Buffer) => (n += c.length));
      req.on('end', () => res.end(JSON.stringify({ got: n, len: req.headers['content-length'] })));
    });
    const c = client();
    const text = body(2);
    const res = await c.call({ provider, endpointId: 'video.create', apiKey: 'k', bodyText: text });
    expect(JSON.parse(res.bodyText)).toEqual({ got: Buffer.byteLength(text), len: String(Buffer.byteLength(text)) });
    await c.close();
  });

  it('服务端中途不再读：按上传停滞中止，记为请求没发完', { timeout: 20_000 }, async () => {
    const provider = await serve((req) => {
      req.once('data', () => req.pause());
    });
    const c = client();
    const err = (await c.call({ provider, endpointId: 'video.create', apiKey: 'k', bodyText: body(32) }).catch((e) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.error.code).toBe('UPLOAD_STALLED');
    expect(err.requestIncomplete).toBe(true);
    await c.close();
  });

  it('服务端读完却不响应：按接口超时中止，记为结果未知', async () => {
    const provider = await serve((req) => {
      req.resume();
    }, 300);
    const c = client();
    const err = (await c.call({ provider, endpointId: 'video.create', apiKey: 'k', bodyText: body(2) }).catch((e) => e)) as UpstreamError;
    expect(err.error.code).toBe('RESPONSE_TIMEOUT');
    expect(err.requestIncomplete).toBe(false);
    await c.close();
  });

  it('服务端没读完就提前响应：拿到响应，之后不再被计时器中断', { timeout: 20_000 }, async () => {
    const provider = await serve((req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":{"code":"InvalidParameter"}}');
      req.resume();
    });
    const c = client();
    const res = await c.call({ provider, endpointId: 'video.create', apiKey: 'k', bodyText: body(4) });
    expect(res.status).toBe(400);
    expect(res.bodyText).toContain('InvalidParameter');
    // 超过停滞时长再等一会：不应有迟到的中止或未处理的拒绝
    await new Promise((r) => setTimeout(r, 2500));
    await c.close();
  });
});
