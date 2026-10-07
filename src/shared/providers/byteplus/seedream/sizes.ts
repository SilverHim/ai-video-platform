import type { SizeSpec, SizeValue } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';

/** 档位写法的分辨率档 */
export type Tier = '1K' | '1.5K' | '2K' | '3K' | '4K';
export type Ratio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9';
export type Px = [number, number];
export type RatioTable = Record<Ratio, Px>;

export const RATIOS: Ratio[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];

/** 宽高比 w/h 闭区间（自定义像素、输入图通用） */
export const ASPECT_RANGE: [number, number] = [1 / 16, 16];

/** 按 RATIOS 顺序解析 "宽x高 宽x高 …" */
function table(list: string): RatioTable {
  const px = list.split(/\s+/).map((s) => s.split('x').map(Number) as Px);
  if (px.length !== RATIOS.length) throw new Error(`参考尺寸表需要 ${RATIOS.length} 项`);
  return Object.fromEntries(RATIOS.map((r, i) => [r, px[i]!])) as RatioTable;
}

/*
 * 参考宽高：官方常见比例示例，原文 "not limited to these standard values"。
 * 官方样例里 pro 2K 返回 1760x2368、lite 2K 返回 2720x1536，实际尺寸以响应 data[].size 为准。
 */
export const REF_PRO_FLASH: Partial<Record<Tier, RatioTable>> = {
  '1K': table('1024x1024 1152x864 864x1152 1424x800 800x1424 1248x832 832x1248 1568x672'),
  '1.5K': table('1536x1536 1792x1344 1344x1792 2048x1152 1152x2048 1872x1248 1248x1872 2352x1008'),
  '2K': table('2048x2048 2368x1776 1776x2368 2816x1584 1584x2816 2496x1664 1664x2496 3136x1344'),
};

const STD_2K = table('2048x2048 2304x1728 1728x2304 2848x1600 1600x2848 2496x1664 1664x2496 3136x1344');
const STD_3K = table('3072x3072 3456x2592 2592x3456 4096x2304 2304x4096 3744x2496 2496x3744 4704x2016');
const STD_4K = table('4096x4096 4704x3520 3520x4704 5504x3040 3040x5504 4992x3328 3328x4992 6240x2656');
// 文档冲突：4.0 的 1K 档 16:9 / 9:16 / 21:9，API 文档为 1280x720 / 720x1280 / 1512x648，教程为 1312x736 / 736x1312 / 1568x672；取 API 文档
const V40_1K = table('1024x1024 1152x864 864x1152 1280x720 720x1280 1248x832 832x1248 1512x648');

export interface SizeRule {
  tiers: Tier[];
  /** 显式发送的默认档位 */
  defaultTier: Tier;
  /** 自定义 宽x高 时单张总像素闭区间 */
  pixels: [number, number];
  ref: Partial<Record<Tier, RatioTable>>;
}

// 文档冲突：pro 不传 size 时 [A][D] 写默认 2K、[C] 像素表写 1024x1024；这里总是显式发送 size，不依赖服务端默认
export const SIZE_PRO_FLASH: SizeRule = { tiers: ['1K', '1.5K', '2K'], defaultTier: '2K', pixels: [921_600, 4_624_220], ref: REF_PRO_FLASH };
// 未核实：lite/4.5/4.0 档位写法的默认值文档未说明（像素写法默认 2048x2048），显式发送同级的 2K
export const SIZE_LITE: SizeRule = { tiers: ['2K', '3K', '4K'], defaultTier: '2K', pixels: [3_686_400, 16_777_216], ref: { '2K': STD_2K, '3K': STD_3K, '4K': STD_4K } };
export const SIZE_V45: SizeRule = { tiers: ['2K', '4K'], defaultTier: '2K', pixels: [3_686_400, 16_777_216], ref: { '2K': STD_2K, '4K': STD_4K } };
export const SIZE_V40: SizeRule = { tiers: ['1K', '2K', '4K'], defaultTier: '2K', pixels: [921_600, 16_777_216], ref: { '1K': V40_1K, '2K': STD_2K, '4K': STD_4K } };

/** 图层分解：只支持档位与 auto，默认 auto（pro / flash） */
export const LAYER_TIERS = ['1K', '1.5K', '2K', 'auto'] as const;
export const LAYER_DEFAULT = 'auto';

export function sizeToWire(v: SizeValue): Record<string, unknown> {
  return { size: v.mode === 'preset' ? v.value : `${v.width}x${v.height}` };
}

export function customSizeOk(w: number, h: number, [min, max]: [number, number]): boolean {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return false;
  const px = w * h;
  const r = w / h;
  return px >= min && px <= max && r >= ASPECT_RANGE[0] && r <= ASPECT_RANGE[1];
}

/** 把非法自定义尺寸收进区间（保持宽高比、比例越界时夹到边界）；取整后仍不合法返回 null */
export function fitCustomSize(w: number, h: number, pixels: [number, number]): { width: number; height: number } | null {
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const [min, max] = pixels;
  const r = Math.min(ASPECT_RANGE[1], Math.max(ASPECT_RANGE[0], w / h));
  const px = Math.min(max, Math.max(min, w * h));
  // 放大时向上取整、缩小时向下取整，保证落在区间内侧
  const round = w * h < min ? Math.ceil : w * h > max ? Math.floor : Math.round;
  const out = { width: round(Math.sqrt(px * r)), height: round(Math.sqrt(px / r)) };
  return customSizeOk(out.width, out.height, pixels) ? out : null;
}

/** 档位参考尺寸里的最大总像素（用于计价档判断） */
export function tierMaxPixels(rule: SizeRule, tier: string): number | undefined {
  const t = rule.ref[tier as Tier];
  return t ? Math.max(...Object.values(t).map(([w, h]) => w * h)) : undefined;
}

export const fmtInt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 生成场景：档位或自定义 宽x高 */
export function generateSizeSpec(rule: SizeRule): SizeSpec {
  return {
    presets: rule.tiers.map((t) => {
      const px = rule.ref[t]?.['1:1'];
      return { value: t, label: T(t, t), ...(px ? { px } : {}) };
    }),
    custom: { minPixels: rule.pixels[0], maxPixels: rule.pixels[1], aspect: ASPECT_RANGE },
    toWire: sizeToWire,
  };
}

/** 图层分解场景：只能选档位 */
export function layerSizeSpec(rule: SizeRule): SizeSpec {
  return {
    presets: LAYER_TIERS.map((t) => {
      if (t === 'auto') return { value: t, label: T('自动（按原图尺寸）', 'Auto (from input size)') };
      const px = rule.ref[t]?.['1:1'];
      return { value: t, label: T(t, t), ...(px ? { px } : {}) };
    }),
    toWire: sizeToWire,
  };
}
