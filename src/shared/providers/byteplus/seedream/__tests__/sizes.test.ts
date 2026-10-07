import { describe, expect, it } from 'vitest';
import { PROFILES } from '../profile.js';
import { RATIOS, SIZE_V40, customSizeOk, fitCustomSize, generateSizeSpec, sizeToWire, tierMaxPixels } from '../sizes.js';

describe('尺寸规则', () => {
  it('参考尺寸表：每档 8 种比例，且都落在该模型的自定义像素区间与宽高比内', () => {
    for (const p of PROFILES) {
      for (const tier of p.size.tiers) {
        const t = p.size.ref[tier]!;
        expect(Object.keys(t)).toEqual(RATIOS);
        for (const [w, h] of Object.values(t)) expect(customSizeOk(w, h, p.size.pixels)).toBe(true);
      }
    }
  });

  it('档位按模型', () => {
    const tiers = Object.fromEntries(PROFILES.map((p) => [p.key, generateSizeSpec(p.size).presets.map((x) => x.value)]));
    expect(tiers).toEqual({ pro: ['1K', '1.5K', '2K'], flash: ['1K', '1.5K', '2K'], lite: ['2K', '3K', '4K'], v45: ['2K', '4K'], v40: ['1K', '2K', '4K'] });
    expect(generateSizeSpec(SIZE_V40).presets[0]).toMatchObject({ value: '1K', px: [1024, 1024] });
  });

  it('自定义区间按模型', () => {
    const px = Object.fromEntries(PROFILES.map((p) => [p.key, p.size.pixels]));
    expect(px).toEqual({ pro: [921_600, 4_624_220], flash: [921_600, 4_624_220], lite: [3_686_400, 16_777_216], v45: [3_686_400, 16_777_216], v40: [921_600, 16_777_216] });
  });

  it('写入请求体', () => {
    expect(sizeToWire({ mode: 'preset', value: '1.5K' })).toEqual({ size: '1.5K' });
    expect(sizeToWire({ mode: 'custom', width: 3750, height: 1250 })).toEqual({ size: '3750x1250' });
  });

  it('fitCustomSize：结果总是合法', () => {
    for (const [w, h] of [[1, 1], [100, 2000], [9000, 9000], [3000, 10], [2048, 2048]] as const) {
      for (const p of PROFILES) {
        const fit = fitCustomSize(w, h, p.size.pixels);
        expect(fit && customSizeOk(fit.width, fit.height, p.size.pixels)).toBe(true);
      }
    }
    expect(fitCustomSize(0, 10, [1, 2])).toBeNull();
  });

  it('计价用的档位最大像素', () => {
    const pro = PROFILES[0]!;
    expect(tierMaxPixels(pro.size, '1.5K')).toBe(1792 * 1344);
    expect(tierMaxPixels(pro.size, '2K')! > 2_610_000).toBe(true);
    expect(tierMaxPixels(pro.size, '4K')).toBeUndefined();
  });
});
