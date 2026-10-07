import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { FormInput } from '../../shared/catalog/types.js';
import type { ResultRecord } from '../../shared/task/records.js';
import type { Store } from '../store/store.js';

interface Manifest {
  version: number;
  task: { id: string; createdAt: number; origin: 'web' | 'mcp'; providerId: string; modelId: string; apiModel: string; modeId: string; upstreamTaskId: string | null; form: FormInput; request: Record<string, unknown> | null; usage: Record<string, unknown> | null; actual: Record<string, unknown> | null };
  files: { role: ResultRecord['role']; index: number; path: string | null; mime: string | null; bytes: number | null; width: number | null; height: number | null; layer: ResultRecord['layer'] }[];
}

/** 扫描 outputs/<日期>/<目录>/manifest.json，把数据库里没有的任务补回来（数据库丢失时重建历史） */
export async function rebuildFromOutputs(store: Store, outputsRoot: string): Promise<{ scanned: number; restored: number }> {
  let scanned = 0;
  let restored = 0;
  if (!existsSync(outputsRoot)) return { scanned, restored };
  for (const day of await readdir(outputsRoot, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
    for (const dir of await readdir(join(outputsRoot, day.name), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = join(outputsRoot, day.name, dir.name, 'manifest.json');
      if (!existsSync(file)) continue;
      scanned += 1;
      let m: Manifest;
      try {
        m = JSON.parse(await readFile(file, 'utf8')) as Manifest;
      } catch {
        continue;
      }
      if (!m.task?.id || store.getTask(m.task.id)) continue;
      const rel = posix.join(day.name, dir.name);
      const ok = m.files.filter((f) => f.path).length;
      store.insertTask({
        id: m.task.id,
        createdAt: m.task.createdAt,
        updatedAt: m.task.createdAt,
        origin: m.task.origin,
        providerId: m.task.providerId,
        modelId: m.task.modelId,
        apiModel: m.task.apiModel,
        modeId: m.task.modeId,
        kind: m.files.some((f) => f.role === 'video') ? 'async' : 'sync',
        status: ok === m.files.length ? 'succeeded' : 'partial',
        upstreamTaskId: m.task.upstreamTaskId,
        baseUrlId: '',
        form: m.task.form,
        request: m.task.request,
        error: null,
        failures: [],
        usage: m.task.usage,
        actual: m.task.actual,
        capture: ok === m.files.length ? 'done' : 'partial',
        outputDir: rel,
        parentTaskId: null,
        costEstimate: null,
        favorite: false,
        note: '从 outputs 重建',
      });
      for (const f of m.files) {
        store.upsertResult({ id: randomUUID(), taskId: m.task.id, index: f.index, role: f.role, kind: f.role === 'video' ? 'video' : 'image', path: f.path ? posix.join(rel, f.path) : null, mime: f.mime, bytes: f.bytes, width: f.width, height: f.height, remoteUrl: null, remoteExpiresAt: null, layer: f.layer });
      }
      restored += 1;
    }
  }
  return { scanned, restored };
}
