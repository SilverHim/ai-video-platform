import { describe, expect, it } from 'vitest';
import { evaluate } from '../engine/evaluate.js';
import { checkAsset, formatOf } from '../engine/media.js';
import { computeRefOrder, countPrompt, renderPrompt } from '../engine/refs.js';
import { buildRequest } from '../request/build.js';
import { demoModel, demoProvider, input } from './fixtures.js';

const ev = (over = {}) => evaluate(demoProvider, demoModel, input(over));
const ids = (r: ReturnType<typeof ev>) => r.issues.map((i) => i.id);

describe('evaluate', () => {
  it('默认值与发送集合', () => {
    const r = ev();
    expect(r.canSubmit).toBe(true);
    expect(r.effective).toEqual({ quality: 'std', stream: false, n: 1, frames: null, seed: null, onlyBasic: true, hiddenWhenStream: 'x', size: { mode: 'preset', value: '1K' } });
    expect(r.fields.disabled!.sent).toBe(false);
    expect(r.fields.disabled!.disabledReason?.zh).toBe('永远禁用');
  });

  it('模式锁定覆盖用户值并带原因', () => {
    const r = ev({ modeId: 'locked', values: { quality: 'std' } });
    expect(r.fields.quality!.value).toBe('high');
    expect(r.fields.quality!.locked?.reason.zh).toContain('高质量');
    expect(r.fields.onlyBasic!.visible).toBe(false);
  });

  it('枚举不可用时回退到默认值并提示', () => {
    const r = ev({ values: { quality: 'fast', stream: true } });
    expect(r.fields.quality!.value).toBe('std');
    expect(r.fields.quality!.adjusted?.zh).toContain('不可用');
    expect(r.fields.quality!.options!.find((o) => o.value === 'fast')!.disabledReason?.zh).toBe('流式下不可用');
  });

  it('未知枚举值回退', () => {
    const r = ev({ values: { quality: 'ultra' } });
    expect(r.fields.quality!.value).toBe('std');
    expect(r.fields.quality!.adjusted).toBeDefined();
  });

  it('条件显隐', () => {
    expect(ev({ values: { stream: true } }).fields.hiddenWhenStream!.visible).toBe(false);
  });

  it('类型不对时用默认值并警告', () => {
    const r = ev({ values: { n: 'three' } });
    expect(r.fields.n!.value).toBe(1);
    expect(ids(r)).toContain('type:n');
  });

  it('整数范围、非整数、模式（25+4n）', () => {
    expect(ids(ev({ values: { n: 9 } }))).toContain('range:n');
    expect(ids(ev({ values: { n: 1.5 } }))).toContain('int:n');
    expect(ids(ev({ values: { frames: 30 } }))).toContain('pattern:frames');
    expect(ids(ev({ values: { frames: 29 } }))).not.toContain('pattern:frames');
  });

  it('自定义尺寸校验', () => {
    expect(ev({ values: { size: { mode: 'custom', width: 64, height: 64 } } }).canSubmit).toBe(true);
    const bad = ev({ values: { size: { mode: 'custom', width: 63, height: 200 } } });
    expect(ids(bad)).toContain('size-custom:size');
    expect(ids(ev({ values: { size: { mode: 'preset', value: '9K' } } }))).toContain('size-preset:size');
  });

  it('素材槽数量与规格', () => {
    const img = (id: string, meta: object) => ({ id, source: { type: 'url' as const, url: `https://x/${id}.png` }, meta: { kind: 'image' as const, ...meta } });
    const tooMany = ev({ slots: { image: [img('a', {}), img('b', {}), img('c', {})] } });
    expect(ids(tooMany)).toContain('slot-max:image');
    const badSize = ev({ slots: { image: [img('a', { width: 5, height: 50, mime: 'image/png' })] } });
    expect(badSize.canSubmit).toBe(false);
    const badFmt = ev({ slots: { image: [img('a', { width: 50, height: 50, mime: 'image/gif' })] } });
    expect(badFmt.issues.some((i) => i.message.zh.includes('gif'))).toBe(true);
    expect(ids(ev({ slots: { nope: [img('a', {})] } }))).toContain('slot-unknown:nope');
  });

  it('提示词必填、硬上限、软上限、引用失效', () => {
    expect(ids(ev({ prompt: '  ' }))).toContain('prompt:required');
    expect(ids(ev({ prompt: 'x'.repeat(21) }))).toContain('prompt:max');
    expect(ids(ev({ prompt: '一二三四五六' }))).toContain('prompt:soft');
    expect(ids(ev({ prompt: 'see {{ref:gone}}' }))).toContain('prompt:refs');
  });

  it('模型约束', () => {
    expect(ev({ values: { n: 4 } }).issues.find((i) => i.id === 'C-DEMO-1')?.severity).toBe('warn');
  });
});

