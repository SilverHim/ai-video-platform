import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMockTiming } from '../mock/upstream.js';
import { nextInterval, Scheduler } from '../tasks/scheduler.js';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';

let cleanup = () => {};
beforeEach(() => setMockTiming({ queuedMs: 0, runningMs: 0 }));
afterEach(() => {
  cleanup();
  setMockTiming({ queuedMs: 1500, runningMs: 3000 });
});

function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  const made = makeApp({ catalog: fakeCatalog, ...opts });
  cleanup = made.cleanup;
  return made;
}
const videoForm = (over: Record<string, unknown> = {}) => fakeForm({ modelId: 'fake/video', modeId: 't2v', ...over });

describe('nextInterval', () => {
  it('按年龄匹配并抖动 ±10%', () => {
    const p = { firstDelayMs: 5000, schedule: [{ untilAgeMs: 120_000, intervalMs: 5000 }], defaultIntervalMs: 15_000, queryWindowMs: 1 };
    expect(nextInterval(p, 1000, () => 0.5)).toBe(5000);
    expect(nextInterval(p, 1000, () => 0)).toBe(4500);
    expect(nextInterval(p, 1000, () => 1)).toBe(5500);
    expect(nextInterval(p, 200_000, () => 0.5)).toBe(15_000);
  });
});

describe('异步视频任务', () => {
  it('创建 → queued → 轮询成功 → 视频与尾帧落盘', async () => {
    const { services, store } = setup();
    const task = await services.tasks.submit(videoForm({ prompt: 'a dog runs' }), 'web');
    expect(task.status).toBe('queued');
    expect(task.upstreamTaskId).toMatch(/^cgt-mock-/);
    expect(services.scheduler.isTracking(task.id)).toBe(true);
    await services.scheduler.poll(task.id);
    const done = store.getTask(task.id)!;
    expect(done.status).toBe('succeeded');
    expect(done.capture).toBe('done');
    expect(done.results.map((r) => `${r.role}:${r.mime}`).sort()).toEqual(['last_frame:image/jpeg', 'video:video/mp4']);
    expect(done.outputDir).toContain(`byteplus-${done.upstreamTaskId}`);
    expect(store.getPoll(task.id)).toBeNull();
  });

  it('排队中继续轮询，状态推进时推送更新', async () => {
    setMockTiming({ queuedMs: 60_000, runningMs: 120_000 });
    const { services, store } = setup();
    const task = await services.tasks.submit(videoForm(), 'web');
    await services.scheduler.poll(task.id);
    expect(store.getTask(task.id)!.status).toBe('queued');
    const poll = store.getPoll(task.id)!;
    expect(poll.attempts).toBe(1);
    expect(poll.nextAt).toBeGreaterThan(Date.now());
  });

  it('服务商返回失败 → failed + 错误', async () => {
    const { services, store } = setup();
    const task = await services.tasks.submit(videoForm({ prompt: 'MOCK_FAIL' }), 'web');
    await services.scheduler.poll(task.id);
    expect(store.getTask(task.id)!).toMatchObject({ status: 'failed', error: { code: 'InvalidParameter.TaskTypeConstraint' } });
  });

  it('创建时被拒 → 直接 failed，不进入轮询', async () => {
    const { services } = setup();
    const task = await services.tasks.submit(videoForm({ prompt: 'MOCK_REJECT' }), 'web');
    expect(task.status).toBe('failed');
    expect(services.scheduler.isTracking(task.id)).toBe(false);
  });

  it('重启后恢复轮询', async () => {
    setMockTiming({ queuedMs: 60_000, runningMs: 120_000 });
    const made = setup();
    const task = await made.services.tasks.submit(videoForm(), 'web');
    made.services.scheduler.stop();
    setMockTiming({ queuedMs: 0, runningMs: 0 });
    const timers: { fn: () => void; ms: number }[] = [];
    const s2 = new Scheduler({
      store: made.store,
      keystore: made.keystore,
      upstream: (made.services.tasks as unknown as { d: { upstream: never } }).d.upstream,
      capture: made.services.capture,
      catalog: fakeCatalog,
      emit: () => undefined,
      mock: true,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
    });
    s2.start();
    expect(timers).toHaveLength(1);
    await s2.poll(task.id);
    expect(made.store.getTask(task.id)!.status).toBe('succeeded');
  });

  it('非 mock 且缺 Key → 暂停轮询并说明', async () => {
    const { services, store, keystore } = setup({ mock: false, fetchImpl: (await import('../mock/upstream.js')).mockFetch });
    keystore.set('byteplus', 'sk-test-0123456789abcdef');
    const task = await services.tasks.submit(videoForm(), 'web');
    keystore.clear('byteplus');
    await services.scheduler.poll(task.id);
    expect(store.getPoll(task.id)!.pausedReason).toBe('missing_key');
    expect(store.getTask(task.id)!.error?.code).toBe('MISSING_KEY');
  });
});

describe('取消 / 重查 / 云端列表接口', () => {
  it('排队中可以取消；生成中不能取消', async () => {
    setMockTiming({ queuedMs: 60_000, runningMs: 120_000 });
    const { app, services } = setup();
    const task = await services.tasks.submit(videoForm(), 'web');
    const res = await app.request(`${BASE}/api/tasks/${task.id}/cancel`, { method: 'POST', headers: WEB_HEADERS });
    expect(await json(res)).toMatchObject({ ok: true, task: { status: 'cancelled' } });
  });

  it('refresh 立即查询', async () => {
    const { app, services } = setup();
    const task = await services.tasks.submit(videoForm(), 'web');
    const res = await app.request(`${BASE}/api/tasks/${task.id}/refresh`, { method: 'POST', headers: WEB_HEADERS });
    expect((await json(res)).task.status).toBe('succeeded');
  });

  it('已结束的任务可删除云端记录', async () => {
    const { app, services, store } = setup();
    const task = await services.tasks.submit(videoForm(), 'web');
    await services.scheduler.poll(task.id);
    const res = await app.request(`${BASE}/api/tasks/${task.id}?remote=1`, { method: 'DELETE', headers: WEB_HEADERS });
    expect(res.status).toBe(200);
    expect(store.getTask(task.id)).toBeNull();
  });

  it('云端任务列表', async () => {
    const { app, services } = setup();
    await services.tasks.submit(videoForm(), 'web');
    const res = await app.request(`${BASE}/api/cloud/byteplus/tasks`, { headers: WEB_HEADERS });
    const body = await json(res);
    expect(body.body.total).toBeGreaterThanOrEqual(1);
  });
});
