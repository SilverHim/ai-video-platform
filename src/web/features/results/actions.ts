import type { AssetRef, FormInput } from '../../../shared/catalog/types';
import { getModel } from '../../../shared/providers/registry';
import type { ResultRecord, TaskRecord } from '../../../shared/task/records';

/** 历史结果 → 素材引用（优先用仍有效的官方链接，保持"可信输出"身份） */
export function resultAsAsset(task: TaskRecord, r: ResultRecord): AssetRef {
  return {
    id: crypto.randomUUID(),
    source: {
      type: 'task-output',
      taskId: task.id,
      index: r.index,
      ...(r.remoteUrl ? { remoteUrl: r.remoteUrl } : {}),
      ...(r.remoteExpiresAt ? { remoteExpiresAt: r.remoteExpiresAt } : {}),
      ...(r.path ? { localPath: r.path } : {}),
      ...(r.mime ? { mime: r.mime } : {}),
    },
    meta: { kind: r.kind, ...(r.mime ? { mime: r.mime } : {}), ...(r.bytes ? { bytes: r.bytes } : {}), ...(r.width ? { width: r.width } : {}), ...(r.height ? { height: r.height } : {}) },
  };
}

const SEEDANCE_25 = 'byteplus/seedance-2-5';

/** 样片 → 正片：只对开了 draft 且成功的任务，且模型有 draft_final 派生模式 */
export function draftFinalForm(task: TaskRecord): FormInput | null {
  const found = getModel(task.modelId);
  if (!found || task.status !== 'succeeded' || !task.upstreamTaskId || task.request?.draft !== true) return null;
  if (!found.model.modes.some((m) => m.id === 'draft_final')) return null;
  // 沿用样片的参数；draft / resolution 由正片模式自己决定，其余不可重设的字段 evaluate 会忽略
  const { draft: _draft, resolution: _resolution, ...values } = task.form.values;
  return {
    providerId: found.provider.id,
    modelId: task.modelId,
    modeId: 'draft_final',
    values,
    slots: {},
    prompt: '',
    ...(task.form.modelOverride ? { modelOverride: task.form.modelOverride } : {}),
    derivedFrom: { taskId: task.id, upstreamTaskId: task.upstreamTaskId, modelId: task.modelId, createdAt: task.createdAt, relation: 'draft-final' },
  };
}

/** 编辑 / 延长此视频（Seedance 2.5） */
export function editExtendForm(task: TaskRecord, r: ResultRecord, relation: 'edit' | 'extend'): FormInput | null {
  const found = getModel(SEEDANCE_25);
  if (!found || r.kind !== 'video' || !found.model.modes.some((m) => m.id === relation)) return null;
  const asset = resultAsAsset(task, r);
  return {
    providerId: found.provider.id,
    modelId: SEEDANCE_25,
    modeId: relation,
    values: {},
    slots: { reference_video: [asset] },
    prompt: `{{ref:${asset.id}}} `,
    ...(task.upstreamTaskId ? { derivedFrom: { taskId: task.id, upstreamTaskId: task.upstreamTaskId, modelId: task.modelId, createdAt: task.createdAt, relation } } : {}),
  };
}

/** 用尾帧继续：同模型、首帧模式，沿用原参数 */
export function continueFromLastFrame(task: TaskRecord, r: ResultRecord): FormInput | null {
  const found = getModel(task.modelId);
  if (!found || r.role !== 'last_frame') return null;
  const mode = found.model.modes.find((m) => m.entry !== 'derived' && m.slots.some((s) => s.id === 'first_frame') && !m.slots.some((s) => s.id === 'last_frame' && s.min > 0));
  if (!mode) return null;
  // 样片的尾帧接着做正式视频：不再沿用 draft 与它锁定的 480p
  const { draft, resolution, ...rest } = task.form.values;
  const values = draft === true ? rest : { ...rest, ...(resolution !== undefined ? { resolution } : {}) };
  return {
    providerId: found.provider.id,
    modelId: task.modelId,
    modeId: mode.id,
    values,
    slots: { first_frame: [resultAsAsset(task, r)] },
    prompt: '',
    ...(task.form.modelOverride ? { modelOverride: task.form.modelOverride } : {}),
  };
}
