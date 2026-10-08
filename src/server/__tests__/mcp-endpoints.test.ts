import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig } from '../config.js';
import { createContainer } from '../container.js';
import { resetMockControl } from '../controlplane/mock.js';
import { McpTokenStore } from '../mcp/token.js';
import { tempDir, WEB_HEADERS } from './helpers.js';

/** 用真实模型目录（BytePlus 模型允许 model_override）+ mock 上游与 mock 控制面 */
async function serve() {
  const tmp = tempDir();
  const config = resolveConfig({ dataDir: tmp.dir, port: 0, mock: true });
  ensureDataDirs(config.paths);
  const container = createContainer(config, { env: {} });
  let port = 0;
  const app = createApp({ config, keystore: container.keystore, store: container.store, services: container.services, version: 'test', getPort: () => port, quiet: true });
  const server = createAdaptorServer({ fetch: app.fetch });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  const token = new McpTokenStore(config.paths.mcpToken).get();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const api = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:${port}/api${path}`, { ...init, headers: { ...WEB_HEADERS, host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
  return {
    client,
    api,
    keystore: container.keystore,
    close: async () => {
      await client.close();
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await container.close();
      tmp.cleanup();
    },
  };
}

type Served = Awaited<ReturnType<typeof serve>>;
const call = async (s: Served, name: string, args: Record<string, unknown>) => {
  const res = await s.client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]!.text;
  return { isError: Boolean(res.isError), data: JSON.parse(text) as Record<string, unknown> & { error?: string } };
};

let s: Served | null = null;
beforeEach(() => resetMockControl());
afterEach(async () => {
  await s?.close();
  s = null;
});

describe('MCP 与推理接入点', () => {
  it('没配 AK/SK 时 list_endpoints 说明原因；不用 Endpoint 照常生成', async () => {
    s = await serve();
    const r = await call(s, 'list_endpoints', {});
    expect(r.isError).toBe(true);
    expect(r.data.error).toContain('AK/SK');
    // 没配 AK/SK 时不校验 model_override（只是少了这层保护）
    const p = await call(s, 'preview_request', { model_id: 'byteplus/seedream-5-0-flash', prompt: 'x', model_override: 'ep-20261008000000-aaaaa' });
    expect(p.isError).toBe(false);
  });

  it('按模型列出 Endpoint；model_override 校验存在、模型一致、未停止', async () => {
    s = await serve();
    s.keystore.setControl('AKLTmockmockmockmock', 'mock-secret');
    const create = async (modelId: string, name: string, contentFilter: boolean) => ((await (await s!.api('/endpoints', { method: 'POST', body: JSON.stringify({ modelId, name, contentFilter }) })).json()) as { id: string }).id;
    const flash = await create('byteplus/seedream-5-0-flash', 'flash-nofilter', false);
    const pro = await create('byteplus/seedream-5-0-pro', 'pro-default', true);

    const listed = await call(s, 'list_endpoints', { model_id: 'byteplus/seedream-5-0-flash', refresh: true });
    expect(listed.isError).toBe(false);
    expect(listed.data).toEqual([expect.objectContaining({ endpoint_id: flash, name: 'flash-nofilter', content_filter: 'off', model_id: 'byteplus/seedream-5-0-flash', foundation_model: 'dola-seedream-5-0-flash-260915' })]);

    const ok = await call(s, 'preview_request', { model_id: 'byteplus/seedream-5-0-flash', prompt: 'x', model_override: flash });
    expect(ok.isError).toBe(false);
    expect(ok.data.endpoint).toMatchObject({ endpoint_id: flash, content_filter: 'off' });
    expect((ok.data.request as { body: { model: string } }).body.model).toBe(flash);

    const wrong = await call(s, 'preview_request', { model_id: 'byteplus/seedream-5-0-flash', prompt: 'x', model_override: pro });
    expect(wrong.isError).toBe(true);
    expect(wrong.data.error).toContain('绑定的是 byteplus/seedream-5-0-pro');

    const missing = await call(s, 'generate_image', { model_id: 'byteplus/seedream-5-0-flash', prompt: 'x', model_override: 'ep-20261008000000-zzzzz' });
    expect(missing.isError).toBe(true);
    expect(missing.data.error).toContain('账号下没有');

    await s.api(`/endpoints/${flash}/stop`, { method: 'POST', body: '{}' });
    await call(s, 'list_endpoints', { refresh: true });
    const stopped = await call(s, 'generate_image', { model_id: 'byteplus/seedream-5-0-flash', prompt: 'x', model_override: flash });
    expect(stopped.isError).toBe(true);
    expect(stopped.data.error).toContain('已停止');
  });
});
