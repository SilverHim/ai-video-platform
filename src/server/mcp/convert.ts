import { isAbsolute } from 'node:path';
import type { AssetRef, FieldDef, FormInput, ModelDef, ProviderDef } from '../../shared/catalog/types.js';
import type { ResultRecord, TaskRecord } from '../../shared/task/records.js';
import type { AssetStore } from '../assets/asset-store.js';
import type { Store } from '../store/store.js';

export class McpInputError extends Error {}

/** agent 传来的素材写法 → AssetRef：本地绝对路径 / https URL / asset:// / mm_file:// / task:<任务id>#<序号> */
export async function toAssetRef(spec: string, slotKind: 'image' | 'video' | 'audio', d: { store: Store; assets: AssetStore }): Promise<AssetRef> {
  const id = `mcp-${Math.random().toString(36).slice(2, 10)}`;
  const s = spec.trim();
  if (/^https:\/\//i.test(s)) return { id, source: { type: 'url', url: s }, meta: { kind: slotKind } };
  if (s.startsWith('asset://')) return { id, source: { type: 'provider-asset', uri: s }, meta: { kind: slotKind } };
  if (s.startsWith('mm_file://')) return { id, source: { type: 'provider-file', uri: s }, meta: { kind: slotKind } };
  const task = /^task:([A-Za-z0-9-]+)#(\d+)$/.exec(s);
  if (task) {
    const rec = d.store.getTask(task[1]!);
    const r = rec?.results.find((x) => x.index === Number(task[2]) && (x.kind === slotKind || (slotKind === 'image' && x.role === 'last_frame')));
    if (!rec || !r) throw new McpInputError(`找不到任务结果 ${s}（用 get_task 查看可用的结果序号）`);
    return {
      id,
      source: { type: 'task-output', taskId: rec.id, index: r.index, ...(r.remoteUrl ? { remoteUrl: r.remoteUrl } : {}), ...(r.remoteExpiresAt ? { remoteExpiresAt: r.remoteExpiresAt } : {}), ...(r.path ? { localPath: r.path } : {}), ...(r.mime ? { mime: r.mime } : {}) },
      meta: { kind: slotKind, ...(r.mime ? { mime: r.mime } : {}), ...(r.bytes ? { bytes: r.bytes } : {}), ...(r.width ? { width: r.width } : {}), ...(r.height ? { height: r.height } : {}) },
    };
  }
  if (isAbsolute(s)) {
    const rec = await d.assets.saveFromPath(s);
    return { id, source: { type: 'local', assetId: rec.id, mime: rec.mime, bytes: rec.bytes, ...(rec.filename ? { filename: rec.filename } : {}), sha256: rec.sha256 }, meta: rec.meta ?? { kind: slotKind, mime: rec.mime, bytes: rec.bytes } };
  }
  throw new McpInputError(`无法识别的素材「${s}」：请用本地绝对路径、https:// 链接、asset://、mm_file:// 或 task:<任务id>#<序号>`);
}

export interface McpGenerateInput {
  model_id: string;
  mode?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  assets?: Record<string, string[]>;
  model_override?: string;
  /** MiniMax：用订阅 Key 还是按量 Key */
  credential?: 'paygo' | 'subscription';
}

export async function toForm(input: McpGenerateInput, provider: ProviderDef, model: ModelDef, d: { store: Store; assets: AssetStore }): Promise<FormInput> {
  const modeId = input.mode ?? model.modes.find((m) => m.entry !== 'derived' && !m.hiddenByDefault)?.id ?? model.modes[0]!.id;
  const mode = model.modes.find((m) => m.id === modeId);
  if (!mode) throw new McpInputError(`模型 ${model.id} 没有模式 ${modeId}；可用：${model.modes.map((m) => m.id).join(', ')}`);
  const slots: FormInput['slots'] = {};
  for (const [slotId, specs] of Object.entries(input.assets ?? {})) {
    const slot = mode.slots.find((s) => s.id === slotId);
    if (!slot) throw new McpInputError(`模式 ${modeId} 没有素材槽 ${slotId}；可用：${mode.slots.map((s) => s.id).join(', ') || '（无）'}`);
    slots[slotId] = [];
    for (const spec of specs) slots[slotId]!.push(await toAssetRef(spec, slot.kind, d));
  }
  return {
    providerId: provider.id,
    modelId: model.id,
    modeId,
    values: { ...(input.params ?? {}) },
    slots,
    prompt: input.prompt ?? '',
    ...(input.model_override ? { modelOverride: input.model_override } : {}),
    ...(input.credential ? { credential: input.credential } : {}),
  };
}

/** 字段声明 → 给 agent 看的 JSON 描述 */
export function describeField(f: FieldDef, modeIds: string[]) {
  const base = {
    key: f.key,
    type: f.type,
    label: f.label.zh,
    wire: f.wire,
    group: f.group,
    modes: f.modes ?? modeIds,
    ...(f.help ? { help: f.help.zh } : {}),
    ...(f.experimental ? { experimental: true } : {}),
    ...(typeof f.default !== 'function' ? { default: f.default } : { default: '（随上下文变化）' }),
  };
  switch (f.type) {
    case 'enum':
      return { ...base, options: f.options.map((o) => ({ value: o.value, ...(o.label ? { label: o.label.zh } : {}) })) };
    case 'int':
      return { ...base, min: f.min, max: f.max, ...(f.specials ? { specials: f.specials.map((s) => ({ value: s.value, label: s.label.zh })) } : {}), ...(f.pattern ? { pattern: `${f.pattern.base}+${f.pattern.step}n` } : {}) };
    case 'seed':
      return { ...base, min: f.min, max: f.max, note: 'null 表示随机' };
    case 'text':
      return { ...base, ...(f.maxLength ? { maxLength: f.maxLength } : {}) };
    case 'size':
      return { ...base, format: "{mode:'preset', value:'<档位>'} 或 {mode:'custom', width, height}" };
    default:
      return base;
  }
}

/** 任务 → 精简摘要（控制 MCP 输出体积） */
export function summarizeTask(t: TaskRecord, outputsRoot: string) {
  return {
    task_id: t.id,
    status: t.status,
    model_id: t.modelId,
    mode: t.modeId,
    created_at: new Date(t.createdAt).toISOString(),
    ...(t.upstreamTaskId ? { upstream_task_id: t.upstreamTaskId } : {}),
    ...(t.costEstimate ? { estimated_cost_usd: t.costEstimate.amount } : {}),
    ...(t.error ? { error: { code: t.error.code, message: t.error.message, ...(t.error.hint ? { hint: t.error.hint.zh } : {}) } } : {}),
    ...(t.failures.length ? { failed_items: t.failures.length } : {}),
    files: t.results.map((r: ResultRecord) => ({
      ref: `task:${t.id}#${r.index}`,
      role: r.role,
      kind: r.kind,
      ...(r.path ? { path: `${outputsRoot}/${r.path}` } : { saved: false }),
      ...(r.mime ? { mime: r.mime } : {}),
      ...(r.width && r.height ? { size: `${r.width}x${r.height}` } : {}),
      ...(r.layer?.name ? { layer: r.layer.name } : {}),
    })),
  };
}
