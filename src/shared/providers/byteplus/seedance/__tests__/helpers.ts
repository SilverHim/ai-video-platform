import type { AssetRef, AssetSource, DerivedFrom, FormInput, MediaMeta, ModelDef, ResolvedAssets } from '../../../../catalog/types.js';
import { evaluate } from '../../../../engine/evaluate.js';
import { buildRequest } from '../../../../request/build.js';
import { byteplus } from '../../index.js';
import { SEEDANCE_MODELS } from '../index.js';

export const V25 = 'byteplus/seedance-2-5';
export const V20 = 'byteplus/seedance-2-0';
export const V20F = 'byteplus/seedance-2-0-fast';
export const V20M = 'byteplus/seedance-2-0-mini';
export const V15 = 'byteplus/seedance-1-5-pro';
export const V10 = 'byteplus/seedance-1-0-pro';
export const V10F = 'byteplus/seedance-1-0-pro-fast';
export const ALL = [V25, V20, V20F, V20M, V15, V10, V10F];
export const V20S = [V20, V20F, V20M];
export const V1X = [V15, V10, V10F];

export function model(id: string): ModelDef {
  const m = SEEDANCE_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`未知模型 ${id}`);
  return m;
}

export function form(id: string, over: Partial<FormInput> = {}): FormInput {
  return { providerId: 'byteplus', modelId: id, modeId: 't2v', values: {}, slots: {}, prompt: 'a cat', ...over };
}

/** 本地图片（带元数据，1280×720 png） */
export function img(id: string, meta: Partial<MediaMeta> = {}): AssetRef {
  const mime = meta.mime ?? 'image/png';
  return { id, source: { type: 'local', assetId: `asset-${id}`, mime, bytes: 1000 }, meta: { kind: 'image', width: 1280, height: 720, mime, bytes: 1000, ...meta } };
}

/** URL 视频（默认 5 秒 1280×720 24fps mp4） */
export function vid(id: string, meta: Partial<MediaMeta> | null = {}, source?: AssetSource): AssetRef {
  return {
    id,
    source: source ?? { type: 'url', url: `https://media.test/${id}.mp4` },
    ...(meta ? { meta: { kind: 'video', mime: 'video/mp4', width: 1280, height: 720, fps: 24, durationSec: 5, ...meta } } : {}),
  };
}

/** URL 音频（默认 5 秒 mp3） */
export function aud(id: string, meta: Partial<MediaMeta> | null = {}): AssetRef {
  return { id, source: { type: 'url', url: `https://media.test/${id}.mp3` }, ...(meta ? { meta: { kind: 'audio', mime: 'audio/mpeg', durationSec: 5, ...meta } } : {}) };
}

export const wireOf = (id: string): string => `https://cdn.test/${id}`;

export function resolveAll(slots: Record<string, AssetRef[]>): ResolvedAssets {
  const out: ResolvedAssets = {};
  for (const list of Object.values(slots)) for (const a of list) out[a.id] = { wire: wireOf(a.id), preview: wireOf(a.id), bytes: 10 };
  return out;
}

export function draftFrom(id: string, over: Partial<DerivedFrom> = {}): DerivedFrom {
  return { taskId: 'local-draft-1', upstreamTaskId: 'cgt-draft-1', modelId: id, createdAt: Date.now() - 3600_000, relation: 'draft-final', ...over };
}

export function evalForm(id: string, over: Partial<FormInput> = {}) {
  return evaluate(byteplus, model(id), form(id, over));
}

export function run(id: string, over: Partial<FormInput> = {}, resolved?: ResolvedAssets) {
  const f = form(id, over);
  const ev = evaluate(byteplus, model(id), f);
  const built = buildRequest(byteplus, model(id), ev, resolved ?? resolveAll(f.slots), 'send');
  return { ev, built, body: built.body };
}

/** 只跑 wireGuard：在默认请求上用 rawOverrides 注入字段 */
export function guardIds(id: string, over: Partial<FormInput>): string[] {
  return run(id, over).built.issues.map((i) => i.id);
}

export const issueIds = (r: { issues: { id: string }[] }): string[] => r.issues.map((i) => i.id);
