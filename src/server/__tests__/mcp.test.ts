import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdaptorServer } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRecord } from '../../shared/task/records.js';
import { isTerminal } from '../../shared/task/status.js';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig } from '../config.js';
import { createContainer } from '../container.js';
import { MOCK_MP4_BASE64 } from '../mock/media.js';
import { setMockTiming } from '../mock/upstream.js';
import { McpTokenStore } from '../mcp/token.js';
import { DEFAULT_CALL_BUDGET, setCallBudget } from '../mcp/timing.js';
import { createUploadTargets, type UploadTargets } from '../upload-targets/registry.js';
import { UploadError, type UploadTarget } from '../upload-targets/types.js';
import { fakeCatalog } from './fake-catalog.js';
import { tempDir } from './helpers.js';

interface Running {
  url: string;
  token: string;
  dataDir: string;
  container: ReturnType<typeof createContainer>;
  close: () => Promise<void>;
}

async function serve(opts: { uploadTargets?: UploadTargets } = {}): Promise<Running> {
  const tmp = tempDir();
  const config = resolveConfig({ dataDir: tmp.dir, port: 0, mock: true });
  ensureDataDirs(config.paths);
  const container = createContainer(config, { env: {}, catalog: fakeCatalog, ...opts });
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
    container,
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
  setCallBudget(DEFAULT_CALL_BUDGET);
});

/** 等到有任务满足条件（由任务事件唤醒），超时报错 */
function untilTask(r: Running, pred: (t: TaskRecord) => boolean, timeoutMs = 10_000): Promise<TaskRecord> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('等待任务状态超时'));
    }, timeoutMs);
    const check = () => {
      const t = r.container.store.listTasks().find(pred);
      if (!t) return;
      clearTimeout(timer);
      unsub();
      resolve(t);
    };
    const unsub = r.container.services.events.subscribe(check);
    check();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** mock 托管站：上传由 upload 决定（用来模拟上传很慢或失败） */
