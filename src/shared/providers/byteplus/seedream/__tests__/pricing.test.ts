import { describe, expect, it } from 'vitest';
import type { FormInput } from '../../../../catalog/types.js';
import { FLASH, LITE, PRO, V40, V45, evalForm, localImg, many, model, urlImg } from './helpers.js';

const cost = (id: string, over: Partial<FormInput> = {}) => model(id).estimateCost!(evalForm(id, over).ctx);
const custom = (width: number, height: number) => ({ size: { mode: 'custom', width, height } });

describe('estimateCost：官方标价 × 预计张数', () => {
  it('flash / lite / 4.5 / 4.0 单价', () => {
    expect(cost(FLASH)).toMatchObject({ amount: 0.018, currency: 'USD', confidence: 'list-price' });
    expect(cost(LITE)!.amount).toBe(0.035);
    expect(cost(V45)!.amount).toBe(0.04);
    expect(cost(V40)!.amount).toBe(0.03);
    expect(cost(LITE)!.basis.zh).toBe('$0.035/张 × 1');
  });

  it('pro 按 261 万像素分档：1K / 1.5K 低档，2K 高档；自定义按实际像素', () => {
    expect(cost(PRO)!.amount).toBe(0.09);
    expect(cost(PRO, { values: { size: { mode: 'preset', value: '1K' } } })!.amount).toBe(0.045);
    expect(cost(PRO, { values: { size: { mode: 'preset', value: '1.5K' } } })!.amount).toBe(0.045);
    expect(cost(PRO, { values: custom(2048, 1024) })!.amount).toBe(0.045);
    expect(cost(PRO, { values: custom(2048, 2048) })!.amount).toBe(0.09);
    expect(cost(PRO)!.basis.zh).toContain('高于 261 万像素档');
  });

  it('pro 输入图第 1 张免费，之后每张 $0.003；其余模型输入免费', () => {
    const r = cost(PRO, { slots: { image: many(3) } })!;
    expect(r.amount).toBe(0.096);
    expect(r.basis.zh).toContain('输入图 $0.003/张 × 2（第 1 张免费）');
    expect(cost(PRO, { slots: { image: many(1) } })!.amount).toBe(0.09);
    expect(cost(FLASH, { slots: { image: many(5) } })!.amount).toBe(0.018);
  });

  it('组图按 max_images 与"参考图 + 生成 ≤ 15"的上限估，实际张数由模型决定，标 rough', () => {
    expect(cost(LITE, { modeId: 'group', values: { max_images: 4 } })).toMatchObject({ amount: 0.14, confidence: 'rough' });
    expect(cost(V40, { modeId: 'group' })!.amount).toBe(0.45);
    const capped = cost(V45, { modeId: 'group', values: { max_images: 15 }, slots: { image: many(3) } })!;
    expect(capped.amount).toBe(0.48);
    expect(capped.basis.zh).toContain('× 12');
  });

  it('pro 图层分解：按上限 17 张、底图档估，标 rough；auto 按原图尺寸分档', () => {
    const layer = (img: ReturnType<typeof localImg>, values = {}) => cost(PRO, { modeId: 'layer', prompt: '', values, slots: { image: [img] } })!;
    const r = layer(localImg('a', { width: 1024, height: 1024 }));
    expect(r).toEqual({
      amount: 0.3825,
      currency: 'USD',
      basis: {
        zh: '$0.0225/张 × 17（最多 1 张底图 + 16 个图层，按上限估；各层按自己的实际像素档分别计费，这里统一按底图档估；不高于 261 万像素档）',
        en: '$0.0225/image × 17 (up to 1 base + 16 layers, upper bound; each layer is billed at its own pixel tier, estimated here at the base image tier; ≤ 2.61 MP tier)',
      },
      confidence: 'rough',
    });
    expect(layer(localImg('a', { width: 3000, height: 3000 })).amount).toBe(0.765);
    expect(layer(localImg('a', { width: 800, height: 600 })).amount).toBe(0.3825);
    expect(layer(urlImg('a'))).toMatchObject({ amount: 0.765, confidence: 'rough' });
    expect(layer(urlImg('a'), { size: { mode: 'preset', value: '1K' } })).toMatchObject({ amount: 0.3825, confidence: 'rough' });
  });

  it('flash 图层分解单价未核实，标 rough', () => {
    expect(cost(FLASH, { modeId: 'layer', prompt: '', slots: { image: [localImg('a')] } })).toMatchObject({ amount: 0.306, confidence: 'rough' });
  });

  it('透明背景按 1 张计（标价）', () => {
    expect(cost(PRO, { modeId: 'transparent', values: { size: { mode: 'preset', value: '1K' } }, slots: { image: [localImg('a', { hasAlpha: true })] } })).toMatchObject({ amount: 0.045, confidence: 'list-price' });
    expect(cost(FLASH, { modeId: 'transparent', slots: { image: [localImg('a', { hasAlpha: true })] } })!.amount).toBe(0.018);
  });
});
