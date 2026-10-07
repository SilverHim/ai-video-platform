import { describe, expect, it } from 'vitest';
import type { AssetRef } from '../../../../catalog/types.js';
import { byteplus } from '../../index.js';
import { SEEDREAM_MODELS } from '../index.js';
import { ALL, FLASH, LITE, PRO, V40, V45, evalForm, issueIds, localImg, many, model, run, urlImg, wireOf } from './helpers.js';

const BASE_FIELDS = { size: '2K', optimize_prompt_options: { mode: 'standard' }, response_format: 'url', watermark: true };

describe('默认请求体黄金快照（generate，提示词 "a cat"）', () => {
  it.each([
    [PRO, { ...BASE_FIELDS, model: 'dola-seedream-5-0-pro-260628', prompt: 'a cat', output_format: 'jpeg' }],
    [FLASH, { ...BASE_FIELDS, model: 'dola-seedream-5-0-flash-260915', prompt: 'a cat', output_format: 'jpeg' }],
    [LITE, { ...BASE_FIELDS, model: 'seedream-5-0-260128', prompt: 'a cat', output_format: 'jpeg', sequential_image_generation: 'disabled', stream: false }],
    [V45, { ...BASE_FIELDS, model: 'seedream-4-5-251128', prompt: 'a cat', sequential_image_generation: 'disabled', stream: false }],
    [V40, { ...BASE_FIELDS, model: 'seedream-4-0-250828', prompt: 'a cat', sequential_image_generation: 'disabled', stream: false }],
  ])('%s', (id, expected) => {
    const { ev, built, body } = run(id);
    expect(body).toEqual(expected);
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
    expect(built.endpointId).toBe('image.generate');
    expect(built.stream).toBe(false);
  });
});