function withTempHost(upload: UploadTarget['upload']): UploadTargets {
  const targets = createUploadTargets(true);
  return { ...targets, tempHosts: { ...targets.tempHosts, uguu: { ...targets.tempHosts.uguu!, upload } } };
}

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
    expect(tools).toEqual(['cancel_task', 'create_video_task', 'generate_image', 'get_model_schema', 'get_task', 'list_endpoints', 'list_models', 'list_presets', 'list_tasks', 'preview_request']);
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
    // 有 ffmpeg 时内联缩略图；没有（例如 CI）时附说明，路径照样返回
    const blocks = res.content as { type: string; text?: string }[];
    expect(blocks.some((c) => c.type === 'image') || blocks.some((c) => c.type === 'text' && c.text?.includes('ffmpeg'))).toBe(true);
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

  it('create_video_task 默认等到出结果：等待期间任务完成就立即返回结果', async () => {
    running = await serve();
    const r = running;
    const client = await v2Client(r);
    const t0 = Date.now();
    const pending = client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', prompt: 'waves' } });
    void pending.catch(() => undefined);
    try {
      // 假模型的首次查询要 60 秒：等任务在上游建好（queued）后手动推进轮询
      const { id } = await untilTask(r, (t) => t.status === 'queued');
      for (let i = 0; i < 5 && !isTerminal(r.container.store.getTask(id)!.status); i++) await r.container.services.scheduler.poll(id);
      expect(r.container.store.getTask(id)!.status).toBe('succeeded');
      const res = text(await pending);
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(res.status).toBe('succeeded');
      expect(res.next).toBeUndefined();
      expect(res.files.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await pending.catch(() => undefined);
    }
  }, 30_000);

  it('本地视频需公开上传时，没带 allow_public_upload 拒绝；带上后提交', async () => {
    running = await serve();
    const mp4 = join(running.dataDir, 'clip.mp4');
    writeFileSync(mp4, Buffer.from(MOCK_MP4_BASE64, 'base64'));
    const client = await v2Client(running);
    const args = { model_id: 'fake/video', mode: 'ref', prompt: 'continue Video 1', assets: { reference_video: [mp4] } };
    const denied = await client.callTool({ name: 'create_video_task', arguments: args });
    expect(denied.isError).toBe(true);
    expect(text(denied).error).toContain('allow_public_upload');
    // wait_seconds: 0 立即返回（默认会等到出结果）
    const ok = text(await client.callTool({ name: 'create_video_task', arguments: { ...args, allow_public_upload: true, wait_seconds: 0 } }));
    expect(ok.status).toBe('queued');
    await client.close();
  });

  it('素材上传拖到调用预算用完：先返回已登记的 task_id，后台继续上传、提交，不会重复建任务', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    running = await serve({
      uploadTargets: withTempHost(async (file) => {
        await gate;
        return { url: `https://mock.cdn.invalid/uploads/${file.sha256}.mp4`, expiresAt: Date.now() + 3 * 3600_000, verified: { ok: true, note: 'mock' } };
      }),
    });
    const r = running;
    // 准备阶段（真实导入素材）照常用默认预算；进入提交的那一刻把预算收紧到已经用完，确定地走「上传卡住」这条路
    const svc = r.container.services.tasks;
    const start = svc.start.bind(svc);
    vi.spyOn(svc, 'start').mockImplementation((...args) => {
      setCallBudget({ callMs: 0, responseMs: 0 });
      return start(...args);
    });
    const mp4 = join(r.dataDir, 'clip.mp4');
    writeFileSync(mp4, Buffer.from(MOCK_MP4_BASE64, 'base64'));
    const client = await v2Client(r);
    try {
      const res = text(await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', mode: 'ref', prompt: 'continue Video 1', assets: { reference_video: [mp4] }, allow_public_upload: true } }));
      expect(res.status).toBe('resolving_assets');
      expect(res.task_id).toBeTruthy();
      expect(res.next).toContain('不要重新提交');
      release();
      // 后台继续上传、提交：等任务进入 queued
      await untilTask(r, (t) => t.id === res.task_id && t.status === 'queued');
      expect(r.container.store.listTasks()).toHaveLength(1);
    } finally {
      release();
      vi.restoreAllMocks();
      await client.close();
    }
  }, 30_000);

  it('上游拒收视频任务：默认等待也立即返回失败状态', async () => {
    running = await serve();
    const client = await v2Client(running);
    const t0 = Date.now();
    const res = text(await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', prompt: 'MOCK_REJECT waves' } }));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(res.status).toBe('failed');
    expect(res.next).toBeUndefined();
    await client.close();
  });

  it('提交结果未知的任务不白等：get_task 立即返回并提示到控制台核对', async () => {
    running = await serve();
    const client = await v2Client(running);
    const created = text(await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', prompt: 'waves', wait_seconds: 0 } }));
    running.container.store.updateTask(created.task_id, { status: 'submit_unknown' });
    const t0 = Date.now();
    const res = text(await client.callTool({ name: 'get_task', arguments: { task_id: created.task_id, wait_seconds: 540 } }));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(res.status).toBe('submit_unknown');
    expect(res.next).toContain('控制台');
    await client.close();
  });

  it('状态未知但调度器在重查：接着等，查回结果后返回；调度器不再跟进时立即返回', async () => {
    running = await serve();
    const r = running;
    const client = await v2Client(r);
    const created = text(await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', prompt: 'waves', wait_seconds: 0 } }));
    const id = created.task_id as string;
    expect(r.container.services.scheduler.isTracking(id)).toBe(true);
    r.container.store.updateTask(id, { status: 'unknown' });
    let settled = false;
    const pending = client.callTool({ name: 'get_task', arguments: { task_id: id, wait_seconds: 540 } });
    void pending.then(() => (settled = true), () => (settled = true));
    try {
      await sleep(300);
      expect(settled).toBe(false);
      await r.container.services.scheduler.refresh(id);
      const res = text(await pending);
      expect(res.status).toBe('succeeded');
      // 调度器不再跟进（例如超出查询窗口后）：unknown 立即返回并提示
      r.container.services.scheduler.stop();
      r.container.store.updateTask(id, { status: 'unknown' });
      const t0 = Date.now();
      const stalled = text(await client.callTool({ name: 'get_task', arguments: { task_id: id, wait_seconds: 540 } }));
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(stalled.next).toContain('不再自动跟进');
    } finally {
      await client.close();
      await pending.catch(() => undefined);
    }
  }, 30_000);

  it('预算内素材上传失败：照常以 isError 返回，任务记为失败', async () => {
    running = await serve({
      uploadTargets: withTempHost(async () => {
        throw new UploadError('托管站拒绝了上传');
      }),
    });
    const mp4 = join(running.dataDir, 'clip.mp4');
    writeFileSync(mp4, Buffer.from(MOCK_MP4_BASE64, 'base64'));
    const client = await v2Client(running);
    const res = await client.callTool({ name: 'create_video_task', arguments: { model_id: 'fake/video', mode: 'ref', prompt: 'continue Video 1', assets: { reference_video: [mp4] }, allow_public_upload: true } });
    expect(res.isError).toBe(true);
    expect(text(res).error).toContain('托管站拒绝了上传');
    expect(running.container.store.listTasks()[0]!.status).toBe('failed');
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
