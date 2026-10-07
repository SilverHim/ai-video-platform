import { describe, expect, it } from 'vitest';
import type { AssetRef } from '../../../../catalog/types.js';
import { FLASH, LITE, PRO, V40, V45, evalForm, issueIds, localImg, many, model, run, urlImg } from './helpers.js';

const issue = (r: ReturnType<typeof evalForm>, id: string) => r.issues.find((i) => i.id === id);
const guards = (r: ReturnType<typeof run>) => r.built.issues.map((i) => i.id);

describe('C-SD-1 图层分解输入', () => {
  const layer = (slots: Record<string, AssetRef[]>) => evalForm(PRO, { modeId: 'layer', prompt: '', slots });

  it('命中：格式不是 png/jpeg、像素 < 262,144、张数不是 1', () => {
    expect(layer({ image: [localImg('a', { mime: 'image/webp' })] }).canSubmit).toBe(false);
    const small = layer({ image: [localImg('a', { width: 511, height: 512 })] });
    expect(small.issues.some((i) => i.id === 'asset:image:0' && i.message.zh.includes('262144'))).toBe(true);
    expect(issueIds(layer({ image: [localImg('a'), localImg('b')] }))).toContain('slot-max:image');
    expect(issueIds(layer({}))).toContain('slot-min:image');
  });

  it('命中：URL 图片无元数据时给 warn', () => {
    const r = layer({ image: [urlImg('a')] });
    expect(issue(r, 'C-SD-1')?.severity).toBe('warn');
    expect(r.canSubmit).toBe(true);
  });

  it('不命中：512×512 PNG、带元数据的 URL、非图层模式', () => {
    const ok = layer({ image: [localImg('a', { width: 512, height: 512 })] });
    expect(ok.issues).toEqual([]);
    expect(issueIds(layer({ image: [urlImg('a', { mime: 'image/jpeg', width: 800, height: 600 })] }))).not.toContain('C-SD-1');
    expect(issueIds(evalForm(PRO, { slots: { image: [urlImg('a')] } }))).not.toContain('C-SD-1');
  });

  it('图层分解选了自定义尺寸：引擎自动回退到默认档位（auto）并提示', () => {
    const r = evalForm(FLASH, { modeId: 'layer', values: { size: { mode: 'custom', width: 2048, height: 2048 } }, slots: { image: [localImg('a')] } });
    expect(issueIds(r)).not.toContain('size-custom:size');
    expect(r.fields.size!.value).toEqual({ mode: 'preset', value: 'auto' });
    expect(r.fields.size!.adjusted).toBeDefined();
  });

  it('wireGuard：多张图或像素 size 被拦截', () => {
    const slots = { image: [localImg('a')] };
    expect(guards(run(PRO, { modeId: 'layer', slots }))).toEqual([]);
    expect(guards(run(PRO, { modeId: 'layer', slots, rawOverrides: { image: ['x', 'y'] } }))).toContain('guard:C-SD-1');
    expect(guards(run(PRO, { modeId: 'layer', slots, rawOverrides: { size: '2048x2048' } }))).toContain('guard:C-SD-1');
  });
});

