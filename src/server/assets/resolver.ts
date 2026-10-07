import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetRef, EvaluatedForm, ResolvedAsset, ResolvedAssets, SlotDef } from '../../shared/catalog/types.js';
import { base64Size, dataUriMime, formatBytes, formatOf } from '../../shared/engine/media.js';
import type { I18nText } from '../../shared/i18n.js';
import { sniff } from '../media/sniff.js';
import type { Store } from '../store/store.js';
import type { UploadTargets } from '../upload-targets/registry.js';
import { UploadError, type UploadTarget } from '../upload-targets/types.js';
import type { AssetStore } from './asset-store.js';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

/** 复用历史结果的原始链接时，至少要剩这么久才直接用 */
export const REMOTE_URL_MIN_REMAINING_MS = 3 * 60 * 60 * 1000;

export class ResolveError extends Error {
  constructor(
    readonly i18n: I18nText,
    readonly code = 'ASSET_RESOLVE_FAILED',
  ) {
    super(i18n.zh);
  }
}

/** 素材上传到公共托管前需要用户同意 */
export interface ConsentInfo {
  required: boolean;
  target: { id: string; label: I18nText; ttlMs: number; maxBytes: number; homepage?: string };
  files: { name: string; bytes: number | null }[];
}

export interface ResolveOptions {
  providerId: string;
  /** 用户已同意把本地视频上传到公共临时托管站 */
  publicUploadConsent?: boolean;
  /** 选用的临时托管站（uguu / tmpfiles） */
  tempHost?: string;
  providerKey?: string;
  signal?: AbortSignal;
}

