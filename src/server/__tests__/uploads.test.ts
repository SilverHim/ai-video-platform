import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuiltRequest } from '../../shared/request/build.js';
import { setMockTiming } from '../mock/upstream.js';
import { adjustExpiryForUploads } from '../tasks/task-service.js';
import { extractFileId } from '../upload-targets/minimax-files.js';
import { tmpfilesDirectUrl } from '../upload-targets/temp-hosts.js';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';
import { MOCK_MP4_BASE64 } from '../mock/media.js';
import { makePng } from '../mock/png.js';
import { createUploadTargets } from '../upload-targets/registry.js';
import type { UploadTarget } from '../upload-targets/types.js';

let cleanup: () => void | Promise<void> = () => {};
beforeEach(() => setMockTiming({ queuedMs: 0, runningMs: 0 }));
afterEach(async () => {
  await cleanup();
  setMockTiming({ queuedMs: 1500, runningMs: 3000 });
});

async function setupWithVideoAsset() {
  const made = makeApp({ catalog: fakeCatalog });
  cleanup = made.cleanup;
  const mp4 = Buffer.from(MOCK_MP4_BASE64, 'base64');
  const res = await made.app.request(`${BASE}/api/assets`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'video/mp4', 'x-asset-filename': 'clip.mp4' }, body: mp4 });
  const asset = (await json(res)).asset;
  const form = fakeForm({ modelId: 'fake/video', modeId: 'ref', prompt: 'continue {{ref:v1}}', slots: { reference_video: [{ id: 'v1', source: { type: 'local', assetId: asset.id, mime: 'video/mp4', bytes: mp4.length, filename: 'clip.mp4' }, meta: asset.meta }] } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => made.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { ...made, asset, form, post };
}

describe('本地视频上传到公共托管', () => {
  it('素材读出 MP4 类型', async () => {
    const { asset } = await setupWithVideoAsset();
    expect(asset).toMatchObject({ mime: 'video/mp4', meta: { kind: 'video' } });
  });

  it('预览：显示需要同意的上传，占位不读文件', async () => {
    const { post, form } = await setupWithVideoAsset();
    const p = await json(await post('/api/preview', { form }));
    expect(p.uploads).toMatchObject({ required: true, target: { id: 'uguu' }, files: [{ name: 'clip.mp4' }] });
    expect(JSON.stringify(p.request.body)).toContain('提交时上传到');
  });

  it('没同意 → 428，不建任务', async () => {
    const { post, form, store } = await setupWithVideoAsset();
    const res = await post('/api/tasks', { form });
    expect(res.status).toBe(428);
    expect((await json(res)).error.code).toBe('consent_required');
    expect(store.listTasks()).toHaveLength(0);
  });

  it('同意后上传，直链写进请求；execution_expires_after 按 3 小时寿命缩短', async () => {
    const { post, form, store } = await setupWithVideoAsset();
    const res = await post('/api/tasks', { form }, { 'x-upload-consent': '1' });
    const { task } = await json(res);
    expect(task.status).toBe('queued');
    const content = (task.request.content as { type: string; video_url?: { url: string } }[]).find((c) => c.type === 'video_url')!;
    expect(content.video_url!.url).toMatch(/^https:\/\/mock\.cdn\.invalid\/uploads\/[0-9a-f]{64}\.mp4$/);
    expect(task.request.execution_expires_after).toBeGreaterThanOrEqual(3600);
    expect(task.request.execution_expires_after).toBeLessThanOrEqual(2 * 3600);
    // 同一素材再次提交复用缓存的直链
    const again = await json(await post('/api/tasks', { form }, { 'x-upload-consent': '1' }));
    expect((again.task.request.content as { video_url?: { url: string } }[])[1]!.video_url!.url).toBe(content.video_url!.url);
    expect(store.getAsset(store.listTasks()[0]!.form.slots.reference_video![0]!.source.type === 'local' ? (store.listTasks()[0]!.form.slots.reference_video![0]!.source as { assetId: string }).assetId : '')!.uploads.uguu).toBeDefined();
  });

  it('复用缓存的托管链接时，预览按它的真实剩余寿命算执行超时，与提交一致', async () => {
    const { post, form, store, asset } = await setupWithVideoAsset();
    await post('/api/tasks', { form }, { 'x-upload-consent': '1' });
    const rec = store.getAsset(asset.id)!;
    // 缓存的链接只剩 70 分钟（仍高于复用下限 60 分钟）
    store.setAssetUploads(asset.id, { ...rec.uploads, uguu: { url: rec.uploads.uguu!.url, expiresAt: Date.now() + 70 * 60_000 } });
    const p = await json(await post('/api/preview', { form }, { 'x-upload-consent': '1' }));
    const { task } = await json(await post('/api/tasks', { form }, { 'x-upload-consent': '1' }));
    expect(p.request.body.execution_expires_after).toBe(task.request.execution_expires_after);
    expect(task.request.execution_expires_after).toBe(3600);
  });

  it.each([
    ['结果记录带哈希', false],
    ['结果记录缺哈希（从 outputs 重建的）', true],
  ])('历史结果的原始链接已过期、文件之前传过托管站：预览也按缓存链接的真实寿命算（%s）', async (_label, withoutSha) => {
    const targets = createUploadTargets(true);
    const upload: UploadTarget['upload'] = async (file) => ({ url: `https://mock.cdn.invalid/uploads/${file.sha256}.mp4`, expiresAt: Date.now() + 70 * 60_000, verified: { ok: true, note: 'mock' } });
    const made = makeApp({ catalog: fakeCatalog, uploadTargets: { ...targets, tempHosts: { ...targets.tempHosts, uguu: { ...targets.tempHosts.uguu!, upload } } } });
    cleanup = made.cleanup;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => made.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    // 先生成一段视频，作为后面的参考素材
    const first = (await json(await post('/api/tasks', { form: fakeForm({ modelId: 'fake/video', modeId: 't2v', prompt: 'waves' }) }))).task;
    for (let i = 0; i < 5 && made.store.getTask(first.id)!.status !== 'succeeded'; i++) await made.services.scheduler.poll(first.id);
    expect(made.store.getTask(first.id)!.status).toBe('succeeded');
    if (withoutSha) {
      // 模拟从 outputs 重建的结果：没有记哈希
      const r = made.store.listResults(first.id)[0]!;
      made.store.upsertResult({ ...r, sha256: null });
      expect(made.store.resultSha256(first.id, 0)).toBeNull();
    }
    // 不带 remoteUrl：按原始链接已过期处理，提交时上传本地结果文件
    const form = fakeForm({ modelId: 'fake/video', modeId: 'ref', prompt: 'continue {{ref:v1}}', slots: { reference_video: [{ id: 'v1', source: { type: 'task-output', taskId: first.id, index: 0 } }] } });
    await post('/api/tasks', { form }, { 'x-upload-consent': '1' });
    const p = await json(await post('/api/preview', { form }, { 'x-upload-consent': '1' }));
    const { task } = await json(await post('/api/tasks', { form }, { 'x-upload-consent': '1' }));
    expect(p.request.body.execution_expires_after).toBe(task.request.execution_expires_after);
    expect(task.request.execution_expires_after).toBe(3600);
  });

  it('历史结果文件在同一路径被替换（等长）：提交按当前内容重新上传，不复用旧链接', async () => {
    const calls: string[] = [];
    const targets = createUploadTargets(true);
    const upload: UploadTarget['upload'] = async (file) => {
      calls.push(file.sha256);
      return { url: `https://mock.cdn.invalid/uploads/${file.sha256}.mp4`, expiresAt: Date.now() + 3 * 3600_000, verified: { ok: true, note: 'mock' } };
    };
    const made = makeApp({ catalog: fakeCatalog, uploadTargets: { ...targets, tempHosts: { ...targets.tempHosts, uguu: { ...targets.tempHosts.uguu!, upload } } } });
    cleanup = made.cleanup;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => made.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const first = (await json(await post('/api/tasks', { form: fakeForm({ modelId: 'fake/video', modeId: 't2v', prompt: 'waves' }) }))).task;
    for (let i = 0; i < 5 && made.store.getTask(first.id)!.status !== 'succeeded'; i++) await made.services.scheduler.poll(first.id);
    const form = fakeForm({ modelId: 'fake/video', modeId: 'ref', prompt: 'continue {{ref:v1}}', slots: { reference_video: [{ id: 'v1', source: { type: 'task-output', taskId: first.id, index: 0 } }] } });
    const a = (await json(await post('/api/tasks', { form }, { 'x-upload-consent': '1' }))).task;
    const abs = join(made.config.paths.outputs, made.store.listResults(first.id)[0]!.path!);
    const old = readFileSync(abs);
    writeFileSync(abs, Buffer.from(old.map((b) => b ^ 0xff)));
    const b = (await json(await post('/api/tasks', { form }, { 'x-upload-consent': '1' }))).task;
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toBe(calls[0]);
    const url = (t: { request: { content: { video_url?: { url: string } }[] } }) => t.request.content.find((c) => c.video_url)!.video_url!.url;
    expect(url(b)).not.toBe(url(a));
    expect(made.store.resultSha256(first.id, 0)).toBe(calls[1]);
  });

  it('选择 tmpfiles 托管', async () => {
    const { post, form } = await setupWithVideoAsset();
    const p = await json(await post('/api/preview', { form }, { 'x-upload-target': 'tmpfiles' }));
    expect(p.uploads.target.id).toBe('tmpfiles');
  });
});

describe('本地素材就是以前的生成结果：复用服务商的原始链接', () => {
  /** 在库里放一条同服务商的历史结果：文件哈希与刚上传的素材相同 */
  function seedResult(store: ReturnType<typeof makeApp>['store'], sha256: string, remoteExpiresAt: number, providerId = 'byteplus') {
    const now = Date.now();
    store.insertTask({ id: 'old', createdAt: now, updatedAt: now, origin: 'web', providerId, modelId: 'fake/video', apiModel: 'fake-video', modeId: 'text', kind: 'async', status: 'succeeded', upstreamTaskId: 'up-old', baseUrlId: 'ap', form: { providerId, modelId: 'fake/video', modeId: 'text', values: {}, slots: {}, prompt: 'p' }, request: null, error: null, failures: [], usage: null, actual: null, capture: 'done', outputDir: null, parentTaskId: null, costEstimate: null, favorite: false, note: null });
    store.upsertResult({ id: 'r-old', taskId: 'old', index: 0, role: 'video', kind: 'video', path: null, mime: 'video/mp4', bytes: 10, width: null, height: null, remoteUrl: 'https://provider.cdn.invalid/old.mp4', remoteExpiresAt, layer: null, sha256 });
  }

  it('链接剩余超过 3 小时：预览不要求公开上传，提交用原始链接并按链接寿命缩短 execution_expires_after', async () => {
    const { post, form, store, asset } = await setupWithVideoAsset();
    seedResult(store, asset.sha256, Date.now() + 10 * 3600_000);
    const p = await json(await post('/api/preview', { form }));
    expect(p.uploads.required).toBe(false);
    expect(JSON.stringify(p.request.body)).toContain('https://provider.cdn.invalid/old.mp4');
    expect(p.notes.some((n: { zh: string }) => n.zh.includes('task:old#0'))).toBe(true);
    // 预览与提交一致：都按原始链接剩余寿命缩短执行超时
    expect(p.request.body.execution_expires_after).toBeLessThanOrEqual(9 * 3600);
    const { task } = await json(await post('/api/tasks', { form }));
    expect(task.status).toBe('queued');
    const content = (task.request.content as { type: string; video_url?: { url: string } }[]).find((c) => c.type === 'video_url')!;
    expect(content.video_url!.url).toBe('https://provider.cdn.invalid/old.mp4');
    expect(task.request.execution_expires_after).toBeLessThanOrEqual(9 * 3600);
  });

  it('链接快过期或来自别的服务商：照旧走公开上传', async () => {
    const soon = await setupWithVideoAsset();
    seedResult(soon.store, soon.asset.sha256, Date.now() + 3600_000);
    expect((await json(await soon.post('/api/preview', { form: soon.form }))).uploads.required).toBe(true);
    await cleanup();
    const other = await setupWithVideoAsset();
    seedResult(other.store, other.asset.sha256, Date.now() + 10 * 3600_000, 'minimax');
    expect((await json(await other.post('/api/preview', { form: other.form }))).uploads.required).toBe(true);
  });
});

describe('BytePlus 本地图片：同意就先传到托管站，不同意按 base64 内联', () => {
  /**
   * mock 托管站：记下每次上传。barrier = n 时，每个上传都要等到 n 个上传同时开始才放行（证明是并行的；
   * 串行实现会卡在第一个上传，2 秒后报错让任务失败）
   */
  function countingTargets(delayMs = 0, barrier = 0) {
    const calls: string[] = [];
    const targets = createUploadTargets(true);
    let release!: () => void;
    const allStarted = new Promise<void>((r) => (release = r));
    const upload: UploadTarget['upload'] = async (file) => {
      calls.push(file.sha256);
      if (barrier && calls.length >= barrier) release();
      if (barrier) await Promise.race([allStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('上传没有并行')), 2000))]);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return { url: `https://mock.cdn.invalid/uploads/${file.sha256}.png`, expiresAt: Date.now() + 3 * 3600_000, verified: { ok: true, note: 'mock' } };
    };
    return { calls, targets: { ...targets, tempHosts: { ...targets.tempHosts, uguu: { ...targets.tempHosts.uguu!, upload } } } };
  }

  async function setupWithImages(n: number, delayMs = 0, barrier = 0) {
    const counting = countingTargets(delayMs, barrier);
    const made = makeApp({ catalog: fakeCatalog, uploadTargets: counting.targets });
    cleanup = made.cleanup;
    const refs = [];
    for (let i = 0; i < n; i++) {
      const png = makePng(32, 32, i);
      const asset = (await json(await made.app.request(`${BASE}/api/assets`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'image/png', 'x-asset-filename': `ref${i}.png` }, body: png }))).asset;
      refs.push({ id: `i${i}`, source: { type: 'local' as const, assetId: asset.id, mime: 'image/png', bytes: png.length, filename: `ref${i}.png` }, meta: asset.meta });
    }
    const form = fakeForm({ modelId: 'fake/img', modeId: 'generate', prompt: 'a fox', slots: { image: refs } });
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => made.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { ...made, form, refs, post, calls: counting.calls };
  }

  it('预览：图片列为可选上传（不要求同意），没同意时按 base64 内联并提示', async () => {
    const { post, form } = await setupWithImages(1);
    const p = await json(await post('/api/preview', { form }));
    expect(p.uploads.required).toBe(false);
    expect(p.uploads.files).toEqual([expect.objectContaining({ name: 'ref0.png', optional: true })]);
    expect(JSON.stringify(p.request.body)).toContain('data:image/png;base64');
    expect(p.notes.some((n: { zh: string }) => n.zh.includes('base64 内联'))).toBe(true);
    const consented = await json(await post('/api/preview', { form }, { 'x-upload-consent': '1' }));
    expect(JSON.stringify(consented.request.body)).toContain('提交时上传到');
  });

  it('没同意：照常提交，图片内联，不上传', async () => {
    const { post, form, calls } = await setupWithImages(1);
    const res = await post('/api/tasks', { form });
    expect(res.status).toBe(200);
    const { task } = await json(res);
    expect(task.status).toBe('succeeded');
    expect(String(task.request.image)).toMatch(/^data:image\/png;base64,/);
    expect(calls).toHaveLength(0);
  });

  it('同意：图片先传到托管站、请求里只放链接；多张并行上传，同一文件只传一次', async () => {
    const { post, form, refs, calls } = await setupWithImages(2, 0, 2);
    const both = { ...form, slots: { image: [refs[0]!, refs[1]!] } };
    const { task } = await json(await post('/api/tasks', { form: both }, { 'x-upload-consent': '1' }));
    expect(task.status).toBe('succeeded');
    expect(task.request.image).toEqual([expect.stringMatching(/^https:\/\/mock\.cdn\.invalid\/uploads\/[0-9a-f]{64}\.png$/), expect.stringMatching(/^https:\/\/mock\.cdn\.invalid\//)]);
    expect(new Set(calls).size).toBe(2);
    // 同一个文件放进两个位置：只上传一次；再次提交复用缓存的链接
    const dup = { ...form, slots: { image: [refs[0]!, { ...refs[0]!, id: 'dup' }] } };
    const before = calls.length;
    const again = await json(await post('/api/tasks', { form: { ...dup, prompt: 'a fox again' } }, { 'x-upload-consent': '1' }));
    expect(again.task.status).toBe('succeeded');
    expect(calls.length).toBe(before);
  });

  it('同一个文件同时出现在两个位置（还没缓存）：并行解析时也只上传一次', async () => {
    const { post, form, refs, calls } = await setupWithImages(1, 100);
    const dup = { ...form, slots: { image: [refs[0]!, { ...refs[0]!, id: 'dup' }] } };
    const { task } = await json(await post('/api/tasks', { form: dup }, { 'x-upload-consent': '1' }));
    expect(task.status).toBe('succeeded');
    expect(calls).toHaveLength(1);
  });
});

describe('工具函数', () => {
  it('tmpfiles 页面链接转直链', () => {
    expect(tmpfilesDirectUrl('http://tmpfiles.org/123456/clip.mp4')).toBe('https://tmpfiles.org/dl/123456/clip.mp4');
    expect(tmpfilesDirectUrl('https://tmpfiles.org/dl/1/a.mp4')).toBe('https://tmpfiles.org/dl/1/a.mp4');
  });

  it('MiniMax file_id 超过 2^53 时保持字符串', () => {
    expect(extractFileId('{"file":{"file_id":1234567890123456789,"bytes":10},"base_resp":{"status_code":0}}')).toBe('1234567890123456789');
    expect(extractFileId('{"file":{"file_id":"98765"}}')).toBe('98765');
  });

  it('adjustExpiryForUploads：取最早过期的直链，留 1 小时余量，下限 3600', () => {
    const now = 1_000_000_000_000;
    const built = { body: { execution_expires_after: 172800 }, notes: [] } as unknown as BuiltRequest;
    adjustExpiryForUploads(built, { a: { wire: 'u', preview: 'u', bytes: 1, expiresAt: now + 3 * 3600_000 }, b: { wire: 'v', preview: 'v', bytes: 1, expiresAt: now + 24 * 3600_000 } }, now);
    expect(built.body.execution_expires_after).toBe(7200);
    const short = { body: { execution_expires_after: 172800 }, notes: [] } as unknown as BuiltRequest;
    adjustExpiryForUploads(short, { a: { wire: 'u', preview: 'u', bytes: 1, expiresAt: now + 30 * 60_000 } }, now);
    expect(short.body.execution_expires_after).toBe(3600);
    const none = { body: { prompt: 'x' }, notes: [] } as unknown as BuiltRequest;
    adjustExpiryForUploads(none, { a: { wire: 'u', preview: 'u', bytes: 1, expiresAt: now + 3600_000 } }, now);
    expect(none.body).toEqual({ prompt: 'x' });
  });
});
