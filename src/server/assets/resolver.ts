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
  /** 有必须公开上传才能提交的素材（本地视频）：不同意就不能提交 */
  required: boolean;
  target: { id: string; label: I18nText; ttlMs: number; maxBytes: number; homepage?: string };
  /** 同意后会公开上传的素材；optional：不同意时改为 base64 内联照常提交（只是请求体大、上传慢） */
  files: { name: string; bytes: number | null; optional?: boolean }[];
}

export interface ResolveOptions {
  providerId: string;
  /** 用户已同意把本地素材（BytePlus 的视频、图片）上传到公共临时托管站 */
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
 * - 本地图片 / 音频 → data URI（格式名小写）；BytePlus 的本地图片在同意公开上传时先传到临时托管站，只发链接
 *   （到 BytePlus 的单连接上行只有每秒一两百 KB，几 MB 的图内联要几十秒到几分钟）
 * - URL / asset:// / mm_file:// → 原样
 * - 历史结果 → 原始链接仍有效就直接用，否则用本地文件（规则同本地文件）
 * - 本地文件其实就是同一服务商以前的生成结果（哈希相同）、原始链接仍有效 → 直接用那条链接（不内联、不公开上传）
 * - 本地视频 → BytePlus 传到公共临时托管站（必须同意），MiniMax 用它自己的文件上传
 */
export class AssetResolver {
  private uploadCache = new Map<string, { url: string; expiresAt: number | null }>();
  /** 正在上传的文件（target:sha → 结果）：同一个文件同时出现在几个槽位时只传一次 */
  private uploading = new Map<string, Promise<ResolvedAsset>>();

  constructor(
    private readonly store: Store,
    private readonly assets: AssetStore,
    private readonly outputsRoot: string,
    private readonly targets: UploadTargets,
    private readonly now: () => number = Date.now,
  ) {}

  private remoteStillValid(s: Extract<AssetRef['source'], { type: 'task-output' }>): boolean {
    return Boolean(s.remoteUrl) && (s.remoteExpiresAt ?? 0) - this.now() > REMOTE_URL_MIN_REMAINING_MS;
  }

  /** 这个素材走公共托管：BytePlus 的视频一律如此，图片要用户同意 */
  private viaTempHost(slot: SlotDef, providerId: string, consent: boolean): boolean {
    if (this.targets.providerFiles[providerId]) return false;
    return slot.kind === 'video' || (slot.kind === 'image' && consent);
  }

  /** 以素材库里的记录为准（表单里带的 sha256 只是元数据，可能与实际文件不一致） */
  private shaOf(s: Extract<AssetRef['source'], { type: 'local' }>): string | undefined {
    return this.store.getAsset(s.assetId)?.sha256;
  }

  /** 本地素材与同一服务商的某条历史结果是同一个文件，且原始链接还够新：返回那条链接 */
  private reusableResult(sha256: string | undefined, providerId: string): ResolvedAsset | null {
    if (!sha256) return null;
    const r = this.store.findRemoteResultBySha(sha256, providerId, this.now() + REMOTE_URL_MIN_REMAINING_MS);
    return r ? { wire: r.remoteUrl, preview: r.remoteUrl, bytes: r.remoteUrl.length, expiresAt: r.remoteExpiresAt, reusedFrom: { taskId: r.taskId, index: r.index } } : null;
  }

  private tempHost(id?: string): UploadTarget {
    return this.targets.tempHosts[id ?? this.targets.defaultTempHost] ?? this.targets.tempHosts[this.targets.defaultTempHost]!;
  }

  /**
   * 哪些素材会上传到公共托管（只有 BytePlus：本地视频 / 图片，以及原链接已过期的历史视频 / 图片）。
   * 视频必须上传；图片是可选的，不同意就按 base64 内联
   */
  consentInfo(evaluated: EvaluatedForm, providerId: string, tempHost?: string): ConsentInfo {
    const target = this.tempHost(tempHost);
    const files: ConsentInfo['files'] = [];
    if (!this.targets.providerFiles[providerId]) {
      for (const { asset, slot } of items(evaluated)) {
        if (slot.kind !== 'video' && slot.kind !== 'image') continue;
        const optional = slot.kind === 'image' ? { optional: true } : {};
        const s = asset.source;
        if (s.type === 'local' && this.reusableResult(this.shaOf(s), providerId)) continue;
        if (s.type === 'local') files.push({ name: s.filename ?? s.assetId, bytes: s.bytes, ...optional });
        if (s.type === 'task-output' && !this.remoteStillValid(s)) files.push({ name: `task ${s.taskId.slice(0, 8)} #${s.index}`, bytes: asset.meta?.bytes ?? null, ...optional });
      }
    }
    return {
      required: files.some((f) => !f.optional),
      target: { id: target.id, label: target.label, ttlMs: target.ttlMs, maxBytes: target.maxBytes, ...(target.homepage ? { homepage: target.homepage } : {}) },
      files,
    };
  }