describe('refs', () => {
  it('编号与渲染', () => {
    const mode = demoModel.modes[0]!;
    const slots = { image: [{ id: 'a1', source: { type: 'url' as const, url: 'u1' } }, { id: 'a2', source: { type: 'url' as const, url: 'u2' } }] };
    const order = computeRefOrder(mode, slots);
    expect(order.a2).toMatchObject({ kind: 'image', n: 2, index: 1 });
    expect(renderPrompt('use {{ref:a2}} then {{ref:a1}}', order).text).toBe('use Image 2 then Image 1');
    expect(renderPrompt('x {{ref:a1}}', order, (k, n) => `@${k} ${n}`).text).toBe('x @image 1');
    expect(renderPrompt('x {{ref:zz}}', order).missing).toEqual(['zz']);
  });

  it('countPrompt', () => {
    expect(countPrompt('一只猫 a cute cat')).toMatchObject({ zhChars: 3, enWords: 3 });
  });
});

describe('media', () => {
  it('formatOf', () => {
    expect(formatOf('image/JPG')).toBe('jpeg');
    expect(formatOf('video/quicktime')).toBe('mov');
    expect(formatOf('audio/mpeg')).toBe('mp3');
    expect(formatOf('clip.TIF')).toBe('tiff');
  });

  it('来源类型不被槽位接受时报错', () => {
    const slot = demoModel.modes[0]!.slots[0]!;
    const r = checkAsset({ id: 'x', source: { type: 'provider-asset', uri: 'asset://1' } }, slot);
    expect(r[0]!.severity).toBe('error');
  });
});

describe('buildRequest', () => {
  const resolved = { a1: { wire: 'https://x/a.png', preview: 'https://x/a.png', bytes: 15 } };
  const slots = { image: [{ id: 'a1', source: { type: 'url' as const, url: 'https://x/a.png' } }] };

  it('字段按 wire 路径写入，null 不发送，fragment 合并，compose 组装', () => {
    const r = ev({ slots, prompt: 'look at {{ref:a1}}' });
    const b = buildRequest(demoProvider, demoModel, r, resolved, 'send');
    expect(b.body).toEqual({ quality: 'std', stream: false, options: { n: 1 }, only_basic: true, note: 'x', size: '1K', model: 'demo-model-001', prompt: 'look at Image 1', image: 'https://x/a.png' });
    expect(b.endpointId).toBe('gen');
    expect(b.stream).toBe(false);
  });

  it('流式切换到 stream endpoint；模式常量片段写入', () => {
    expect(buildRequest(demoProvider, demoModel, ev({ values: { stream: true } }), {}, 'send').endpointId).toBe('gen.stream');
    expect(buildRequest(demoProvider, demoModel, ev({ modeId: 'locked' }), {}, 'send').body.special).toBe(true);
  });

  it('wireGuard 拦截非法组合', () => {
    const b = buildRequest(demoProvider, demoModel, ev({ modeId: 'locked', values: { stream: true } }), {}, 'send');
    expect(b.issues.map((i) => i.id)).toContain('guard:no-high-stream');
  });

  it('model 覆盖与原始字段覆盖', () => {
    const b = buildRequest(demoProvider, demoModel, ev({ modelOverride: 'ep-123', rawOverrides: { tools: [{ type: 'web_search' }] } }), {}, 'send');
    expect(b.body.model).toBe('ep-123');
    expect(b.body.tools).toEqual([{ type: 'web_search' }]);
  });

  it('预览按估算字节计算体积，超限报错', () => {
    const big = { a1: { wire: 'data:image/png;base64,…', preview: '…', bytes: 5000 } };
    const b = buildRequest(demoProvider, demoModel, ev({ slots, prompt: 'x {{ref:a1}}' }), big, 'preview');
    expect(b.bodyBytes).toBeGreaterThan(5000);
    expect(b.issues.map((i) => i.id)).toContain('body:too-large');
  });
});

describe('尺寸自动回退', () => {
  it('模型不支持自定义宽高时回退到默认预设并提示', async () => {
    const { demoModel: m, demoProvider: p, input: inp } = await import('./fixtures.js');
    const sizeField = m.fields.find((f) => f.key === 'size')!;
    const noCustom = { ...m, fields: m.fields.map((f) => (f.key === 'size' && f.type === 'size' ? { ...f, spec: () => ({ ...sizeField.type === 'size' ? sizeField.spec({} as never) : ({} as never), custom: undefined }) } : f)) } as typeof m;
    const r = evaluate(p, noCustom, inp({ values: { size: { mode: 'custom', width: 64, height: 64 } } }));
    expect(r.fields.size!.value).toEqual({ mode: 'preset', value: '1K' });
    expect(r.fields.size!.adjusted?.zh).toContain('不支持自定义');
    expect(r.canSubmit).toBe(true);
  });
});
