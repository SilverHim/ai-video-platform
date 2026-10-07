import type { AssetRef, FormInput, MediaKind, MediaMeta, ModelDef, ResolvedAssets } from '../../../../catalog/types.js';
import { evaluate } from '../../../../engine/evaluate.js';
import { buildRequest } from '../../../../request/build.js';
import { minimax } from '../../index.js';
import { H3_ID, H3_MAX_ID, H3_MODELS } from '../index.js';

export const H3 = H3_ID;
export const MAX = H3_MAX_ID;
export const ALL = [H3, MAX];

export function model(id: string): ModelDef {
  const m = H3_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`未知模型 ${id}`);
  return m;
}

export function form(id: string, over: Partial<FormInput> = {}): FormInput {
  return { providerId: 'minimax', modelId: id, modeId: 't2v', values: {}, slots: {}, prompt: 'a cat', ...over };
}

const MIME: Record<MediaKind, string> = { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' };

/** URL 素材（默认只带 kind 与 mime） */
export function url(id: string, kind: MediaKind = 'image', meta: Partial<MediaMeta> = {}): AssetRef {
  return { id, source: { type: 'url', url: `https://media.test/${id}` }, meta: { kind, mime: MIME[kind], ...meta } };
}
export const img = (id: string, meta: Partial<MediaMeta> = {}): AssetRef => url(id, 'image', { width: 1280, height: 720, ...meta });
export const vid = (id: string, durationSec?: number, meta: Partial<MediaMeta> = {}): AssetRef => url(id, 'video', { ...(durationSec !== undefined ? { durationSec } : {}), ...meta });
export const aud = (id: string, durationSec?: number, meta: Partial<MediaMeta> = {}): AssetRef => url(id, 'audio', { ...(durationSec !== undefined ? { durationSec } : {}), ...meta });

/** 本地图片（带完整元数据） */
export function localImg(id: string, meta: Partial<MediaMeta> = {}): AssetRef {
  const mime = meta.mime ?? 'image/png';
  const bytes = meta.bytes ?? 1000;
  return { id, source: { type: 'local', assetId: `asset-${id}`, mime, bytes }, meta: { kind: 'image', width: 1280, height: 720, mime, bytes, ...meta } };
}

/** mm_file:// 服务商文件 */
export function mmFile(id: string, expiresAt?: number, uri = `mm_file://${id}`): AssetRef {
  return { id, source: { type: 'provider-file', uri, ...(expiresAt !== undefined ? { expiresAt } : {}) } };
}

export const wireOf = (id: string): string => `https://wire.test/${id}`;

export function resolveAll(slots: Record<string, AssetRef[]>): ResolvedAssets {
  const out: ResolvedAssets = {};
  for (const list of Object.values(slots)) for (const a of list) out[a.id] = { wire: wireOf(a.id), preview: wireOf(a.id), bytes: 10 };
  return out;
}

export function evalForm(id: string, over: Partial<FormInput> = {}) {
  return evaluate(minimax, model(id), form(id, over));
}

export function run(id: string, over: Partial<FormInput> = {}, resolved?: ResolvedAssets) {
  const f = form(id, over);
  const ev = evaluate(minimax, model(id), f);
  const built = buildRequest(minimax, model(id), ev, resolved ?? resolveAll(f.slots), 'send');
  return { ev, built, body: built.body };
}

export const issueIds = (r: { issues: { id: string }[] }): string[] => r.issues.map((i) => i.id);
export const guardIds = (r: ReturnType<typeof run>): string[] => r.built.issues.map((i) => i.id);

export const many = (n: number, make: (id: string) => AssetRef, prefix = 'x'): AssetRef[] => Array.from({ length: n }, (_, i) => make(`${prefix}${i + 1}`));