  /** 预览：不读文件，只估算。consent：是否已同意公开上传（BytePlus 的本地图片同意后才走托管） */
  preview(evaluated: EvaluatedForm, providerId = evaluated.ctx.provider.id, tempHost?: string, consent = false): ResolvedAssets {
    const out: ResolvedAssets = {};
    for (const { asset, slot } of items(evaluated)) out[asset.id] = this.previewOne(asset, slot, providerId, tempHost, consent);
    return out;
  }

  /**
   * 这个文件（按 sha256）在目标上已有、还够新的上传链接：素材库记录（stored）优先，其次进程内缓存。
   * 预览、提交、上传三处共用同一判断，执行超时才会一致
   */
  private cachedUpload(target: UploadTarget, sha256: string | null | undefined, stored?: { url: string; expiresAt: number | null }): ResolvedAsset | null {
    const fresh = (c: { url: string; expiresAt: number | null } | undefined): c is { url: string; expiresAt: number | null } =>
      Boolean(c) && (c!.expiresAt === null || c!.expiresAt - this.now() > (MIN_REMAINING_MS[target.kind] ?? 0));
    const memo = sha256 ? this.uploadCache.get(`${target.id}:${sha256}`) : undefined;
    const hit = fresh(stored) ? stored : fresh(memo) ? memo : null;
    return hit ? { wire: hit.url, preview: hit.url, bytes: hit.url.length, ...(hit.expiresAt ? { expiresAt: hit.expiresAt } : {}), uploadedVia: target.id } : null;
  }

  /** 预览里的上传占位：带上目标的保留时长，预览才能和提交时一样按链接寿命缩短 execution_expires_after */
  private uploadPlaceholder(providerId: string, tempHost?: string): ResolvedAsset {
    const pf = this.targets.providerFiles[providerId];
    const target = pf ?? this.tempHost(tempHost);
    const text = pf ? `${pf.id === 'minimax-files' ? 'mm_file://' : ''}<提交时上传到 ${pf.label.zh}>` : `<提交时上传到 ${target.label.zh}>`;
    return { wire: text, preview: text, bytes: 200, expiresAt: this.now() + target.ttlMs };
  }

