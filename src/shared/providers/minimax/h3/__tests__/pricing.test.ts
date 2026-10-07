import { describe, expect, it } from 'vitest';
import type { FormInput } from '../../../../catalog/types.js';
import { H3, MAX, aud, evalForm, img, many, model, vid } from './helpers.js';

const cost = (id: string, over: Partial<FormInput> = {}) => model(id).estimateCost!(evalForm(id, over).ctx);

describe('费用估算（按量标价）', () => {
  it('H3 默认：768P $0.08/秒 × 4 秒', () => {
    expect(cost(H3)).toEqual({ amount: 0.32, currency: 'USD', basis: { zh: '$0.08/秒 × 4 秒（768P）', en: '$0.08/s × 4 s (768P)' }, confidence: 'list-price' });
  });

  it('H3 2K $0.13/秒；H3-Max 480P $0.05/秒、768P $0.08/秒', () => {
    expect(cost(H3, { values: { resolution: '2K', duration: 15 } })?.amount).toBe(1.95);
    expect(cost(MAX)?.amount).toBe(0.4);
    expect(cost(MAX, { values: { resolution: '480P' } })?.amount).toBe(0.25);
  });

  it('输入图：H3 前 5 张免费、之后 $0.04/张', () => {
    expect(cost(H3, { modeId: 'r2v', slots: { reference_image: many(5, (id) => img(id)) } })?.amount).toBe(0.32);
    const c = cost(H3, { modeId: 'r2v', slots: { reference_image: many(7, (id) => img(id)) } });
    expect(c?.amount).toBe(0.4);
    expect(c?.basis.zh).toBe('$0.08/秒 × 4 秒（768P） + 输入图 $0.04/张 × 2（前 5 张免费）');
  });

  it('输入图：H3-Max 前 2 张免费（首尾帧也算）、之后 $0.074/张', () => {
    expect(cost(MAX, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [img('l')] } })?.amount).toBe(0.4);
    expect(cost(MAX, { modeId: 'r2v', slots: { reference_image: many(3, (id) => img(id)) } })?.amount).toBe(0.474);
  });

  it('参考视频按输入秒数 × 输出分辨率单价', () => {
    // H3 2K：输出 0.13×5 + 参考视频 0.13×6
    expect(cost(H3, { modeId: 'r2v', values: { resolution: '2K', duration: 5 }, slots: { reference_video: [vid('v', 6)] } })?.amount).toBe(1.43);
    // H3-Max 768P：输出 0.08×5 + 参考视频 0.143×(4+3)
    const c = cost(MAX, { modeId: 'r2v', slots: { reference_video: [vid('a', 4), vid('b', 3)] } });
    expect(c?.amount).toBe(1.401);
    expect(c?.confidence).toBe('list-price');
    // H3-Max 480P：参考视频 0.0553/秒
    expect(cost(MAX, { modeId: 'r2v', values: { resolution: '480P' }, slots: { reference_video: [vid('a', 10)] } })?.amount).toBe(0.803);
  });

  it('参考视频时长未知：按 15 秒上限估，置为 rough', () => {
    const c = cost(H3, { modeId: 'r2v', slots: { reference_video: [vid('a', 4), vid('b')] } });
    expect(c?.amount).toBe(1.52);
    expect(c?.confidence).toBe('rough');
    expect(c?.basis.zh).toContain('时长未知按上限估');
  });

  it('参考视频秒数非整数：按实际秒数估，并注明取整未说明', () => {
    // H3 768P：输出 0.08×4 + 参考视频 0.08×(2.5+3)
    const c = cost(H3, { modeId: 'r2v', slots: { reference_video: [vid('a', 2.5), vid('b', 3)] } });
    expect(c?.amount).toBe(0.76);
    expect(c?.confidence).toBe('list-price');
    expect(c?.basis).toEqual({
      zh: '$0.08/秒 × 4 秒（768P） + 参考视频 $0.08/秒 × 5.5 秒，是否按整秒取整计费未说明',
      en: '$0.08/s × 4 s (768P) + reference video $0.08/s × 5.5 s, rounding to whole seconds not documented',
    });
  });

  it('仅尾帧：1 张输入图在免费额度内', () => {
    expect(cost(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } })?.amount).toBe(0.32);
    expect(cost(MAX, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } })?.amount).toBe(0.4);
  });

  it('参考音频免费', () => {
    expect(cost(H3, { modeId: 'r2v', slots: { reference_audio: [aud('a', 10)] } })?.amount).toBe(0.32);
  });

  it('时长缺失时不估算', () => {
    expect(cost(H3, { values: { duration: null } })).toBeNull();
  });
});
