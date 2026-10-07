import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuiltRequest } from '../../shared/request/build.js';
import { setMockTiming } from '../mock/upstream.js';
import { adjustExpiryForUploads } from '../tasks/task-service.js';
import { extractFileId } from '../upload-targets/minimax-files.js';
import { tmpfilesDirectUrl } from '../upload-targets/temp-hosts.js';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';
import { MOCK_MP4_BASE64 } from '../mock/media.js';

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

  it('选择 tmpfiles 托管', async () => {
    const { post, form } = await setupWithVideoAsset();
    const p = await json(await post('/api/preview', { form }, { 'x-upload-target': 'tmpfiles' }));
    expect(p.uploads.target.id).toBe('tmpfiles');
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
