import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';

let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  await cleanup();
});

function setup() {
  const made = makeApp({ catalog: fakeCatalog });
  cleanup = made.cleanup;
  const call = (method: string, path: string, body?: unknown) => made.app.request(`${BASE}${path}`, { method, headers: { ...WEB_HEADERS, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { ...made, call };
}

describe('预设与模板', () => {
  it('预设 CRUD，按模型过滤', async () => {
    const { call } = setup();
    const p = (await json(await call('PUT', '/api/presets', { name: '电影感', modelId: 'fake/img', modeId: 'generate', values: { b64: true }, prompt: 'cinematic' }))).preset;
    expect(p).toMatchObject({ name: '电影感', values: { b64: true }, prompt: 'cinematic' });
    await call('PUT', `/api/presets/${p.id}`, { name: '电影感 2', modelId: 'fake/img', modeId: 'generate', values: {} });
    expect((await json(await call('GET', '/api/presets?modelId=fake/img'))).presets).toMatchObject([{ id: p.id, name: '电影感 2', createdAt: p.createdAt }]);
    expect((await json(await call('GET', '/api/presets?modelId=other'))).presets).toEqual([]);
    expect((await call('PUT', '/api/presets', { name: 'x' })).status).toBe(400);
    expect((await call('DELETE', `/api/presets/${p.id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/presets/${p.id}`)).status).toBe(404);
  });

  it('模板 CRUD', async () => {
    const { call } = setup();
    const tp = (await json(await call('PUT', '/api/templates', { name: '产品图', text: '{{主体}} 放在白色背景上', tags: ['电商'] }))).template;
    expect((await json(await call('GET', '/api/templates'))).templates[0]).toMatchObject({ id: tp.id, tags: ['电商'] });
    expect((await call('PUT', '/api/templates', { name: '空' })).status).toBe(400);
  });
});

describe('收藏 / 备注 / 重建历史 / 在文件夹中显示', () => {
  it('收藏与备注', async () => {
    const { call, services } = setup();
    const task = await services.tasks.submit(fakeForm(), 'web');
    const patched = (await json(await call('PATCH', `/api/tasks/${task.id}`, { favorite: true, note: '好看' }))).task;
    expect(patched).toMatchObject({ favorite: true, note: '好看' });
  });

  it('删掉数据库记录后从 manifest 恢复', async () => {
    const { call, services, store } = setup();
    const task = await services.tasks.submit(fakeForm({ prompt: 'restore me' }), 'web');
    store.deleteTask(task.id);
    const r = await json(await call('POST', '/api/outputs/rebuild', {}));
    expect(r).toEqual({ scanned: 1, restored: 1 });
    const back = store.getTask(task.id)!;
    expect(back).toMatchObject({ status: 'succeeded', modelId: 'fake/img', form: { prompt: 'restore me' }, note: '从 outputs 重建' });
    expect(back.results[0]!.path).toBe(task.results[0]!.path);
    // 已存在的不重复导入
    expect(await json(await call('POST', '/api/outputs/rebuild', {}))).toEqual({ scanned: 1, restored: 0 });
  });

  it('reveal 拒绝路径穿越', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/outputs/reveal', { path: '../../etc/passwd' })).status).toBe(400);
    expect((await call('POST', '/api/outputs/reveal', {})).status).toBe(400);
  });

  it('outputs 目录不存在时重建返回 0', async () => {
    const { call, config } = setup();
    rmSync(config.paths.outputs, { recursive: true, force: true });
    expect(await json(await call('POST', '/api/outputs/rebuild', {}))).toEqual({ scanned: 0, restored: 0 });
  });
});
