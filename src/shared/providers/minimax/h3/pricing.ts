/** MiniMax V2 视频的费用估算（pricing-paygo 按量标价） */
import type { CostEstimate, EvalCtx } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import type { I18nText } from '../../../i18n.js';
import { REF_TOTAL_SEC, SLOT_REF_VIDEO, type H3Profile } from './profile.js';

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const usd = (n: number): string => `$${round6(n)}`;

/**
 * 输出：单价（按分辨率）× duration 秒。
 * 输入：图片超出免费张数后按张计（首帧、尾帧、参考图都算）；参考视频按输入秒数 × 输出分辨率单价；音频免费。
 * 未核实：参考视频秒数是否取整计费；被审核拦截的任务是否计费。
 */
export function estimateH3Cost(p: H3Profile, c: EvalCtx): CostEstimate | null {
  const resolution = c.effective.resolution;
  const duration = c.effective.duration;
  if (typeof resolution !== 'string' || typeof duration !== 'number') return null;
  const unit = p.price.output[resolution];
  if (unit === undefined) return null;

  let rough = false;
  const parts: { zh: string; en: string }[] = [{ zh: `${usd(unit)}/秒 × ${duration} 秒（${resolution}）`, en: `${usd(unit)}/s × ${duration} s (${resolution})` }];
  let amount = unit * duration;

  const images = c.mode.slots.filter((s) => s.kind === 'image').reduce((n, s) => n + (c.slots[s.id]?.length ?? 0), 0);
  const extraImages = Math.max(0, images - p.price.freeImages);
  if (extraImages) {
    amount += extraImages * p.price.extraImage;
    parts.push({
      zh: `输入图 ${usd(p.price.extraImage)}/张 × ${extraImages}（前 ${p.price.freeImages} 张免费）`,
      en: `input images ${usd(p.price.extraImage)}/image × ${extraImages} (first ${p.price.freeImages} free)`,
    });
  }

  const videos = c.mode.slots.some((s) => s.id === SLOT_REF_VIDEO) ? (c.slots[SLOT_REF_VIDEO] ?? []) : [];
  const videoUnit = p.price.refVideo[resolution];
  if (videos.length && videoUnit !== undefined) {
    const unknown = videos.some((a) => a.meta?.durationSec === undefined);
    // 时长未知时按总时长上限 15 秒估，记为 rough（与 Seedream 按上限估的口径一致）
    const sec = unknown ? REF_TOTAL_SEC : videos.reduce((s, a) => s + (a.meta?.durationSec ?? 0), 0);
    if (unknown) rough = true;
    amount += videoUnit * sec;
    // 秒数是否取整未核实（见上）：按实际秒数估，非整数时在说明里注明
    const note: I18nText = unknown
      ? { zh: '，时长未知按上限估', en: ', duration unknown, upper bound' }
      : Number.isInteger(round6(sec))
        ? { zh: '', en: '' }
        : { zh: '，是否按整秒取整计费未说明', en: ', rounding to whole seconds not documented' };
    parts.push({ zh: `参考视频 ${usd(videoUnit)}/秒 × ${round6(sec)} 秒${note.zh}`, en: `reference video ${usd(videoUnit)}/s × ${round6(sec)} s${note.en}` });
  }

  return {
    amount: round6(amount),
    currency: 'USD',
    basis: T(parts.map((x) => x.zh).join(' + '), parts.map((x) => x.en).join(' + ')),
    confidence: rough ? 'rough' : 'list-price',
  };
}