describe('模型注册与能力矩阵', () => {
  it('5 个模型注册进 BytePlus，endpoint 都在服务商白名单里', () => {
    expect(SEEDREAM_MODELS.map((m) => m.id)).toEqual(ALL);
    for (const m of SEEDREAM_MODELS) {
      expect(byteplus.models).toContain(m);
      expect(m).toMatchObject({ providerId: 'byteplus', family: 'seedream', kind: 'sync', output: 'image', allowModelOverride: true });
      expect(byteplus.endpoints[m.endpoints.submit]).toBeDefined();
      if (m.endpoints.stream) expect(byteplus.endpoints[m.endpoints.stream]?.stream).toBe(true);
    }
    expect(model(LITE).aliases).toEqual(['seedream-5-0-lite-260128']);
  });

  it('流式 endpoint 与 parseStreamEvent 只给 lite / 4.5 / 4.0', () => {
    for (const id of ALL) {
      const streaming = [LITE, V45, V40].includes(id);
      expect(Boolean(model(id).endpoints.stream)).toBe(streaming);
      expect(Boolean(model(id).adapter.parseStreamEvent)).toBe(streaming);
      expect(model(id).fields.some((f) => f.key === 'stream')).toBe(streaming);
    }
  });

  it('模式按模型开放', () => {
    const modes = (id: string) => model(id).modes.map((m) => m.id);
    expect(modes(PRO)).toEqual(['generate', 'layer', 'transparent']);
    expect(modes(FLASH)).toEqual(['generate', 'layer', 'transparent']);
    for (const id of [LITE, V45, V40]) expect(modes(id)).toEqual(['generate', 'group']);
  });

  it('output_format 只给 pro / flash / lite；fast 只给 pro / 4.0', () => {
    for (const id of ALL) {
      const m = model(id);
      expect(m.fields.some((f) => f.key === 'output_format')).toBe([PRO, FLASH, LITE].includes(id));
      const pm = m.fields.find((f) => f.key === 'optimize_prompt_mode');
      expect(pm?.type === 'enum' && pm.options.map((o) => o.value)).toEqual([PRO, V40].includes(id) ? ['standard', 'fast'] : ['standard']);
    }
  });

  it('4.0 的 fast 有文档措辞冲突：字段标 experimental，fast 选项挂 badge；pro 不标', () => {
    const pm = (id: string) => model(id).fields.find((f) => f.key === 'optimize_prompt_mode')!;
    const v40 = pm(V40);
    expect(v40.experimental).toBe(true);
    expect(v40.type === 'enum' && v40.options.find((o) => o.value === 'fast')?.badge).toEqual({ zh: 'pro 教程措辞不一致', en: 'Pro guide wording differs' });
    const pro = pm(PRO);
    expect(pro.experimental).toBeUndefined();
    expect(pro.type === 'enum' && pro.options.every((o) => o.badge === undefined)).toBe(true);
  });

  it('不声明文档与目录都没有的字段（guidance_scale / n）；目录元数据才有的字段只给 pro / flash，且默认不发送', () => {
    const banned = ['guidance_scale', 'n'];
    const catalogOnly = ['negative_prompt', 'seed', 'optimize_prompt'];
    for (const m of SEEDREAM_MODELS) {
      const declared = (k: string) => m.fields.some((f) => f.key === k || f.wire === k);
      for (const k of banned) expect(declared(k)).toBe(false);
      for (const k of catalogOnly) expect(declared(k) || m.fields.some((f) => f.key === k)).toBe(m.id === PRO || m.id === FLASH);
      for (const f of m.fields.filter((x) => catalogOnly.includes(x.key))) {
        // seed 已在 flash 实测可复现，转正；其余两项效果未验证，仍标实验
        expect(Boolean(f.experimental)).toBe(f.key !== 'seed');
        expect(f.modes).not.toContain('layer');
      }
      for (const mode of m.modes) {
        const slots: Record<string, AssetRef[]> = mode.slots[0]!.min ? { image: [localImg('a', { hasAlpha: true })] } : {};
        const { body } = run(m.id, { modeId: mode.id, slots });
        for (const k of [...banned, ...catalogOnly]) expect(body).not.toHaveProperty(k);
      }
    }
  });

  it('目录元数据字段：填了才发送；关掉提示词优化时发送 optimize_prompt=false 并停用优化模式', () => {
    const { body, ev } = run(FLASH, { values: { negative_prompt: 'text, watermark', seed: 42, optimize_prompt: false } });
    expect(body).toMatchObject({ negative_prompt: 'text, watermark', seed: 42, optimize_prompt: false });
    expect(body).not.toHaveProperty('optimize_prompt_options');
    expect(ev.fields.optimize_prompt_mode).toMatchObject({ sent: false, disabledReason: { zh: '已关闭提示词优化' } });
    expect(run(PRO, { values: { negative_prompt: 'nsfw', seed: null, optimize_prompt: true } }).body).toEqual(run(PRO).body);
    // 负向提示词默认 nsfw 不发送；清空时显式发送空字符串，覆盖服务端默认
    expect(evalForm(PRO).effective.negative_prompt).toBe('nsfw');
    expect(run(PRO, { values: { negative_prompt: '' } }).body).toMatchObject({ negative_prompt: '' });
    // 图层分解模式不开放这三个字段
    const layer = run(PRO, { modeId: 'layer', slots: { image: [localImg('a')] }, values: { negative_prompt: 'x', seed: 1, optimize_prompt: false } }).body;
    for (const k of ['negative_prompt', 'seed', 'optimize_prompt']) expect(layer).not.toHaveProperty(k);
  });

  it('参考图上限：pro / flash 10，其余 14；来源 local / url / task-output', () => {
    for (const id of ALL) {
      const slot = model(id).modes[0]!.slots[0]!;
      expect(slot).toMatchObject({ id: 'image', min: 0, max: [PRO, FLASH].includes(id) ? 10 : 14, sources: ['local', 'url', 'task-output'] });
    }
  });

  it('文档链接都来自调研报告的官方 URL', () => {
    for (const m of SEEDREAM_MODELS) {
      expect(m.docs.length).toBeGreaterThan(0);
      for (const d of [...m.docs, ...m.fields.flatMap((f) => f.docs ?? [])]) expect(d.url).toMatch(/^https:\/\/ai\.byteplus\.com\/ark\/region:ap-southeast-1\/docs\//);
    }
  });
});

describe('generate 模式', () => {
  it('1 张参考图发字符串', () => {
    const { body } = run(PRO, { slots: { image: [localImg('a')] }, prompt: 'make {{ref:a}} sunny' });
    expect(body.image).toBe(wireOf('a'));
    expect(body.prompt).toBe('make Image 1 sunny');
  });

  it('多张参考图发数组，顺序与 Image n 编号一致', () => {
    const { body } = run(LITE, { slots: { image: [localImg('a'), urlImg('b'), localImg('c')] }, prompt: 'put {{ref:c}} next to {{ref:a}}' });
    expect(body.image).toEqual([wireOf('a'), wireOf('b'), wireOf('c')]);
    expect(body.prompt).toBe('put Image 3 next to Image 1');
  });

  it('自定义尺寸写成 宽x高', () => {
    expect(run(PRO, { values: { size: { mode: 'custom', width: 2048, height: 1024 } } }).body.size).toBe('2048x1024');
  });

  it('流式：stream=true 切到 image.stream', () => {
    const { built } = run(V45, { values: { stream: true } });
    expect(built.endpointId).toBe('image.stream');
    expect(built.body.stream).toBe(true);
  });

  it('fast：pro / 4.0 可选，flash 传 fast 回退到 standard', () => {
    expect(run(PRO, { values: { optimize_prompt_mode: 'fast' } }).body.optimize_prompt_options).toEqual({ mode: 'fast' });
    expect(run(V40, { values: { optimize_prompt_mode: 'fast' } }).body.optimize_prompt_options).toEqual({ mode: 'fast' });
    const flash = evalForm(FLASH, { values: { optimize_prompt_mode: 'fast' } });
    expect(flash.fields.optimize_prompt_mode!.value).toBe('standard');
    expect(flash.fields.optimize_prompt_mode!.adjusted).toBeDefined();
  });

  it('组图模型在非组图模式下锁定并显式发送 disabled', () => {
    const r = evalForm(LITE, { values: { sequential_image_generation: 'auto' } });
    expect(r.fields.sequential_image_generation!.locked?.value).toBe('disabled');
    expect(run(LITE, { values: { sequential_image_generation: 'auto' } }).body.sequential_image_generation).toBe('disabled');
  });

  it('输出选项与 model 覆盖', () => {
    const { body, built } = run(FLASH, { values: { response_format: 'b64_json', watermark: false, output_format: 'png' }, modelOverride: 'ep-20261008-abc' });
    expect(body).toMatchObject({ response_format: 'b64_json', watermark: false, output_format: 'png', model: 'ep-20261008-abc' });
    expect(built.notes).toHaveLength(1);
  });

  it('提示词必填与软上限（300 汉字 / 600 英文单词）', () => {
    expect(issueIds(evalForm(PRO, { prompt: ' ' }))).toContain('prompt:required');
    expect(issueIds(evalForm(PRO, { prompt: '猫'.repeat(301) }))).toContain('prompt:soft');
    expect(issueIds(evalForm(PRO, { prompt: '猫'.repeat(300) }))).not.toContain('prompt:soft');
    expect(issueIds(evalForm(LITE, { prompt: Array(601).fill('cat').join(' ') }))).toContain('prompt:soft');
  });

  it('提示词 hint：pro / flash 另支持 14 种语言并提示 <point>/<bbox>；其余只写中英文', () => {
    for (const id of [PRO, FLASH]) {
      const h = model(id).modes[0]!.prompt.hint!;
      expect(h.zh).toContain('14 种语言');
      expect(h.zh).toContain('<bbox>');
      expect(h.en).toContain('Japanese');
    }
    for (const id of [LITE, V45, V40]) {
      for (const mode of model(id).modes) expect(mode.prompt.hint).toEqual({ zh: '支持中文、英文提示词', en: 'Chinese and English prompts are supported' });
    }
  });

  it('参考图槽位说明：Image n 对应关系标为推导', () => {
    for (const id of ALL) {
      const help = model(id).modes[0]!.slots[0]!.help!;
      expect(help.zh).toContain('推导自官方示例');
      expect(help.en).toContain('inferred');
    }
  });

  it('输入图上限按 30,000,000 字节（MB 口径未核实，取较小值）', () => {
    const at = (bytes: number) => issueIds(evalForm(PRO, { slots: { image: [localImg('a', { bytes })] } }));
    expect(at(30_000_000)).toEqual([]);
    expect(at(30_000_001)).toContain('asset:image:0');
    expect(issueIds(evalForm(FLASH, { modeId: 'layer', prompt: '', slots: { image: [localImg('a', { bytes: 30_000_001 })] } }))).toContain('asset:image:0');
  });

  it('size 说明：pro / flash 提示 1.5K 与 1K 同价', () => {
    const help = (id: string) => model(id).fields.find((f) => f.key === 'size')!.help!;
    for (const id of [PRO, FLASH]) expect(help(id).zh).toContain('1.5K 与 1K 同价');
    for (const id of [LITE, V45, V40]) expect(help(id).zh).not.toContain('1.5K');
  });
});

describe('group 模式（lite / 4.5 / 4.0）', () => {
  it('锁定 auto 并发送 max_images', () => {
    const { body, ev } = run(LITE, { modeId: 'group', values: { max_images: 4 }, slots: { image: [localImg('a')] } });
    expect(body).toEqual({
      model: 'seedream-5-0-260128',
      prompt: 'a cat',
      image: wireOf('a'),
      size: '2K',
      sequential_image_generation: 'auto',
      sequential_image_generation_options: { max_images: 4 },
      output_format: 'jpeg',
      optimize_prompt_options: { mode: 'standard' },
      response_format: 'url',
      stream: false,
      watermark: true,
    });
    expect(ev.fields.sequential_image_generation!.locked?.value).toBe('auto');
  });

  it('max_images 默认随参考图数收紧到 15 − 参考图数', () => {
    expect(run(V45, { modeId: 'group' }).body.sequential_image_generation_options).toEqual({ max_images: 15 });
    expect(run(V45, { modeId: 'group', slots: { image: many(3) } }).body.sequential_image_generation_options).toEqual({ max_images: 12 });
  });

  it('max_images 范围 1–15', () => {
    expect(issueIds(evalForm(V40, { modeId: 'group', values: { max_images: 16 } }))).toContain('range:max_images');
    expect(issueIds(evalForm(V40, { modeId: 'group', values: { max_images: 0 } }))).toContain('range:max_images');
  });

  it('组图也可流式', () => {
    expect(run(V40, { modeId: 'group', values: { stream: true } }).built.endpointId).toBe('image.stream');
  });

  it('max_images 只在组图模式出现', () => {
    expect(run(LITE).body).not.toHaveProperty('sequential_image_generation_options');
  });
});

describe('layer 模式（pro / flash）', () => {
  it('模式与提示词说明：16 层上限可能丢信息、预扣 17 IPM', () => {
    const layer = model(PRO).modes.find((m) => m.id === 'layer')!;
    expect(layer.hint?.zh).toContain('预扣 17 张 IPM');
    expect(layer.prompt.hint?.zh).toContain('超过 16 层时可能丢失部分图层信息');
    expect(layer.prompt.required).toBe(false);
  });

  it('固定 layer_decomposition=true，size 默认 auto，提示词可省略且不发', () => {
    const { body, ev } = run(PRO, { modeId: 'layer', prompt: '', slots: { image: [localImg('a')] } });
    expect(ev.canSubmit).toBe(true);
    expect(body).toEqual({
      model: 'dola-seedream-5-0-pro-260628',
      image: wireOf('a'),
      layer_decomposition: true,
      size: 'auto',
      output_format: 'jpeg',
      response_format: 'url',
      watermark: true,
    });
  });

  it('写了提示词就发送；size 只能选档位', () => {
    const { body } = run(FLASH, { modeId: 'layer', prompt: 'split the cat', values: { size: { mode: 'preset', value: '1.5K' } }, slots: { image: [localImg('a')] } });
    expect(body).toMatchObject({ prompt: 'split the cat', size: '1.5K', layer_decomposition: true });
    const sizeField = model(PRO).fields.find((f) => f.key === 'size')!;
    const ctx = evalForm(PRO, { modeId: 'layer', slots: { image: [localImg('a')] } }).ctx;
    expect(sizeField.type === 'size' && sizeField.spec(ctx)).toMatchObject({ presets: [{ value: '1K' }, { value: '1.5K' }, { value: '2K' }, { value: 'auto' }] });
    expect(sizeField.type === 'size' && sizeField.spec(ctx).custom).toBeUndefined();
  });
});

describe('transparent 模式（pro / flash）', () => {
  it('锁定 background=transparent 与 output_format=png', () => {
    const { body, ev } = run(FLASH, { modeId: 'transparent', values: { output_format: 'jpeg', background: 'opaque' }, slots: { image: [localImg('a', { hasAlpha: true })] } });
    expect(ev.canSubmit).toBe(true);
    expect(body).toEqual({
      model: 'dola-seedream-5-0-flash-260915',
      prompt: 'a cat',
      image: wireOf('a'),
      size: '2K',
      background: 'transparent',
      output_format: 'png',
      optimize_prompt_options: { mode: 'standard' },
      response_format: 'url',
      watermark: true,
    });
    expect(ev.fields.output_format!.locked?.reason.zh).toContain('PNG');
  });

  it('提示词必填；background 只在透明背景模式发送', () => {
    expect(issueIds(evalForm(PRO, { modeId: 'transparent', prompt: '', slots: { image: [localImg('a', { hasAlpha: true })] } }))).toContain('prompt:required');
    expect(run(PRO).body).not.toHaveProperty('background');
  });
});
