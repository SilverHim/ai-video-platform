import type { CostEstimate, EvalCtx, MediaMeta } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { isSizeValue } from '../../../engine/evaluate.js';
import { GROUP_TOTAL_LIMIT, type SeedreamKey, type SeedreamProfile } from './profile.js';
import { tierMaxPixels } from './sizes.js';

/** [≤ 261 万像素, > 261 万像素] 两档单价 */
type Tiered = [number, number];

interface Price {
  output: number | Tiered;
  /** 图层分解每张（底图与各图层分别计） */
  layer?: number | Tiered;
  /** 第 1 张输入图免费，之后每张 */
  extraInput?: number;
}

/** 官方标价（USD/张，model-pricing#c02be6ee）；内容审核等未成功输出的图不计费 */
export const PRICES: Record<SeedreamKey, Price> = {
  pro: { output: [0.045, 0.09], layer: [0.0225, 0.045], extraInput: 0.003 },
  // 未核实：flash 图层分解价格，文档只写统一价 0.018
  flash: { output: 0.018, layer: 0.018 },
  lite: { output: 0.035 },
  v45: { output: 0.04 },
  v40: { output: 0.03 },
};

/** 计价分档线：261 万像素（1.5K 及以下为低档） */
export const PRICE_TIER_PIXELS = 2_610_000;
/** 图层分解最多 1 张底图 + 16 个图层 */
export const LAYER_MAX_OUTPUTS = 17;
/** 图层分解 auto 档：原图像素在区间内按原尺寸，小于按 1K，大于按 2K */
const AUTO_RANGE: [number, number] = [921_600, 4_624_220];

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const usd = (n: number): string => `$${round6(n)}`;

/** 推导：按输出单张像素判断计价档；未知返回 null（按高档估） */
function outputPixels(p: SeedreamProfile, c: EvalCtx, input: MediaMeta | undefined): number | null {
  const v = c.effective.size;
  if (!isSizeValue(v)) return null;
  if (v.mode === 'custom') return v.width * v.height;
  if (v.value === 'auto') {
    if (input?.width === undefined || input.height === undefined) return null;
    const px = input.width * input.height;
    if (px < AUTO_RANGE[0]) return tierMaxPixels(p.size, '1K') ?? null;
    if (px > AUTO_RANGE[1]) return tierMaxPixels(p.size, '2K') ?? null;
    return px;
  }
  return tierMaxPixels(p.size, v.value) ?? null;
}

export function estimateSeedreamCost(p: SeedreamProfile, c: EvalCtx): CostEstimate | null {
  const price = PRICES[p.key];
  const refs = c.slots.image?.length ?? 0;
  const layer = c.mode.id === 'layer';
  const unitDef = layer ? price.layer : price.output;
  if (unitDef === undefined) return null;

  let unit: number;
  let tierNote: { zh: string; en: string } | null = null;
  let rough = false;
  if (typeof unitDef === 'number') unit = unitDef;
  else {
    const px = outputPixels(p, c, c.slots.image?.[0]?.meta);
    const high = px === null || px > PRICE_TIER_PIXELS;
    unit = high ? unitDef[1] : unitDef[0];
    if (px === null) rough = true;
    tierNote = px === null ? { zh: '尺寸未知，按高于 261 万像素档估', en: 'size unknown, priced at the > 2.61 MP tier' } : high ? { zh: '高于 261 万像素档', en: '> 2.61 MP tier' } : { zh: '不高于 261 万像素档', en: '≤ 2.61 MP tier' };
  }

  // 图层数、组图张数都由模型决定，只能按上限估（内核没有"上限"档，记为 rough）
  let count = 1;
  let countNote: { zh: string; en: string } | null = null;
  if (layer) {
    count = LAYER_MAX_OUTPUTS;
    rough = true;
    countNote =
      typeof unitDef === 'number'
        ? { zh: '最多 1 张底图 + 16 个图层，按上限估', en: 'up to 1 base + 16 layers, upper bound' }
        : { zh: '最多 1 张底图 + 16 个图层，按上限估；各层按自己的实际像素档分别计费，这里统一按底图档估', en: 'up to 1 base + 16 layers, upper bound; each layer is billed at its own pixel tier, estimated here at the base image tier' };
  } else if (c.mode.id === 'group') {
    const max = typeof c.effective.max_images === 'number' ? c.effective.max_images : GROUP_TOTAL_LIMIT;
    count = Math.max(1, Math.min(max, GROUP_TOTAL_LIMIT - refs));
    rough = true;
    countNote = { zh: '组图按上限估，按实际生成张数计费', en: 'group upper bound; billed per generated image' };
  }

  // 未核实：pro "第 2 张输入图起收费" 是否适用于图层分解（只有 1 张输入，不影响）
  const extraInputs = price.extraInput ? Math.max(0, refs - 1) : 0;
  const inputCost = extraInputs * (price.extraInput ?? 0);
  const amount = round6(unit * count + inputCost);

  const notes = [countNote, tierNote].filter((n): n is { zh: string; en: string } => n !== null);
  const zhNotes = notes.length ? `（${notes.map((n) => n.zh).join('；')}）` : '';
  const enNotes = notes.length ? ` (${notes.map((n) => n.en).join('; ')})` : '';
  const zhInput = extraInputs ? ` + 输入图 ${usd(price.extraInput!)}/张 × ${extraInputs}（第 1 张免费）` : '';
  const enInput = extraInputs ? ` + input ${usd(price.extraInput!)}/image × ${extraInputs} (first one free)` : '';
  return {
    amount,
    currency: 'USD',
    basis: T(`${usd(unit)}/张 × ${count}${zhNotes}${zhInput}`, `${usd(unit)}/image × ${count}${enNotes}${enInput}`),
    confidence: rough ? 'rough' : 'list-price',
  };
}
