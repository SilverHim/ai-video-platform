import { describe, expect, it } from 'vitest';
import { listModels } from '../../registry.js';

describe('官方提示词指南', () => {
  const withGuides = listModels({ includeHidden: true }).filter((x) => x.model.promptGuides?.length);

  it('Seedance 各版本与 Seedream 5.0 pro / flash、4.x 都挂了指南；5.0 lite 没有官方指南覆盖', () => {
    const ids = withGuides.map((x) => x.model.id);
    for (const id of ['byteplus/seedance-2-5', 'byteplus/seedance-2-0', 'byteplus/seedance-2-0-fast', 'byteplus/seedance-2-0-mini', 'byteplus/seedance-1-5-pro', 'byteplus/seedance-1-0-pro', 'byteplus/seedance-1-0-pro-fast', 'byteplus/seedream-5-0-pro', 'byteplus/seedream-5-0-flash', 'byteplus/seedream-4-5', 'byteplus/seedream-4-0']) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain('byteplus/seedream-5-0-lite');
  });

  it('规则与示范标注的模式都存在于对应模型；来源是 BytePlus 官方文档并带 revision', () => {
    for (const { model } of withGuides) {
      const modeIds = new Set(model.modes.map((m) => m.id));
      const derived = new Set(model.modes.filter((m) => m.entry === 'derived').map((m) => m.id));
      for (const g of model.promptGuides!) {
        // 派生模式（生成正片沿用样片提示词）不适用提示词指南
        expect(g.modes?.length).toBeGreaterThan(0);
        for (const m of g.modes ?? []) expect(derived.has(m)).toBe(false);
        for (const r of g.rules) for (const m of r.modes ?? []) expect(derived.has(m)).toBe(false);
        for (const r of g.rules) for (const m of r.modes ?? []) expect(g.modes).toContain(m);
        expect(g.source.url).toMatch(/^https:\/\/ai\.byteplus\.com\/ark\/region:ap-southeast-1\/docs\//);
        expect(g.source.revision).toBeGreaterThan(0);
        expect(g.rules.length).toBeGreaterThan(0);
        for (const r of g.rules) {
          expect(r.text.zh.length).toBeGreaterThan(0);
          expect(r.text.en.length).toBeGreaterThan(0);
          for (const m of r.modes ?? []) expect(modeIds, `${model.id} 的指南 ${g.id} 提到不存在的模式 ${m}`).toContain(m);
        }
        for (const e of g.examples ?? []) {
          expect(e.prompt.length).toBeLessThanOrEqual(240);
          for (const m of e.modes ?? []) expect(modeIds).toContain(m);
        }
      }
    }
  });

  it('Seedream 5.0 交互式编辑指南只适用于生成模式（不含图层分解、透明背景）', () => {
    for (const id of ['byteplus/seedream-5-0-pro', 'byteplus/seedream-5-0-flash']) {
      const { model } = listModels({ includeHidden: true }).find((x) => x.model.id === id)!;
      expect(model.promptGuides!.map((g) => g.modes)).toEqual([['generate']]);
    }
  });
});