  private previewOne(a: AssetRef, slot: SlotDef, providerId: string, tempHost: string | undefined, consent: boolean): ResolvedAsset {
    const s = a.source;
    switch (s.type) {
      case 'url':
        return { wire: s.url, preview: s.url, bytes: s.url.length };
      case 'provider-asset':
      case 'provider-file':
        return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
      case 'task-output':
        if (this.remoteStillValid(s)) return { wire: s.remoteUrl!, preview: s.remoteUrl!, bytes: s.remoteUrl!.length, expiresAt: s.remoteExpiresAt! };
        if (this.viaTempHost(slot, providerId, consent) || slot.kind === 'video') {
          // 结果文件之前传过、链接还够新：提交时会复用它（按库里记的结果哈希查）
          const cached = this.cachedUpload(this.targets.providerFiles[providerId] ?? this.tempHost(tempHost), this.store.resultSha256(s.taskId, s.index));
          return cached ?? this.uploadPlaceholder(providerId, tempHost);
        }
        return this.dataUriPreview(slot, s.mime ?? a.meta?.mime, a.meta?.bytes ?? 0);
      case 'local': {
        const reused = this.reusableResult(this.shaOf(s), providerId);
        if (reused) return reused;
        if (slot.kind === 'video' || this.viaTempHost(slot, providerId, consent) || (this.targets.providerFiles[providerId] && s.bytes > MINIMAX_INLINE_LIMIT)) {
          // 提交时会复用还够新的上传链接：预览也按它的真实寿命算，执行超时才和提交时一致
          const rec = this.store.getAsset(s.assetId);
          const target = this.targets.providerFiles[providerId] ?? this.tempHost(tempHost);
          const cached = rec ? this.cachedUpload(target, rec.sha256, rec.uploads[target.id]) : null;
          return cached ?? this.uploadPlaceholder(providerId, tempHost);
        }
        return this.dataUriPreview(slot, s.mime, s.bytes);
      }
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
    // 并行：每个要上传的文件各走一条连接（单连接上行慢时，并行能叠加带宽）。
    // 有一个失败也等其余的都结束再报错：否则剩下的上传会脱离任务的收尾（关闭服务时 drain 等不到它们）
    const list = items(evaluated);
    const settled = await Promise.allSettled(list.map(({ asset, slot }) => this.resolveOne(asset, slot, opts)));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
    return Object.fromEntries(list.map(({ asset }, i) => [asset.id, (settled[i] as PromiseFulfilledResult<ResolvedAsset>).value]));
  }

  private async resolveOne(a: AssetRef, slot: SlotDef, opts: ResolveOptions): Promise<ResolvedAsset> {
    const s = a.source;
    if (s.type === 'url') return { wire: s.url, preview: s.url, bytes: s.url.length };
    if (s.type === 'provider-asset' || s.type === 'provider-file') return { wire: s.uri, preview: s.uri, bytes: s.uri.length };
    const providerFiles = this.targets.providerFiles[opts.providerId];
    if (s.type === 'task-output') {
      if (this.remoteStillValid(s)) return { wire: s.remoteUrl!, preview: s.remoteUrl!, bytes: s.remoteUrl!.length, expiresAt: s.remoteExpiresAt! };
      const rec = this.store.listResults(s.taskId).find((r) => r.index === s.index && r.path);
      if (!rec?.path) throw new ResolveError({ zh: '找不到要复用的历史结果文件', en: 'The reused result file was not found' });
      const abs = join(this.outputsRoot, rec.path);
      if (slot.kind === 'video' || this.viaTempHost(slot, opts.providerId, Boolean(opts.publicUploadConsent))) {
        // 一律按文件当前内容算哈希来查上传缓存（库里记的哈希可能缺失，例如从 outputs 重建的；也可能已过时），
        // 并把实际哈希写回结果记录，之后预览才能按同一个哈希查到缓存
        const sha = createHash('sha256').update(await readFile(abs)).digest('hex');
        if (this.store.resultSha256(s.taskId, s.index) !== sha) this.store.setResultSha256(rec.id, sha);
        return this.uploadFile(abs, rec.path.split('/').pop() ?? (slot.kind === 'video' ? 'video.mp4' : 'image.png'), rec.mime ?? (slot.kind === 'video' ? 'video/mp4' : 'image/png'), providerFiles, opts, sha);
      }
      return this.encode(await readFile(abs), slot, rec.mime ?? undefined);
    }
    // local
    const rec = this.store.getAsset(s.assetId);
    if (!rec) throw new ResolveError({ zh: '素材不存在或已被清理，请重新添加', en: 'Asset not found; please add it again' });
    const reused = this.reusableResult(rec.sha256, opts.providerId);
    if (reused) return reused;
    if (slot.kind === 'video' || this.viaTempHost(slot, opts.providerId, Boolean(opts.publicUploadConsent)) || (providerFiles && rec.bytes > MINIMAX_INLINE_LIMIT)) {
      const target = providerFiles ?? this.tempHost(opts.tempHost);
      const cached = this.cachedUpload(target, rec.sha256, rec.uploads[target.id]);
      if (cached) return cached;
      const out = await this.uploadFile(this.assets.absPath(rec), rec.filename ?? `asset.${rec.path.split('.').pop()}`, rec.mime, providerFiles, opts, rec.sha256);
      // 与最新记录合并：同一素材可能同时在传到别的托管站（读和写之间没有 await，不会被插队）
      const latest = this.store.getAsset(rec.id)?.uploads ?? rec.uploads;
      this.store.setAssetUploads(rec.id, { ...latest, [target.id]: { url: out.wire, expiresAt: out.expiresAt ?? null } });
      return out;
    }
    return this.encode(await this.assets.readBytes(rec), slot, rec.mime);
  }

  private async uploadFile(absPath: string, filename: string, mime: string, providerFiles: UploadTarget | undefined, opts: ResolveOptions, sha256?: string): Promise<ResolvedAsset> {
    const target = providerFiles ?? this.tempHost(opts.tempHost);
    if (target.privacy === 'public-link' && !opts.publicUploadConsent) {
      throw new ResolveError({ zh: `本地视频需要上传到 ${target.label.zh} 才能提交，请先确认同意公开上传`, en: `Local videos must be uploaded to ${target.label.en}; please consent to the public upload first` }, 'CONSENT_REQUIRED');
    }
    const sha = sha256 ?? createHash('sha256').update(await readFile(absPath)).digest('hex');
    const key = `${target.id}:${sha}`;
    const running = this.uploading.get(key);
    if (running) return running;
    const job = this.uploadOnce(absPath, filename, mime, target, opts, sha);
    this.uploading.set(key, job);
    try {
      return await job;
    } finally {
      this.uploading.delete(key);
    }
  }

  private async uploadOnce(absPath: string, filename: string, mime: string, target: UploadTarget, opts: ResolveOptions, sha: string): Promise<ResolvedAsset> {
    const bytes = (await stat(absPath)).size;
    const cacheKey = `${target.id}:${sha}`;
    const cached = this.cachedUpload(target, sha);
    if (cached) return cached;
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