describe('C-SD-2 透明背景', () => {
  const tr = (img: AssetRef) => evalForm(FLASH, { modeId: 'transparent', slots: { image: [img] } });

  it('命中：jpeg、无 alpha、张数不是 1', () => {
    expect(tr(localImg('a', { mime: 'image/jpeg', hasAlpha: false })).canSubmit).toBe(false);
    const noAlpha = tr(localImg('a', { hasAlpha: false }));
    expect(noAlpha.issues.some((i) => i.id === 'asset:image:0' && i.message.zh.includes('alpha'))).toBe(true);
    expect(issueIds(evalForm(PRO, { modeId: 'transparent', slots: { image: [localImg('a', { hasAlpha: true }), localImg('b', { hasAlpha: true })] } }))).toContain('slot-max:image');
    expect(issueIds(evalForm(PRO, { modeId: 'transparent' }))).toContain('slot-min:image');
  });

  it('命中：非 PNG（"仅 PNG" 只出自 arkcli 元数据，未核实）与 URL 无法确认 alpha 时给 warn', () => {
    const webp = tr(localImg('a', { mime: 'image/webp', hasAlpha: true }));
    const w = issue(webp, 'C-SD-2')!;
    expect(w.severity).toBe('warn');
    expect(w.message.zh).toContain('arkcli 元数据');
    expect(w.message.zh).not.toContain('官方元数据');
    expect(w.message.en).toContain('unverified');
    expect(webp.canSubmit).toBe(true);
    expect(issue(tr(urlImg('a')), 'C-SD-2')?.message.zh).toContain('透明通道');
  });

  it('不命中：带 alpha 的 PNG', () => {
    expect(tr(localImg('a', { hasAlpha: true })).issues).toEqual([]);
    expect(issueIds(tr(urlImg('a', { mime: 'image/png', hasAlpha: true, width: 100, height: 100 })))).not.toContain('C-SD-2');
  });

  it('本地图缺 alpha 元数据时由引擎提示未校验', () => {
    expect(tr(localImg('a')).issues.map((i) => i.severity)).toEqual(['warn']);
  });

  it('wireGuard：输出不是 png、多张图、叠加图层分解被拦截', () => {
    const slots = { image: [localImg('a', { hasAlpha: true })] };
    expect(guards(run(PRO, { modeId: 'transparent', slots }))).toEqual([]);
    expect(guards(run(PRO, { modeId: 'transparent', slots, rawOverrides: { output_format: 'jpeg' } }))).toContain('guard:C-SD-2');
    expect(guards(run(PRO, { modeId: 'transparent', slots, rawOverrides: { image: ['x', 'y'] } }))).toContain('guard:C-SD-2');
    expect(guards(run(PRO, { modeId: 'transparent', slots, rawOverrides: { layer_decomposition: true } }))).toContain('guard:C-SD-2');
  });
});

describe('C-SD-4 组图参考图数 + max_images ≤ 15（warn）', () => {
  it('命中：3 张参考图 + 13 张，给一键修复', () => {
    const r = evalForm(LITE, { modeId: 'group', values: { max_images: 13 }, slots: { image: many(3) } });
    const i = issue(r, 'C-SD-4')!;
    expect(i.severity).toBe('warn');
    expect(i.fix?.patch).toEqual({ max_images: 12 });
    expect(r.canSubmit).toBe(true);
  });

  it('不命中：恰好 15、默认值、非组图模式', () => {
    expect(issueIds(evalForm(V45, { modeId: 'group', values: { max_images: 12 }, slots: { image: many(3) } }))).not.toContain('C-SD-4');
    expect(issueIds(evalForm(V40, { modeId: 'group', slots: { image: many(14) } }))).not.toContain('C-SD-4');
    expect(issueIds(evalForm(V40, { values: { max_images: 15 }, slots: { image: many(14) } }))).not.toContain('C-SD-4');
  });
});

describe('C-SD-5 自定义像素区间与宽高比 [1/16, 16]', () => {
  const custom = (id: string, width: number, height: number) => evalForm(id, { values: { size: { mode: 'custom', width, height } } });

  it.each([
    // 文档示例
    [PRO, 2048, 1024, true],
    [PRO, 512, 512, false],
    [LITE, 3750, 1250, true],
    [LITE, 1500, 1500, false],
    [V40, 1600, 600, true],
    [V40, 800, 800, false],
    // 边界
    [FLASH, 1280, 720, true],
    [FLASH, 2048, 2257, true],
    [FLASH, 2048, 2258, false],
    [V45, 4096, 4096, true],
    [V45, 4096, 4097, false],
    [V40, 4096, 256, true],
    [V40, 4096, 255, false],
  ])('%s %ix%i → %s', (id, w, h, ok) => {
    const r = custom(id, w, h);
    expect(issueIds(r).includes('size-custom:size')).toBe(!ok);
    expect(issueIds(r).includes('C-SD-5')).toBe(!ok);
  });

  it('修复建议：保持宽高比收进区间，比例越界时夹到 16', () => {
    expect(issue(custom(PRO, 512, 512), 'C-SD-5')!.fix?.patch).toEqual({ size: { mode: 'custom', width: 960, height: 960 } });
    expect(issue(custom(LITE, 4000, 200), 'C-SD-5')!.fix?.patch).toEqual({ size: { mode: 'custom', width: 7680, height: 480 } });
    expect(issue(custom(PRO, 4096, 4096), 'C-SD-5')!.fix?.patch).toEqual({ size: { mode: 'custom', width: 2150, height: 2150 } });
    expect(issue(custom(PRO, 512, 512), 'C-SD-5')!.severity).toBe('info');
  });
});

