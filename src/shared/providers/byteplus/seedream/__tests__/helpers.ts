import type { AssetRef, FormInput, MediaMeta, ModelDef, ResolvedAssets } from '../../../../catalog/types.js';
import { evaluate } from '../../../../engine/evaluate.js';
import { buildRequest } from '../../../../request/build.js';
import { byteplus } from '../../index.js';
import { SEEDREAM_MODELS } from '../index.js';

export const PRO = 'byteplus/seedream-5-0-pro';
export const FLASH = 'byteplus/seedream-5-0-flash';
export const LITE = 'byteplus/seedream-5-0-lite';
export const V45 = 'byteplus/seedream-4-5';
export const V40 = 'byteplus/seedream-4-0';
export const ALL = [PRO, FLASH, LITE, V45, V40];

export function model(id: string): ModelDef {
  const m = SEEDREAM_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`未知模型 ${id}`);
  return m;
}

export function form(id: string, over: Partial<FormInput> = {}): FormInput {
  return { providerId: 'byteplus', modelId: id, modeId: 'generate', values: {}, slots: {}, prompt: 'a cat', ...over };
}

/** URL 素材（默认没有元数据） */
export function urlImg(id: string, meta?: Partial<MediaMeta>): AssetRef {
  return { id, source: { type: 'url', url: `https://img.test/${id}.png` }, ...(meta ? { meta: { kind: 'image', ...meta } } : {}) };
}

/** 本地素材（带元数据） */
export function localImg(id: string, meta: Partial<MediaMeta> = {}): AssetRef {
  const mime = meta.mime ?? 'image/png';
  return { id, source: { type: 'local', assetId: `asset-${id}`, mime, bytes: 1000 }, meta: { kind: 'image', width: 1024, height: 1024, mime, bytes: 1000, ...meta } };
}

export const wireOf = (id: string): string => `data:image/png;base64,${id}`;

export function resolveAll(slots: Record<string, AssetRef[]>): ResolvedAssets {
  const out: ResolvedAssets = {};
  for (const list of Object.values(slots)) for (const a of list) out[a.id] = { wire: wireOf(a.id), preview: wireOf(a.id), bytes: 10 };
  return out;
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

export const issueIds = (r: { issues: { id: string }[] }): string[] => r.issues.map((i) => i.id);

export const many = (n: number, make: (id: string) => AssetRef = (id) => localImg(id)): AssetRef[] => Array.from({ length: n }, (_, i) => make(`r${i + 1}`));