/** 复用上传结果时至少要剩这么久 */
const MIN_REMAINING_MS: Record<string, number> = { 'temp-host': 60 * 60_000, 'provider-files': 24 * 3600_000 };
/** MiniMax 本地图片 / 音频超过这个大小改走文件上传，避免请求体过大 */
const MINIMAX_INLINE_LIMIT = 10 * 1024 * 1024;

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
  private uploadCache = new Map<string, { url: string; expiresAt: number | null }>();

  constructor(
    private readonly store: Store,
    private readonly assets: AssetStore,
    private readonly outputsRoot: string,
    private readonly targets: UploadTargets,
    private readonly now: () => number = Date.now,
  ) {}

  private tempHost(id?: string): UploadTarget {
    return this.targets.tempHosts[id ?? this.targets.defaultTempHost] ?? this.targets.tempHosts[this.targets.defaultTempHost]!;
  }

  /** 哪些素材需要上传到公共托管（只有 BytePlus 的本地视频 / 原链接已过期的历史视频） */
  consentInfo(evaluated: EvaluatedForm, providerId: string, tempHost?: string): ConsentInfo {
    const target = this.tempHost(tempHost);
    const files: ConsentInfo['files'] = [];
    if (!this.targets.providerFiles[providerId]) {
      for (const { asset, slot } of items(evaluated)) {
        if (slot.kind !== 'video') continue;
        const s = asset.source;
        if (s.type === 'local') files.push({ name: s.filename ?? s.assetId, bytes: s.bytes });
        if (s.type === 'task-output' && !(s.remoteUrl && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS)) files.push({ name: `task ${s.taskId.slice(0, 8)} #${s.index}`, bytes: asset.meta?.bytes ?? null });
      }
    }
    return {
      required: files.length > 0,
      target: { id: target.id, label: target.label, ttlMs: target.ttlMs, maxBytes: target.maxBytes, ...(target.homepage ? { homepage: target.homepage } : {}) },
      files,
    };
  }

  /** 预览：不读文件，只估算 */
  preview(evaluated: EvaluatedForm, providerId = evaluated.ctx.provider.id, tempHost?: string): ResolvedAssets {
    const out: ResolvedAssets = {};
    for (const { asset, slot } of items(evaluated)) out[asset.id] = this.previewOne(asset, slot, providerId, tempHost);
    return out;
  }

  private uploadPlaceholder(providerId: string, tempHost?: string): ResolvedAsset {
    const pf = this.targets.providerFiles[providerId];
    const text = pf ? `${pf.id === 'minimax-files' ? 'mm_file://' : ''}<提交时上传到 ${pf.label.zh}>` : `<提交时上传到 ${this.tempHost(tempHost).label.zh}>`;
    return { wire: text, preview: text, bytes: 200 };
  }

  private previewOne(a: AssetRef, slot: SlotDef, providerId: string, tempHost?: string): ResolvedAsset {
    const s = a.source;
    switch (s.type) {
      case 'url':
        return { wire: s.url, preview: s.url, bytes: s.url.length };
      case 'provider-asset':
      case 'provider-file':
        return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
      case 'task-output':
        if (s.remoteUrl && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS) return { wire: s.remoteUrl, preview: s.remoteUrl, bytes: s.remoteUrl.length };
        if (slot.kind === 'video') return this.uploadPlaceholder(providerId, tempHost);
        return this.dataUriPreview(slot, s.mime ?? a.meta?.mime, a.meta?.bytes ?? 0);
      case 'local':
        if (slot.kind === 'video' || (this.targets.providerFiles[providerId] && s.bytes > MINIMAX_INLINE_LIMIT)) return this.uploadPlaceholder(providerId, tempHost);
        return this.dataUriPreview(slot, s.mime, s.bytes);
    }
  }

  private dataUriPreview(slot: SlotDef, mime: string | undefined, bytes: number): ResolvedAsset {
    const format = formatOf(mime) ?? 'png';
    const prefix = `data:${dataUriMime(slot.kind, format)};base64,`;
    const preview = `${prefix}…(${formatBytes(bytes)})`;
    return { wire: preview, preview, bytes: prefix.length + base64Size(bytes) };
  }

  /** 提交：读文件、编码、按需上传 */
  async resolve(evaluated: EvaluatedForm, opts: ResolveOptions = { providerId: evaluated.ctx.provider.id }): Promise<ResolvedAssets> {
    const out: ResolvedAssets = {};
    for (const { asset, slot } of items(evaluated)) out[asset.id] = await this.resolveOne(asset, slot, opts);
    return out;
  }

  private async resolveOne(a: AssetRef, slot: SlotDef, opts: ResolveOptions): Promise<ResolvedAsset> {
    const s = a.source;
    if (s.type === 'url') return { wire: s.url, preview: s.url, bytes: s.url.length };
    if (s.type === 'provider-asset' || s.type === 'provider-file') return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
    const providerFiles = this.targets.providerFiles[opts.providerId];
    if (s.type === 'task-output') {
      if (s.remoteUrl && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS) return { wire: s.remoteUrl, preview: s.remoteUrl, bytes: s.remoteUrl.length };
      const rec = this.store.listResults(s.taskId).find((r) => r.index === s.index && r.path);
      if (!rec?.path) throw new ResolveError({ zh: '找不到要复用的历史结果文件', en: 'The reused result file was not found' });
      const abs = join(this.outputsRoot, rec.path);
      if (slot.kind === 'video') return this.uploadFile(abs, rec.path.split('/').pop() ?? 'video.mp4', rec.mime ?? 'video/mp4', providerFiles, opts);
      return this.encode(await readFile(abs), slot, rec.mime ?? undefined);
    }
    // local
    const rec = this.store.getAsset(s.assetId);
    if (!rec) throw new ResolveError({ zh: '素材不存在或已被清理，请重新添加', en: 'Asset not found; please add it again' });
    if (slot.kind === 'video' || (providerFiles && rec.bytes > MINIMAX_INLINE_LIMIT)) {
      const target = providerFiles ?? this.tempHost(opts.tempHost);
      const cached = rec.uploads[target.id];
      if (cached && (cached.expiresAt === null || cached.expiresAt - this.now() > (MIN_REMAINING_MS[target.kind] ?? 0))) {
        return { wire: cached.url, preview: cached.url, bytes: cached.url.length, ...(cached.expiresAt ? { expiresAt: cached.expiresAt } : {}), uploadedVia: target.id };
      }
      const out = await this.uploadFile(this.assets.absPath(rec), rec.filename ?? `asset.${rec.path.split('.').pop()}`, rec.mime, providerFiles, opts, rec.sha256);
      this.store.setAssetUploads(rec.id, { ...rec.uploads, [target.id]: { url: out.wire, expiresAt: out.expiresAt ?? null } });
      return out;
    }
    return this.encode(await this.assets.readBytes(rec), slot, rec.mime);
  }

  private async uploadFile(absPath: string, filename: string, mime: string, providerFiles: UploadTarget | undefined, opts: ResolveOptions, sha256?: string): Promise<ResolvedAsset> {
    const target = providerFiles ?? this.tempHost(opts.tempHost);
    if (target.privacy === 'public-link' && !opts.publicUploadConsent) {
      throw new ResolveError({ zh: `本地视频需要上传到 ${target.label.zh} 才能提交，请先确认同意公开上传`, en: `Local videos must be uploaded to ${target.label.en}; please consent to the public upload first` }, 'CONSENT_REQUIRED');
    }
    const bytes = (await stat(absPath)).size;
    const sha = sha256 ?? createHash('sha256').update(await readFile(absPath)).digest('hex');
    const cacheKey = `${target.id}:${sha}`;
    const cached = this.uploadCache.get(cacheKey);
    if (cached && (cached.expiresAt === null || cached.expiresAt - this.now() > (MIN_REMAINING_MS[target.kind] ?? 0))) {
      return { wire: cached.url, preview: cached.url, bytes: cached.url.length, ...(cached.expiresAt ? { expiresAt: cached.expiresAt } : {}), uploadedVia: target.id };
    }
    const realMime = mime && mime !== 'application/octet-stream' ? mime : sniff(await readFile(absPath).then((b) => b.subarray(0, 4096))).mime;
    try {
      const r = await target.upload({ path: absPath, bytes, sha256: sha, mime: realMime, filename }, { ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.providerKey ? { providerKey: opts.providerKey } : {}) });
      this.uploadCache.set(cacheKey, { url: r.url, expiresAt: r.expiresAt });
      return { wire: r.url, preview: r.url, bytes: r.url.length, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}), uploadedVia: target.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResolveError({ zh: `素材上传失败：${msg}`, en: `Asset upload failed: ${msg}` }, err instanceof UploadError ? `UPLOAD_${err.code}` : 'UPLOAD_FAILED');
    }
  }

  private encode(buf: Buffer, slot: SlotDef, mime: string | undefined): ResolvedAsset {
    const format = formatOf(mime) ?? 'png';
    const prefix = `data:${dataUriMime(slot.kind, format)};base64,`;
    const wire = prefix + buf.toString('base64');
    return { wire, preview: `${prefix}…(${formatBytes(buf.length)})`, bytes: wire.length };
  }
}
