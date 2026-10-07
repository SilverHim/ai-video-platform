import type { AssetRef, MediaSpec, SlotDef } from '../catalog/types.js';
import type { I18nText } from '../i18n.js';

/** 从 MIME 或文件名得到小写格式名（jpg→jpeg，quicktime→mov，mpeg 音频→mp3） */
export function formatOf(mimeOrName: string | undefined): string | undefined {
  if (!mimeOrName) return undefined;
  const s = mimeOrName.toLowerCase();
  if (s.includes('/')) {
    const sub = s.split('/')[1]!.split(';')[0]!.trim();
    if (sub === 'jpg') return 'jpeg';
    if (sub === 'quicktime') return 'mov';
    if (sub === 'mpeg' && s.startsWith('audio/')) return 'mp3';
    if (sub === 'x-wav' || sub === 'wave') return 'wav';
    if (sub === 'tif') return 'tiff';
    return sub;
  }
  const ext = s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
  if (ext === 'jpg') return 'jpeg';
  if (ext === 'tif') return 'tiff';
  return ext;
}

/** 格式名对应的 data URI MIME（文档要求格式名小写） */
export function dataUriMime(kind: 'image' | 'video' | 'audio', format: string): string {
  return `${kind}/${format.toLowerCase()}`;
}

/** base64 编码后的字节数 */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface MediaProblem {
  severity: 'error' | 'warn';
  message: I18nText;
}

const fmtRange = (r: [number, number]) => `[${r[0]}, ${r[1]}]`;

/** 按槽位规格校验单个素材；元数据缺失时给出"未校验"提示而不是报错 */
export function checkAsset(asset: AssetRef, slot: SlotDef): MediaProblem[] {
  const spec: MediaSpec = slot.spec;
  const out: MediaProblem[] = [];
  const src = asset.source;
  if (!slot.sources.includes(src.type)) {
    out.push({ severity: 'error', message: { zh: `该槽位不支持这种素材来源（${src.type}）`, en: `This slot does not accept source type "${src.type}"` } });
    return out;
  }
  const meta = asset.meta;
  const mime = meta?.mime ?? (src.type === 'local' ? src.mime : undefined);
  const format = formatOf(mime ?? (src.type === 'local' ? src.filename : undefined));
  if (format && !spec.formats.includes(format)) {
    out.push({ severity: 'error', message: { zh: `格式 ${format} 不受支持，可用：${spec.formats.join(', ')}`, en: `Format ${format} is not supported; allowed: ${spec.formats.join(', ')}` } });
  }
  const bytes = meta?.bytes ?? (src.type === 'local' ? src.bytes : undefined);
  if (bytes !== undefined && bytes > spec.maxBytes) {
    out.push({ severity: 'error', message: { zh: `文件 ${(bytes / 1048576).toFixed(1)} MB 超过上限 ${(spec.maxBytes / 1048576).toFixed(0)} MB`, en: `File is ${(bytes / 1048576).toFixed(1)} MB, limit ${(spec.maxBytes / 1048576).toFixed(0)} MB` } });
  }
  const { width: w, height: h } = meta ?? {};
  if (w !== undefined && h !== undefined) {
    if (spec.minSideExclusive !== undefined && (w <= spec.minSideExclusive || h <= spec.minSideExclusive)) {
      out.push({ severity: 'error', message: { zh: `宽和高都必须大于 ${spec.minSideExclusive}px（当前 ${w}×${h}）`, en: `Width and height must exceed ${spec.minSideExclusive}px (got ${w}×${h})` } });
    }
    if (spec.side && (w < spec.side[0] || h < spec.side[0] || w > spec.side[1] || h > spec.side[1])) {
      out.push({ severity: 'error', message: { zh: `宽高需在 ${fmtRange(spec.side)} px 内（当前 ${w}×${h}）`, en: `Width/height must be within ${fmtRange(spec.side)} px (got ${w}×${h})` } });
    }
    if (spec.pixels && (w * h < spec.pixels[0] || w * h > spec.pixels[1])) {
      out.push({ severity: 'error', message: { zh: `总像素需在 ${fmtRange(spec.pixels)} 内（当前 ${w * h}）`, en: `Total pixels must be within ${fmtRange(spec.pixels)} (got ${w * h})` } });
    }
    if (spec.aspect) {
      const r = w / h;
      if (r < spec.aspect[0] || r > spec.aspect[1]) {
        out.push({ severity: 'error', message: { zh: `宽高比需在 ${spec.aspect[0]}–${spec.aspect[1]} 之间（当前 ${r.toFixed(3)}）`, en: `Aspect ratio must be within ${spec.aspect[0]}–${spec.aspect[1]} (got ${r.toFixed(3)})` } });
      }
    }
  }
  if (spec.durationSec && meta?.durationSec !== undefined) {
    const d = meta.durationSec;
    if (d < spec.durationSec[0] || d > spec.durationSec[1]) {
      out.push({ severity: 'error', message: { zh: `时长需在 ${fmtRange(spec.durationSec)} 秒内（当前 ${d.toFixed(2)}s）`, en: `Duration must be within ${fmtRange(spec.durationSec)} s (got ${d.toFixed(2)}s)` } });
    }
  }
  if (spec.fps && meta?.fps !== undefined && (meta.fps < spec.fps[0] || meta.fps > spec.fps[1])) {
    out.push({ severity: 'error', message: { zh: `帧率需在 ${fmtRange(spec.fps)} 内（当前 ${meta.fps}）`, en: `FPS must be within ${fmtRange(spec.fps)} (got ${meta.fps})` } });
  }
  if (spec.requireAlpha && meta?.hasAlpha === false) {
    out.push({ severity: 'error', message: { zh: '需要带透明通道（alpha）的图片', en: 'An image with an alpha channel is required' } });
  }
  const verifiable = src.type === 'local' || src.type === 'task-output';
  // 音频没有宽高，只看时长
  const needsSize = slot.kind !== 'audio' && Boolean(spec.side || spec.pixels || spec.aspect || spec.minSideExclusive !== undefined);
  const missing = verifiable && ((needsSize && w === undefined) || (spec.durationSec && meta?.durationSec === undefined) || (spec.requireAlpha && meta?.hasAlpha === undefined));
  if (missing) {
    out.push({ severity: 'warn', message: { zh: '部分规格未能读取，提交前无法完全校验', en: 'Some properties could not be read; not fully validated' } });
  }
  return out;
}
