import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../shared/task/records.js';
import { MockDownloader } from '../mock/upstream.js';
import { makePng } from '../mock/png.js';
import { BASE, makeApp, WEB_HEADERS, json } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';

let cleanup = () => {};
afterEach(() => cleanup());

function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  const made = makeApp({ catalog: fakeCatalog, ...opts });
  cleanup = made.cleanup;
  const post = (path: string, body: unknown) => made.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path: string) => made.app.request(`${BASE}${path}`, { headers: WEB_HEADERS });
  return { ...made, post, get };
}

async function readSse(res: Response, until: (text: string) => boolean, timeoutMs = 3000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !until(text)) {
    const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), deadline - Date.now()))]);
    if (r.done) break;
    text += dec.decode(r.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

describe('/api/preview', () => {
  it('返回请求、curl（Key 占位）、费用', async () => {
    const { post } = setup();
    const res = await post('/api/preview', { form: fakeForm() });
    const body = await json(res);
    expect(body.canSubmit).toBe(true);
    expect(body.request).toMatchObject({ method: 'POST', url: 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', body: { model: 'fake-img-001', prompt: 'a cat', stream: false } });
    expect(body.curl).toContain('$ARK_API_KEY');
    expect(body.cost).toMatchObject({ amount: 0.03 });
  });

  it('未知模型 404、缺 form 400', async () => {
    const { post } = setup();
    expect((await post('/api/preview', { form: fakeForm({ modelId: 'nope' }) })).status).toBe(404);
    expect((await post('/api/preview', {})).status).toBe(400);
  });
});

describe('/api/tasks（同步图像）', () => {
  it('提交 → 落盘 → /files 可访问 → manifest', async () => {
    const { post, get, config } = setup();
    const res = await post('/api/tasks', { form: fakeForm() });
    const { task } = (await json(res)) as { task: TaskRecord };
    expect(task.status).toBe('succeeded');
    expect(task.capture).toBe('done');
    expect(task.origin).toBe('web');
    expect(task.results).toHaveLength(1);
    const r = task.results[0]!;
    expect(r).toMatchObject({ role: 'image', mime: 'image/png' });
    expect(r.remoteUrl).toMatch(/^https:\/\/mock\.cdn\.invalid\//);
    const file = await get(`/files/${r.path}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(existsSync(join(config.paths.outputs, task.outputDir!, 'manifest.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(config.paths.outputs, task.outputDir!, 'manifest.json'), 'utf8'));
    expect(manifest.task.form.prompt).toBe('a cat');
    expect(JSON.stringify(manifest)).not.toContain('mock-key');
    const detail = await json(await get(`/api/tasks/${task.id}`));
    expect(detail.exchanges[0]).toMatchObject({ kind: 'submit', status: 200 });
  });

  it('组图中一张被拦截 → partial，failures 记录', async () => {
    const { post } = setup();
    const { task } = await json(await post('/api/tasks', { form: fakeForm({ prompt: 'MOCK_SENSITIVE', values: { group: true } }) }));
    expect(task.status).toBe('partial');
    expect(task.results).toHaveLength(2);
    expect(task.failures).toHaveLength(1);
  });

  it('b64 结果直接解码落盘', async () => {
    const { post } = setup();
    const { task } = await json(await post('/api/tasks', { form: fakeForm({ values: { b64: true } }) }));
    expect(task.status).toBe('succeeded');
    expect(task.results[0].bytes).toBeGreaterThan(0);
    expect(task.results[0].remoteUrl).toBeNull();
  });

  it('上游参数错误 → failed + 归一化错误', async () => {
    const { post } = setup();
    const { task } = await json(await post('/api/tasks', { form: fakeForm({ prompt: 'MOCK_FAIL' }) }));
    expect(task.status).toBe('failed');
    expect(task.error).toMatchObject({ category: 'invalid_param', code: 'InvalidParameter', requestId: 'mock0000000001' });
  });

  it('表单校验不通过 → 400 + issues，不建任务', async () => {
    const { post, get } = setup();
    const res = await post('/api/tasks', { form: fakeForm({ prompt: '  ' }) });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('invalid_form');
    expect(body.error.issues[0].id).toBe('prompt:required');
    expect((await json(await get('/api/tasks'))).tasks).toHaveLength(0);
  });

  it('非 mock 模式缺 Key → 400 missing_key', async () => {
    const { post } = setup({ mock: false });
    const res = await post('/api/tasks', { form: fakeForm() });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('missing_key');
  });

  it('列表与删除', async () => {
    const { post, get, app } = setup();
    const { task } = await json(await post('/api/tasks', { form: fakeForm() }));
    expect((await json(await get('/api/tasks?limit=10'))).tasks.map((t: TaskRecord) => t.id)).toEqual([task.id]);
    const del = await app.request(`${BASE}/api/tasks/${task.id}`, { method: 'DELETE', headers: WEB_HEADERS });
    expect(del.status).toBe(200);
    expect((await get(`/api/tasks/${task.id}`)).status).toBe(404);
  });
});

describe('/api/tasks/stream（SSE）', () => {
  it('逐张落盘并推送 ark.capture，最后 ark.done', async () => {
    const { post, store } = setup();
    const res = await post('/api/tasks/stream', { form: fakeForm({ prompt: 'MOCK_SENSITIVE', values: { stream: true, group: true } }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await readSse(res, (t) => t.includes('event: ark.done'), 5000);
    expect(text).toContain('event: ark.task');
    expect(text.match(/event: ark\.capture/g)).toHaveLength(2);
    expect(text).toContain('event: ark.failure');
    const taskId = /"taskId":"([^"]+)"/.exec(text)![1]!;
    const task = store.getTask(taskId)!;
    expect(task.status).toBe('partial');
    expect(task.results.filter((r) => r.path)).toHaveLength(2);
    expect(store.listExchanges(taskId).some((e) => e.kind === 'sse')).toBe(true);
  });
});

describe('/api/events', () => {
  it('提交任务时推送 task.updated', async () => {
    const { app, post } = setup();
    const evRes = await app.request(`${BASE}/api/events`, { headers: WEB_HEADERS });
    const reading = readSse(evRes, (t) => /"status":"succeeded"/.test(t), 4000);
    await new Promise((r) => setTimeout(r, 50));
    await post('/api/tasks', { form: fakeForm() });
    const text = await reading;
    expect(text).toContain('event: ready');
    expect(text).toContain('event: task.updated');
    expect(text).toContain('"status":"succeeded"');
  });
});

describe('/api/assets 与本地素材', () => {
  it('上传 PNG：读出宽高，相同内容去重；提交时转成 data URI', async () => {
    const { app, post, store } = setup();
    const png = makePng(20, 10);
    const up = (name: string) => app.request(`${BASE}/api/assets`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'image/png', 'x-asset-filename': encodeURIComponent(name) }, body: png });
    const a = (await json(await up('参考图.png'))).asset;
    const b = (await json(await up('again.png'))).asset;
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ mime: 'image/png', bytes: png.length, filename: '参考图.png', meta: { kind: 'image', width: 20, height: 10, hasAlpha: false } });
    const content = await app.request(`${BASE}/api/assets/${a.id}/content`, { headers: WEB_HEADERS });
    expect(Buffer.from(await content.arrayBuffer()).equals(png)).toBe(true);

    const slots = { image: [{ id: 'ref1', source: { type: 'local', assetId: a.id, mime: 'image/png', bytes: png.length }, meta: a.meta }] };
    const preview = await json(await post('/api/preview', { form: fakeForm({ slots, prompt: 'like {{ref:ref1}}' }) }));
    expect(preview.request.body.image).toMatch(/^data:image\/png;base64,…\(/);
    expect(preview.request.body.prompt).toBe('like Image 1');

    const { task } = await json(await post('/api/tasks', { form: fakeForm({ slots, prompt: 'like {{ref:ref1}}' }) }));
    expect(task.status).toBe('succeeded');
    expect(String(task.request.image)).toMatch(/^data:image\/png;base64,…/);
    expect(store.getTask(task.id)!.form.slots.image![0]!.source).toMatchObject({ type: 'local', assetId: a.id });
  });

  it('素材不存在 → 任务失败（本地校验）', async () => {
    const { post } = setup();
    const slots = { image: [{ id: 'x', source: { type: 'local', assetId: 'missing', mime: 'image/png', bytes: 10 } }] };
    const res = await post('/api/tasks', { form: fakeForm({ slots }) });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('asset_resolve_failed');
  });
});

describe('每个结果只下载一次', () => {
  it('并发 capture 同一结果只调用一次下载器；重复 capture 复用账本', async () => {
    let calls = 0;
    const inner = new MockDownloader();
    const downloader = { download: (u: string, d: string) => (calls++, inner.download(u, d)) };
    const { services, store } = setup({ downloader });
    const task = await services.tasks.submit(fakeForm(), 'web');
    expect(calls).toBe(1);
    const asset = { index: 0, role: 'image' as const, kind: 'image' as const, source: { type: 'url' as const, url: task.results[0]!.remoteUrl! } };
    await Promise.all([services.capture.capture(store.getTask(task.id)!, [asset]), services.capture.capture(store.getTask(task.id)!, [asset])]);
    expect(calls).toBe(1);
  });
});

describe('/api/keys/:provider/test', () => {
  it('mock 上游下校验成功', async () => {
    const { post } = setup();
    expect(await json(await post('/api/keys/byteplus/test', {}))).toMatchObject({ ok: true, status: 200 });
  });
});
