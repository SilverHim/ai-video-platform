import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig } from '../config.js';
import { createContainer } from '../container.js';
import { setMockTiming } from '../mock/upstream.js';
import { McpTokenStore } from '../mcp/token.js';
import { tempDir, WEB_HEADERS } from './helpers.js';

/** 真实模型目录 + mock 上游：覆盖 agent 实测报告里的问题（B1–B9） */
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
  const api = (path: string) => app.request(`http://127.0.0.1:${port}/api${path}`, { headers: { ...WEB_HEADERS, host: `127.0.0.1:${port}` } });
  return {
    client,
    api,
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
type Json = Record<string, unknown> & { error?: string };
const call = async (s: Served, name: string, args: Record<string, unknown>) => {
  const res = await s.client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text?: string }[];
  return { isError: Boolean(res.isError), data: JSON.parse(content[0]!.text!) as Json, content };
};

let s: Served | null = null;
afterEach(async () => {
  setMockTiming({ imageMs: 0 });
  await s?.close();
  s = null;
});

const PRO = 'byteplus/seedream-5-0-pro';

describe('MCP：agent 实测问题', () => {
  it('B1：generate_image 等待有上限，没出图先返回 task_id，get_task 能继续等到结果', async () => {
    s = await serve();
    setMockTiming({ imageMs: 1500 });
    const r = await call(s, 'generate_image', { model_id: PRO, prompt: 'a red fox', wait_seconds: 0 });
    expect(r.isError).toBe(false);
    expect(r.data.task_id).toEqual(expect.any(String));
    expect(['submitting', 'running']).toContain(r.data.status);
    expect(String(r.data.next)).toContain('get_task');
    expect(r.data.duration_ms).toBeUndefined();

    const done = await call(s, 'get_task', { task_id: r.data.task_id, wait_seconds: 20 });
    expect(done.data.status).toBe('succeeded');
    expect((done.data.files as unknown[]).length).toBeGreaterThan(0);
    // B7：结束的任务带耗时与 usage
    expect(done.data.duration_ms).toEqual(expect.any(Number));
    expect(done.data.updated_at).toEqual(expect.any(String));
    expect(done.data.usage).toBeTruthy();
  });

  it('B1：在等待时间内完成时直接返回结果与缩略图', async () => {
    s = await serve();
    const r = await call(s, 'generate_image', { model_id: PRO, prompt: 'a red fox' });
    expect(r.data.status).toBe('succeeded');
    expect(r.data.next).toBeUndefined();
    // 有 ffmpeg 时附缩略图；没有（例如 CI）时附一句提示：两种都说明走的是「完成即返回结果」
    expect(r.content.some((c) => c.type === 'image' || (c.type === 'text' && String(c.text).includes('ffmpeg')))).toBe(true);
  });

  it('B1：设置页的接入命令用 add-json 并带 10 分钟超时', async () => {
    s = await serve();
    const info = (await (await s.api('/mcp')).json()) as { command: string; token: string };
    expect(info.command).toContain('claude mcp add-json --scope user ai-video');
    const entry = JSON.parse(/'(\{.*\})'/.exec(info.command)![1]!) as { type: string; url: string; headers: Record<string, string>; timeout: number };
    expect(entry).toMatchObject({ type: 'http', timeout: 600000, headers: { Authorization: `Bearer ${info.token}` } });
  });

  it('B2 / B8：preview_request 返回 curl、notes、费用可信度，不再透出内部 endpointId', async () => {
    s = await serve();
    const p = await call(s, 'preview_request', { model_id: PRO, prompt: 'x' });
    expect(p.isError).toBe(false);
    expect(String(p.data.curl)).toMatch(/^curl /);
    expect(String(p.data.curl)).not.toMatch(/Bearer [A-Za-z0-9]{16,}/);
    expect(p.data.estimated_cost).toMatchObject({ usd: expect.any(Number), confidence: expect.any(String) });
    const request = p.data.request as Record<string, unknown>;
    expect(request.endpointId).toBeUndefined();
    expect(request).toMatchObject({ method: 'POST', body_bytes: expect.any(Number) });
  });

  it('B3 / B4 / B9：get_model_schema 给出各模式实际默认尺寸、单价分档、去重的引用写法和默认模式', async () => {
    s = await serve();
    const r = await call(s, 'get_model_schema', { model_id: PRO });
    const fields = r.data.fields as { key: string; default?: unknown; default_by_mode?: Record<string, unknown>; help?: string }[];
    const size = fields.find((f) => f.key === 'size')!;
    expect(size.default).toBeUndefined();
    expect(size.default_by_mode?.generate).toEqual({ mode: 'preset', value: '2K' });
    expect(size.help).toContain('$0.09');
    const modes = r.data.modes as { id: string; default?: boolean; prompt: { reference_syntax?: string } }[];
    expect(modes.filter((m) => m.default).map((m) => m.id)).toEqual(['generate']);
    expect(modes.find((m) => m.id === 'generate')!.prompt.reference_syntax).toBe('Image 1');
  });

  it('B4：多种素材的模型列出各类型的引用写法', async () => {
    s = await serve();
    const r = await call(s, 'get_model_schema', { model_id: 'byteplus/seedance-2-0' });
    const modes = r.data.modes as { id: string; slots: { kind: string }[]; prompt: { reference_syntax?: string } }[];
    const omni = modes.find((m) => new Set(m.slots.map((x) => x.kind)).size === 3)!;
    expect(omni.prompt.reference_syntax?.split(' / ')).toHaveLength(3);
  });

  it('B6：preview_request 不再标为只读（本地文件会导入素材库）', async () => {
    s = await serve();
    const { tools } = await s.client.listTools();
    const preview = tools.find((t) => t.name === 'preview_request')!;
    expect(preview.annotations?.readOnlyHint).toBe(false);
    expect(preview.annotations?.idempotentHint).toBe(true);
    const gen = tools.find((t) => t.name === 'generate_image')!;
    expect(JSON.stringify(gen.inputSchema)).toContain('wait_seconds');
  });
});
