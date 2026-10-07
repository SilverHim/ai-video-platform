import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetRef, EvaluatedForm, ResolvedAsset, ResolvedAssets, SlotDef } from '../../shared/catalog/types.js';
import { base64Size, dataUriMime, formatBytes, formatOf } from '../../shared/engine/media.js';
import type { I18nText } from '../../shared/i18n.js';
import type { Store } from '../store/store.js';
import type { AssetStore } from './asset-store.js';

/** 复用历史结果的原始链接时，至少要剩这么久才直接用 */
export const REMOTE_URL_MIN_REMAINING_MS = 3 * 60 * 60 * 1000;

export class ResolveError extends Error {
  constructor(readonly i18n: I18nText) {
    super(i18n.zh);
  }
}

interface SlotItem {
  asset: AssetRef;
  slot: SlotDef;
}

function items(evaluated: EvaluatedForm): SlotItem[] {
  const { mode, input } = evaluated.ctx;
  return mode.slots.flatMap((slot) => (input.slots[slot.id] ?? []).map((asset) => ({ asset, slot })));
}

/**
 * 把表单里的素材引用变成请求体里可发送的值。
 * - 本地图片 / 音频 → data URI（格式名小写）
 * - URL / asset:// / mm_file:// → 原样
 * - 历史结果 → 原始链接仍有效就直接用，否则用本地文件
 * - 本地视频 → 需要上传目标（P5 实现），暂时报错
 */
export class AssetResolver {
  constructor(
    private readonly store: Store,
    private readonly assets: AssetStore,
    private readonly outputsRoot: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** 预览：不读文件，只估算 */
  preview(evaluated: EvaluatedForm): ResolvedAssets {
    const out: ResolvedAssets = {};
    for (const { asset, slot } of items(evaluated)) out[asset.id] = this.previewOne(asset, slot);
    return out;
  }

  private previewOne(a: AssetRef, slot: SlotDef): ResolvedAsset {
    const s = a.source;
    switch (s.type) {
      case 'url':
        return { wire: s.url, preview: s.url, bytes: s.url.length };
      case 'provider-asset':
      case 'provider-file':
        return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
      case 'task-output':
        if (s.remoteUrl && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS) return { wire: s.remoteUrl, preview: s.remoteUrl, bytes: s.remoteUrl.length };
        return this.dataUriPreview(slot, s.mime ?? a.meta?.mime, a.meta?.bytes ?? 0);
      case 'local':
        if (slot.kind === 'video') return { wire: '<本地视频：提交时上传>', preview: '<本地视频：提交时上传>', bytes: 200 };
        return this.dataUriPreview(slot, s.mime, s.bytes);
    }
  }

  private dataUriPreview(slot: SlotDef, mime: string | undefined, bytes: number): ResolvedAsset {
    const format = formatOf(mime) ?? 'png';
    const prefix = `data:${dataUriMime(slot.kind, format)};base64,`;
    const preview = `${prefix}…(${formatBytes(bytes)})`;
    return { wire: preview, preview, bytes: prefix.length + base64Size(bytes) };
  }

  /** 提交：读文件、编码 */
  async resolve(evaluated: EvaluatedForm): Promise<ResolvedAssets> {
    const out: ResolvedAssets = {};
    for (const { asset, slot } of items(evaluated)) out[asset.id] = await this.resolveOne(asset, slot);
    return out;
  }

  private async resolveOne(a: AssetRef, slot: SlotDef): Promise<ResolvedAsset> {
    const s = a.source;
    if (s.type === 'url') return { wire: s.url, preview: s.url, bytes: s.url.length };
    if (s.type === 'provider-asset' || s.type === 'provider-file') return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
    if (s.type === 'task-output') {
      if (s.remoteUrl && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS) return { wire: s.remoteUrl, preview: s.remoteUrl, bytes: s.remoteUrl.length };
      const rec = this.store.listResults(s.taskId).find((r) => r.index === s.index && r.path);
      if (!rec?.path) throw new ResolveError({ zh: '找不到要复用的历史结果文件', en: 'The reused result file was not found' });
      if (slot.kind === 'video') throw new ResolveError({ zh: '复用的视频原始链接已过期，本地视频上传将在后续版本支持', en: 'The reused video link expired; local video upload comes in a later phase' });
      return this.encode(await readFile(join(this.outputsRoot, rec.path)), slot, rec.mime ?? undefined);
    }
    // local
    const rec = this.store.getAsset(s.assetId);
    if (!rec) throw new ResolveError({ zh: '素材不存在或已被清理，请重新添加', en: 'Asset not found; please add it again' });
    if (slot.kind === 'video') throw new ResolveError({ zh: '本地视频需要先上传到可公网访问的位置（后续版本支持），请先改填视频 URL', en: 'Local videos need a public upload target (coming later); use a video URL for now' });
    return this.encode(await this.assets.readBytes(rec), slot, rec.mime);
  }

  private encode(buf: Buffer, slot: SlotDef, mime: string | undefined): ResolvedAsset {
    const format = formatOf(mime) ?? 'png';
    const prefix = `data:${dataUriMime(slot.kind, format)};base64,`;
    const wire = prefix + buf.toString('base64');
    return { wire, preview: `${prefix}…(${formatBytes(buf.length)})`, bytes: wire.length };
  }
}
