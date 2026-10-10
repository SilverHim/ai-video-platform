import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../upstream/http.js';
import { mockFetch, setMockTiming } from '../mock/upstream.js';
import { makeApp } from './helpers.js';
import { fakeCatalog, fakeForm } from './fake-catalog.js';

let cleanup: () => Promise<void> = async () => {};
beforeEach(() => setMockTiming({ queuedMs: 0, runningMs: 0 }));
afterEach(async () => {
  await cleanup();
  setMockTiming({ queuedMs: 1500, runningMs: 3000 });
});

/** 出图请求在 release() 之前一直挂着，用来模拟上游要很久 */
function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchImpl: FetchLike = async (url, init) => {
    if (String(url).includes('/images/generations')) await gate;
    return mockFetch(url, init);
  };
  return { fetchImpl, release };
}

function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  const made = makeApp({ catalog: fakeCatalog, ...opts });
  cleanup = made.cleanup;
  return made;
}

describe('TaskService.start（提交后不等上游）', () => {
  it('立即返回提交中的任务，完成后记下完成时间；之后收藏不改完成时间', async () => {
    const g = gatedFetch();
    const { services, store } = setup({ fetchImpl: g.fetchImpl });
    const { task, done } = await services.tasks.start(fakeForm(), 'mcp');
    expect(task.status).toBe('submitting');
    expect(store.getTask(task.id)!.finishedAt ?? null).toBeNull();
    g.release();
    const finished = await done;
    expect(finished.status).toBe('succeeded');
    expect(finished.finishedAt).toEqual(expect.any(Number));
    const at = finished.finishedAt;
    store.updateTask(task.id, { favorite: true }, at! + 86_400_000);
    const later = store.getTask(task.id)!;
    expect(later.finishedAt).toBe(at);
    expect(later.updatedAt).toBe(at! + 86_400_000);
  });

  it('后台执行时数据库已关闭：done 仍然兑现，不产生未处理的拒绝', async () => {
    const g = gatedFetch();
    const { services, store } = setup({ fetchImpl: g.fetchImpl });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { task, done } = await services.tasks.start(fakeForm(), 'mcp');
      store.close();
      g.release();
      const result = await done;
      expect(result.id).toBe(task.id);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('drain 最多等到超时；后台完成后立即返回', async () => {
    const g = gatedFetch();
    const { services } = setup({ fetchImpl: g.fetchImpl });
    const { done } = await services.tasks.start(fakeForm(), 'mcp');
    const t0 = Date.now();
    await services.tasks.drain(80);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    g.release();
    await services.tasks.drain(5_000);
    expect((await done).status).toBe('succeeded');
  });
});

describe('完成时间与关闭', () => {
  it('迁移前就已结束的旧记录：补下载改回 succeeded 时不补写完成时间', async () => {
    const { services, store } = setup();
    const t = await services.tasks.submit(fakeForm(), 'web');
    store.updateTask(t.id, { status: 'partial' });
    // 模拟迁移前的记录：没有 finished_at
    (store as unknown as { db: { prepare: (s: string) => { run: (p: Record<string, unknown>) => void } } }).db.prepare('UPDATE tasks SET finished_at = NULL WHERE id = $id').run({ id: t.id });
    store.updateTask(t.id, { status: 'succeeded' });
    expect(store.getTask(t.id)!.finishedAt ?? null).toBeNull();
  });

  it('进入关闭流程后拒绝新的提交', async () => {
    const { services } = setup();
    await services.tasks.drain(10);
    await expect(services.tasks.start(fakeForm(), 'mcp')).rejects.toMatchObject({ code: 'shutting_down' });
  });
});

describe('重启后的恢复', () => {
  it('停在提交中 / 生成中的同步任务标为 submit_unknown；可续查的异步任务不动', async () => {
    const { services, store } = setup();
    const img = await services.tasks.submit(fakeForm(), 'web');
    store.updateTask(img.id, { status: 'running' });
    const video = await services.tasks.submit(fakeForm({ modelId: 'fake/video', modeId: 't2v', prompt: 'a dog' }), 'web');
    expect(video.status).toBe('queued');

    expect(services.tasks.recoverInterrupted()).toBe(1);
    const stuck = store.getTask(img.id)!;
    expect(stuck.status).toBe('submit_unknown');
    expect(stuck.error?.code).toBe('INTERRUPTED');
    expect(store.getTask(video.id)!.status).toBe('queued');
  });
});