describe('C-SD-6 参考图上限', () => {
  it('命中：pro / flash 11 张被拒，并提示可改用 14 张的模型', () => {
    for (const id of [PRO, FLASH]) {
      const r = evalForm(id, { slots: { image: many(11) } });
      expect(issueIds(r)).toContain('slot-max:image');
      expect(issue(r, 'C-SD-6')?.message.zh).toContain('Seedream 5.0 lite');
    }
    expect(issueIds(evalForm(LITE, { slots: { image: many(15) } }))).toContain('slot-max:image');
  });

  it('不命中：pro 10 张、lite / 4.5 / 4.0 14 张', () => {
    expect(evalForm(PRO, { slots: { image: many(10) } }).issues).toEqual([]);
    for (const id of [LITE, V45, V40]) expect(evalForm(id, { slots: { image: many(14) } }).issues).toEqual([]);
    expect(model(LITE).constraints.map((c) => c.id)).not.toContain('C-SD-6');
  });

  it('wireGuard：rawOverrides 塞进超限数组被拦截', () => {
    expect(guards(run(PRO, { rawOverrides: { image: Array.from({ length: 11 }, (_, i) => `u${i}`) } }))).toContain('guard:C-SD-6');
    expect(guards(run(LITE, { rawOverrides: { image: Array.from({ length: 14 }, (_, i) => `u${i}`) } }))).not.toContain('guard:C-SD-6');
  });
});

describe('其他 wireGuard', () => {
  it('素材未解析', () => {
    expect(guards(run(PRO, { slots: { image: [localImg('a')] } }, {}))).toContain('guard:image-resolved');
  });

  it('模型不支持的能力被拦截（来自 rawOverrides）', () => {
    expect(guards(run(PRO, { rawOverrides: { stream: true } }))).toContain('guard:no-stream');
    expect(run(PRO, { rawOverrides: { stream: true } }).built.endpointId).toBe('image.generate');
    expect(guards(run(FLASH, { rawOverrides: { sequential_image_generation: 'auto' } }))).toContain('guard:no-sequential');
    expect(guards(run(FLASH, { rawOverrides: { optimize_prompt_options: { mode: 'fast' } } }))).toContain('guard:no-fast');
    expect(guards(run(V45, { rawOverrides: { optimize_prompt_options: { mode: 'fast' } } }))).toContain('guard:no-fast');
    expect(guards(run(V40, { rawOverrides: { optimize_prompt_options: { mode: 'fast' } } }))).not.toContain('guard:no-fast');
    expect(guards(run(LITE, { rawOverrides: { background: 'transparent' } }))).toContain('guard:no-layer-background');
    expect(guards(run(V40, { rawOverrides: { layer_decomposition: true } }))).toContain('guard:no-layer-background');
  });

  it('no-output-format：4.5 / 4.0 不发 output_format（文档冲突，保守拦截）', () => {
    for (const id of [V45, V40]) {
      expect(guards(run(id, { rawOverrides: { output_format: 'png' } }))).toContain('guard:no-output-format');
      expect(guards(run(id, { rawOverrides: { output_format: 'jpeg' } }))).toContain('guard:no-output-format');
      expect(run(id).body).not.toHaveProperty('output_format');
    }
    for (const id of [PRO, FLASH, LITE]) {
      expect(guards(run(id, { rawOverrides: { output_format: 'png' } }))).not.toContain('guard:no-output-format');
      expect(model(id).wireGuards!.map((g) => g.id)).not.toContain('no-output-format');
    }
  });

  it('各模型各模式的默认请求不触发任何 guard', () => {
    for (const id of [PRO, FLASH, LITE, V45, V40]) {
      for (const mode of model(id).modes) {
        const slots = mode.slots[0]!.min ? { image: [localImg('a', { hasAlpha: true })] } : { image: [localImg('a'), localImg('b')] };
        expect(guards(run(id, { modeId: mode.id, slots }))).toEqual([]);
      }
    }
  });
});
