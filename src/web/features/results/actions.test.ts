import { describe, expect, it } from 'vitest';
import type { FormInput, ResolvedAssets } from '../../../shared/catalog/types';
import { evaluate } from '../../../shared/engine/evaluate';
import { getModel } from '../../../shared/providers/registry';
import { buildRequest } from '../../../shared/request/build';
import type { ResultRecord, TaskRecord } from '../../../shared/task/records';
import { continueFromLastFrame, draftFinalForm, editExtendForm } from './actions';

const NOW = Date.now();

function task(modelId: string, values: FormInput['values'], request: Record<string, unknown>): TaskRecord {
  const providerId = modelId.split('/')[0]!;
  return {
    id: 'local-1',
    createdAt: NOW,
    updatedAt: NOW,
    providerId,
    modelId,
    modeId: 't2v',
    status: 'succeeded',
    upstreamTaskId: 'cgt-123',
    form: { providerId, modelId, modeId: 't2v', values, slots: {}, prompt: 'a cat' },
    request,
    results: [],
  } as unknown as TaskRecord;
}

const video: ResultRecord = {
  id: 'r1',
  taskId: 'local-1',
  index: 0,
  role: 'video',
  kind: 'video',
  path: '2026-10-08/x/video.mp4',
  mime: 'video/mp4',
  bytes: 1000,
  width: 864,
  height: 480,
  remoteUrl: 'https://example.com/a.mp4',
  remoteExpiresAt: NOW + 86_400_000,
  layer: null,
};
const lastFrame: ResultRecord = { ...video, id: 'r2', index: 1, role: 'last_frame', kind: 'image', mime: 'image/png' };

function body(form: FormInput) {
  const found = getModel(form.modelId)!;
  const ev = evaluate(found.provider, found.model, form);
  const resolved: ResolvedAssets = {};
  for (const list of Object.values(form.slots)) for (const a of list) resolved[a.id] = { wire: 'https://example.com/x', preview: 'x', bytes: 10 };
  return { ev, body: buildRequest(found.provider, found.model, ev, resolved, 'preview').body as Record<string, unknown> };
}

describe('结果卡片的派生入口', () => {
  const draftValues = { draft: true, resolution: '480p', duration: 5, ratio: '16:9', seed: 7, generate_audio: true };

  it('样片 → 正片：只发 draft_task 与可重设字段', () => {
    const form = draftFinalForm(task('byteplus/seedance-1-5-pro', draftValues, { draft: true }))!;
    expect(form.modeId).toBe('draft_final');
    expect(form.derivedFrom).toMatchObject({ relation: 'draft-final', upstreamTaskId: 'cgt-123' });
    const { ev, body: b } = body(form);
    expect(ev.canSubmit).toBe(true);
    expect(b.content).toEqual([{ type: 'draft_task', draft_task: { id: 'cgt-123' } }]);
    for (const k of ['draft', 'duration', 'ratio', 'seed', 'generate_audio']) expect(b).not.toHaveProperty(k);
  });

  it('非样片任务、不支持样片的模型没有正片入口', () => {
    expect(draftFinalForm(task('byteplus/seedance-1-5-pro', {}, {}))).toBeNull();
    expect(draftFinalForm(task('byteplus/seedance-1-0-pro', draftValues, { draft: true }))).toBeNull();
  });

  it('编辑 / 延长：进入 Seedance 2.5，参考视频用历史结果', () => {
    for (const relation of ['edit', 'extend'] as const) {
      const form = editExtendForm(task('minimax/h3', {}, {}), video, relation)!;
      expect(form).toMatchObject({ modelId: 'byteplus/seedance-2-5', modeId: relation, derivedFrom: { relation } });
      expect(form.slots.reference_video?.[0]?.source).toMatchObject({ type: 'task-output', taskId: 'local-1', remoteUrl: video.remoteUrl });
      const { ev, body: b } = body(form);
      expect(ev.canSubmit).toBe(true);
      expect(b).toMatchObject({ omni_reference_task_type: relation, ratio: 'adaptive', duration: -1 });
    }
    expect(editExtendForm(task('minimax/h3', {}, {}), lastFrame, 'edit')).toBeNull();
  });

  it('用尾帧继续：同模型首帧模式，不沿用样片的 draft / 480p', () => {
    const form = continueFromLastFrame(task('byteplus/seedance-1-5-pro', draftValues, { draft: true }), lastFrame)!;
    expect(form.modeId).toBe('i2v_first');
    expect(form.slots.first_frame).toHaveLength(1);
    expect(form.values).not.toHaveProperty('draft');
    expect(form.values).not.toHaveProperty('resolution');
    expect(body(form).body).not.toHaveProperty('draft');

    const h3 = continueFromLastFrame(task('minimax/h3', { resolution: '768P', duration: 6 }, {}), lastFrame)!;
    expect(h3).toMatchObject({ modelId: 'minimax/h3', modeId: 'i2v', values: { resolution: '768P' } });
    expect(continueFromLastFrame(task('minimax/h3', {}, {}), video)).toBeNull();
  });
});
