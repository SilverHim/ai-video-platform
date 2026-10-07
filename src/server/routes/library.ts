import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { PresetRecord, TemplateRecord } from '../../shared/task/records.js';
import { rebuildFromOutputs } from '../capture/rebuild.js';
import { safeJoin } from '../http/send-file.js';
import { revealInFileManager } from '../platform/reveal.js';
import type { AppDeps } from '../app.js';

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** 预设、模板、收藏备注、outputs 相关操作 */
export function libraryRoutes(deps: AppDeps) {
  const app = new Hono();
  const { store } = deps;

  app.get('/presets', (c) => c.json({ presets: store.listPresets(c.req.query('modelId') || undefined) }));
  app.put('/presets/:id?', async (c) => {
    const b = (await c.req.json().catch(() => null)) as Partial<PresetRecord> | null;
    const name = str(b?.name);
    if (!b || !name || !str(b.modelId) || !str(b.modeId) || typeof b.values !== 'object' || b.values === null) return c.json({ error: { code: 'bad_request', message: '需要 name / modelId / modeId / values' } }, 400);
    const id = c.req.param('id') ?? randomUUID();
    const prev = store.getPreset(id);
    const now = Date.now();
    const rec: PresetRecord = { id, name, modelId: b.modelId!, modeId: b.modeId!, values: b.values as Record<string, unknown>, prompt: typeof b.prompt === 'string' ? b.prompt : null, createdAt: prev?.createdAt ?? now, updatedAt: now };
    store.upsertPreset(rec);
    return c.json({ preset: rec });
  });
  app.delete('/presets/:id', (c) => (store.deletePreset(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: { code: 'not_found', message: '预设不存在' } }, 404)));

  app.get('/templates', (c) => c.json({ templates: store.listTemplates() }));
  app.put('/templates/:id?', async (c) => {
    const b = (await c.req.json().catch(() => null)) as Partial<TemplateRecord> | null;
    const name = str(b?.name);
    const text = typeof b?.text === 'string' && b.text.trim() ? b.text.slice(0, 20_000) : null;
    if (!name || !text) return c.json({ error: { code: 'bad_request', message: '需要 name / text' } }, 400);
    const id = c.req.param('id') ?? randomUUID();
    const prev = store.listTemplates().find((x) => x.id === id);
    const now = Date.now();
    const rec: TemplateRecord = { id, name, text, tags: Array.isArray(b?.tags) ? b.tags.filter((x): x is string => typeof x === 'string').slice(0, 20) : [], createdAt: prev?.createdAt ?? now, updatedAt: now };
    store.upsertTemplate(rec);
    return c.json({ template: rec });
  });
  app.delete('/templates/:id', (c) => (store.deleteTemplate(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: { code: 'not_found', message: '模板不存在' } }, 404)));

  /** 收藏 / 备注 */
  app.patch('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    if (!store.getTask(id)) return c.json({ error: { code: 'not_found', message: '任务不存在' } }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { favorite?: unknown; note?: unknown };
    store.updateTask(id, { ...(typeof b.favorite === 'boolean' ? { favorite: b.favorite } : {}), ...(typeof b.note === 'string' || b.note === null ? { note: (b.note as string | null)?.slice(0, 2000) ?? null } : {}) });
    const task = store.getTask(id)!;
    deps.services.events.emit({ type: 'task.updated', task });
    return c.json({ task });
  });

  /** 在访达 / 资源管理器中显示结果文件，或用系统播放器打开（播放降级时用） */
  app.post('/outputs/:action{reveal|open}', async (c) => {
    const b = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    const abs = typeof b?.path === 'string' ? safeJoin(deps.config.paths.outputs, `/${b.path}`) : null;
    if (!abs) return c.json({ error: { code: 'bad_path', message: '路径不合法' } }, 400);
    const ok = await revealInFileManager(abs, c.req.param('action') as 'reveal' | 'open');
    return c.json({ ok });
  });

  /** 从 outputs 下的 manifest 重建历史（数据库丢失或换机时） */
  app.post('/outputs/rebuild', async (c) => c.json(await rebuildFromOutputs(store, deps.config.paths.outputs)));

  return app;
}
