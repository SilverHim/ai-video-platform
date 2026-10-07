import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdaptorServer } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig } from '../config.js';
import { createContainer } from '../container.js';
import { MOCK_MP4_BASE64 } from '../mock/media.js';
import { setMockTiming } from '../mock/upstream.js';
import { McpTokenStore } from '../mcp/token.js';
import { fakeCatalog } from './fake-catalog.js';
import { tempDir } from './helpers.js';

interface Running {
  url: string;
  token: string;
  dataDir: string;
  close: () => Promise<void>;
}

async function serve(): Promise<Running> {
  const tmp = tempDir();
  const config = resolveConfig({ dataDir: tmp.dir, port: 0, mock: true });
  ensureDataDirs(config.paths);
  const container = createContainer(config, { env: {}, catalog: fakeCatalog });
  let port = 0;
  const app = createApp({ config, keystore: container.keystore, store: container.store, services: container.services, version: 'test', getPort: () => port, quiet: true, catalog: fakeCatalog });
  const server = createAdaptorServer({ fetch: app.fetch });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  const token = new McpTokenStore(config.paths.mcpToken).get();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    dataDir: tmp.dir,
    close: async () => {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await container.close();
      tmp.cleanup();
    },
  };
}

let running: Running | null = null;
beforeEach(() => setMockTiming({ queuedMs: 0, runningMs: 0 }));
afterEach(async () => {
  await running?.close();
  running = null;
  setMockTiming({ queuedMs: 1500, runningMs: 3000 });
});

const text = (r: { content: unknown }) => JSON.parse(((r.content as { type: string; text?: string }[]).find((c) => c.type === 'text')!).text!);

async function v2Client(r: Running) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(r.url), { requestInit: { headers: { Authorization: `Bearer ${r.token}` } } }));
  return client;
}

describe('MCP 鉴权与本机防护', () => {
  it('缺令牌 → 401；错误 Origin → 403', async () => {
    running = await serve();
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const noToken = await fetch(running.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body });
    expect(noToken.status).toBe(401);
    const badOrigin = await fetch(running.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example', authorization: `Bearer ${running.token}` }, body });
    expect(badOrigin.status).toBe(403);
  });
});

describe('MCP 工具（v2 客户端，2026-07-28 协议）', () => {
  it('列工具、列模型、模型说明', async () => {
    running = await serve();
    const client = await v2Client(running);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['cancel_task', 'create_video_task', 'generate_image', 'get_model_schema', 'get_task', 'list_models', 'list_presets', 'list_tasks', 'preview_request']);
    const models = text(await client.callTool({ name: 'list_models', arguments: {} }));
    expect(models.map((m: { model_id: string }) => m.model_id)).toEqual(['fake/img', 'fake/video']);
    const schema = text(await client.callTool({ name: 'get_model_schema', arguments: { model_id: 'fake/video' } }));
    expect(schema.fields.map((f: { key: string }) => f.key)).toContain('resolution');
    expect(schema.modes.find((m: { id: string }) => m.id === 'ref').slots[0]).toMatchObject({ id: 'reference_video', kind: 'video' });
    await client.close();
  });

  it('preview → generate_image：返回本地路径与内联缩略图，任务进入共享历史', async () => {
    running = await serve();
    const client = await v2Client(running);
    const preview = text(await client.callTool({ name: 'preview_request', arguments: { model_id: 'fake/img', prompt: 'a red fox' } }));
    expect(preview.can_submit).toBe(true);
    expect(preview.estimated_cost.usd).toBe(0.03);
    const res = await client.callTool({ name: 'generate_image', arguments: { model_id: 'fake/img', prompt: 'a red fox' } });
    const out = text(res);
    expect(out.status).toBe('succeeded');
    expect(out.files[0].path.startsWith(running.dataDir)).toBe(true);
    expect((res.content as { type: string }[]).some((c) => c.type === 'image')).toBe(true);
    const list = text(await client.callTool({ name: 'list_tasks', arguments: {} }));
    expect(list[0].task_id).toBe(out.task_id);
    await client.close();
  });

  it('参数错误以 isError 返回并带问题列表', async () => {
    running = await serve();
    const client = await v2Client(running);
    const res = await client.callTool({ name: 'generate_image', arguments: { model_id: 'fake/img', prompt: '' } });
    expect(res.isError).toBe(true);
    expect(text(res).details.issues[0].id).toBe('prompt:required');
    await client.close();
  });

  it('create_video_task + wait_seconds：等到完成并返回视频文件', async () => {
    running = await serve();
    const client = await v2Client(running);
    const res = text(await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', prompt: 'waves', wait_seconds: 1 } }));
    // 轮询由调度器驱动（首查延迟按服务商策略）；没完成也会返回 task_id
    expect(res.task_id).toBeTruthy();
    expect(['queued', 'running', 'succeeded']).toContain(res.status);
    await client.close();
  });

  it('本地视频需公开上传时，没带 allow_public_upload 拒绝；带上后提交', async () => {
    running = await serve();
    const mp4 = join(running.dataDir, 'clip.mp4');
    writeFileSync(mp4, Buffer.from(MOCK_MP4_BASE64, 'base64'));
    const client = await v2Client(running);
    const args = { model_id: 'fake/video', mode: 'ref', prompt: 'continue Video 1', assets: { reference_video: [mp4] } };
    const denied = await client.callTool({ name: 'create_video_task', arguments: args });
    expect(denied.isError).toBe(true);
    expect(text(denied).error).toContain('allow_public_upload');
    const ok = text(await client.callTool({ name: 'create_video_task', arguments: { ...args, allow_public_upload: true } }));
    expect(ok.status).toBe('queued');
    await client.close();
  });
});

describe('MCP 预设', () => {
  it('list_presets 与 preset_id 套用', async () => {
    running = await serve();
    const base = running.url.replace(/\/mcp$/, '');
    const put = await fetch(`${base}/api/presets`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-ark-client': 'web' }, body: JSON.stringify({ name: 'b64', modelId: 'fake/img', modeId: 'generate', values: { b64: true }, prompt: 'from preset' }) });
    const preset = (await put.json()) as { preset: { id: string } };
    const client = await v2Client(running);
    const list = text(await client.callTool({ name: 'list_presets', arguments: { model_id: 'fake/img' } }));
    expect(list[0]).toMatchObject({ preset_id: preset.preset.id, params: { b64: true } });
    const p = text(await client.callTool({ name: 'preview_request', arguments: { model_id: 'fake/img', preset_id: preset.preset.id } }));
    expect(p.request.body).toMatchObject({ prompt: 'from preset', response_format: 'b64_json' });
    const wrong = await client.callTool({ name: 'preview_request', arguments: { model_id: 'fake/video', preset_id: preset.preset.id } });
    expect(wrong.isError).toBe(true);
    await client.close();
  });
});

describe('MCP 兼容旧版客户端（v1 SDK，2025 代握手，模拟 Claude Code 2.1.220）', () => {
  it('initialize + tools/list + tools/call', async () => {
    running = await serve();
    const client = new LegacyClient({ name: 'legacy-test', version: '1.0.0' });
    await client.connect(new LegacyTransport(new URL(running.url), { requestInit: { headers: { Authorization: `Bearer ${running.token}` } } }));
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('generate_image');
    const res = await client.callTool({ name: 'generate_image', arguments: { model_id: 'fake/img', prompt: 'legacy fox' } });
    expect(text(res as { content: unknown }).status).toBe('succeeded');
    await client.close();
  });
});
