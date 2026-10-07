import { create } from 'zustand';
import type { ServerEvent, TaskRecord } from '../../shared/task/records';
import { api } from '../lib/api-client';

interface TasksState {
  byId: Record<string, TaskRecord>;
  /** 按创建时间倒序 */
  order: string[];
  connected: boolean;
  loaded: boolean;
  upsert: (t: TaskRecord) => void;
  remove: (id: string) => void;
  loadRecent: () => Promise<void>;
  apply: (ev: ServerEvent) => void;
  setConnected: (c: boolean) => void;
}

const sortIds = (byId: Record<string, TaskRecord>) => Object.values(byId).sort((a, b) => b.createdAt - a.createdAt).map((t) => t.id);

/** 任务以服务端为准；这里只是缓存 + 事件实时更新 */
export const useTasks = create<TasksState>((set, get) => ({
  byId: {},
  order: [],
  connected: false,
  loaded: false,
  upsert: (t) =>
    set((s) => {
      const prev = s.byId[t.id];
      if (prev && prev.updatedAt > t.updatedAt) return s;
      const byId = { ...s.byId, [t.id]: t };
      return { byId, order: prev ? s.order : sortIds(byId) };
    }),
  remove: (id) =>
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return { byId, order: s.order.filter((x) => x !== id) };
    }),
  loadRecent: async () => {
    const list = await api.listTasks({ limit: 100 });
    set((s) => {
      const byId = { ...s.byId };
      for (const t of list) if (!byId[t.id] || byId[t.id]!.updatedAt <= t.updatedAt) byId[t.id] = t;
      return { byId, order: sortIds(byId), loaded: true };
    });
  },
  apply: (ev) => {
    if (ev.type === 'task.updated') get().upsert(ev.task);
    else if (ev.type === 'task.deleted') get().remove(ev.taskId);
  },
  setConnected: (connected) => set({ connected }),
}));

let started = false;
/** 应用启动时调用一次：拉最近任务 + 订阅事件（断线重连后重新拉取） */
export function startTaskSync(): void {
  if (started) return;
  started = true;
  const { apply, setConnected, loadRecent } = useTasks.getState();
  void loadRecent().catch(() => undefined);
  api.subscribe(apply, (c) => {
    setConnected(c);
    if (c) void loadRecent().catch(() => undefined);
  });
}
