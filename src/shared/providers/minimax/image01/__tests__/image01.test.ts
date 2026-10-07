import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef, FormInput, ModelDef, ResolvedAssets } from '../../../../catalog/types.js';
import { MB } from '../../../../catalog/helpers.js';
import { base64Size } from '../../../../engine/media.js';
import { evaluate } from '../../../../engine/evaluate.js';
import { buildRequest } from '../../../../request/build.js';
import { getModel } from '../../../registry.js';
import { minimax } from '../../index.js';
import { RESULT_URL_TTL_MS } from '../adapter.js';
import { IMAGE01_ID, IMAGE01_LIVE_ID, IMAGE01_MODELS } from '../index.js';
import { SUBJECT_LIMIT_BYTES } from '../spec.js';
// 官方 T2I / I2I OpenAPI（docs/api-reference/image/generation/api/*.json）components.schemas.*.example 原样摘录
import i2iRequest from '../__fixtures__/i2i.request.json';
import responseUrl from '../__fixtures__/response.url.json';
import t2iRequest from '../__fixtures__/t2i.request.json';

const modelOf = (id: string): ModelDef => {
  const m = IMAGE01_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
};
const M01 = modelOf(IMAGE01_ID);
const LIVE = modelOf(IMAGE01_LIVE_ID);

const input = (m: ModelDef, over: Partial<FormInput> = {}): FormInput => ({ providerId: 'minimax', modelId: m.id, modeId: 't2i', values: {}, slots: {}, prompt: 'a cat', ...over });
const ev = (m: ModelDef, over: Partial<FormInput> = {}) => evaluate(minimax, m, input(m, over));
const build = (m: ModelDef, over: Partial<FormInput> = {}, resolved: ResolvedAssets = {}) => buildRequest(minimax, m, ev(m, over), resolved, 'send');
const ids = (r: { issues: { id: string }[] }) => r.issues.map((i) => i.id);

const FACE_URL = 'https://example.com/face.jpg';
const urlFace = (url = FACE_URL, bytes?: number): AssetRef => ({ id: 'face', source: { type: 'url', url }, meta: { kind: 'image', mime: 'image/jpeg', ...(bytes !== undefined ? { bytes } : {}) } });
const localFace = (bytes: number, mime = 'image/png', id = 'face'): AssetRef => ({
  id,
  source: { type: 'local', assetId: `a-${id}`, filename: 'face.png', mime, bytes },
  meta: { kind: 'image', mime, bytes, width: 1024, height: 1024 },
});
const outputFace = (bytes: number, remote: { url?: string; expiresAt?: number } = {}, mime = 'image/jpeg'): AssetRef => ({
  id: 'face',
  source: { type: 'task-output', taskId: 't1', index: 0, ...(remote.url ? { remoteUrl: remote.url } : {}), ...(remote.expiresAt !== undefined ? { remoteExpiresAt: remote.expiresAt } : {}), mime },
  meta: { kind: 'image', mime, bytes, width: 1024, height: 1024 },
});
const resolvedFace = (wire = FACE_URL): ResolvedAssets => ({ face: { wire, preview: wire, bytes: wire.length } });
const subject = (face: AssetRef = urlFace(), over: Partial<FormInput> = {}): Partial<FormInput> => ({ modeId: 'subject', slots: { subject: [face] }, ...over });
const preset = (value: string) => ({ mode: 'preset', value });
const custom = (width: number, height: number) => ({ mode: 'custom', width, height });

describe('目录声明', () => {
  it('两个模型挂在 minimax 下，走同步 image.generate', () => {
    expect(IMAGE01_MODELS.map((m) => m.id)).toEqual(['minimax/image-01', 'minimax/image-01-live']);
    expect(IMAGE01_MODELS.map((m) => m.apiModel)).toEqual(['image-01', 'image-01-live']);
    for (const m of IMAGE01_MODELS) {
      expect(getModel(m.id)?.provider.id).toBe('minimax');
      expect(m).toMatchObject({ providerId: 'minimax', output: 'image', kind: 'sync', endpoints: { submit: 'image.generate' } });
      expect(minimax.endpoints[m.endpoints.submit]).toMatchObject({ method: 'POST', path: '/v1/image_generation' });
      expect(m.docs.length).toBeGreaterThan(0);
    }
  });

  it('模式：image-01 两个模式都开放；image-01-live 两个模式都实验，文生图另默认隐藏', () => {
    expect(M01.modes.map((m) => [m.id, !!m.experimental, !!m.hiddenByDefault])).toEqual([
      ['t2i', false, false],
      ['subject', false, false],
    ]);
    expect(LIVE.modes.map((m) => [m.id, !!m.experimental, !!m.hiddenByDefault])).toEqual([
      ['subject', true, false],
      ['t2i', true, true],
    ]);
    for (const m of LIVE.modes) expect(m.hint?.zh).toContain('文档冲突');
    expect(LIVE.badges).toEqual([{ zh: '实验', en: 'Experimental' }]);
    expect(M01.badges).toBeUndefined();
  });

  it('字段集合：不含 style / aigc_watermark / negative_prompt', () => {
    for (const m of IMAGE01_MODELS) expect(m.fields.map((f) => f.key)).toEqual(['size', 'n', 'response_format', 'prompt_optimizer', 'seed']);
  });

  it('8 种比例预设带文档像素；只有 image-01 能自定义宽高', () => {
    const spec = (m: ModelDef) => {
      const f = m.fields.find((x) => x.key === 'size');
      if (f?.type !== 'size') throw new Error('no size');
      return f.spec(ev(m).ctx);
    };
    expect(spec(M01).presets).toEqual([
      { value: '1:1', px: [1024, 1024] },
      { value: '16:9', px: [1280, 720] },
      { value: '4:3', px: [1152, 864] },
      { value: '3:2', px: [1248, 832] },
      { value: '2:3', px: [832, 1248] },
      { value: '3:4', px: [864, 1152] },
      { value: '9:16', px: [720, 1280] },
      { value: '21:9', px: [1344, 576] },
    ]);
    expect(spec(M01).custom).toEqual({ side: [512, 2048], multipleOf: 8 });
    expect(spec(LIVE).custom).toBeUndefined();
    expect(spec(M01).toWire(custom(1024, 1536) as never)).toEqual({ width: 1024, height: 1536 });
  });
});

describe('默认请求体黄金快照', () => {
  it('image-01 文生图', () => {
    const b = build(M01);
    expect(b.body).toEqual({ model: 'image-01', prompt: 'a cat', aspect_ratio: '1:1', n: 1, response_format: 'url', prompt_optimizer: false });
    expect(b).toMatchObject({ endpointId: 'image.generate', method: 'POST', path: '/v1/image_generation', stream: false, issues: [] });
    expect(ev(M01).canSubmit).toBe(true);
  });

  it('image-01 主体参考', () => {
    const r = ev(M01, subject());
    expect(r.canSubmit).toBe(true);
    expect(build(M01, subject(), resolvedFace()).body).toEqual({
      model: 'image-01',
      prompt: 'a cat',
      aspect_ratio: '1:1',
      n: 1,
      response_format: 'url',
      prompt_optimizer: false,
      subject_reference: [{ type: 'character', image_file: FACE_URL }],
    });
  });

  it('image-01-live 主体参考', () => {
    expect(ev(LIVE, subject()).canSubmit).toBe(true);
    expect(build(LIVE, subject(), resolvedFace()).body).toEqual({
      model: 'image-01-live',
      prompt: 'a cat',
      aspect_ratio: '1:1',
      n: 1,
      response_format: 'url',
      prompt_optimizer: false,
      subject_reference: [{ type: 'character', image_file: FACE_URL }],
    });
  });

  it('image-01-live 文生图（实验）', () => {
    const r = ev(LIVE);
    expect(r.canSubmit).toBe(true);
    expect(build(LIVE).body).toEqual({ model: 'image-01-live', prompt: 'a cat', aspect_ratio: '1:1', n: 1, response_format: 'url', prompt_optimizer: false });
  });

  it('本地素材以 Data URL 写入 image_file', () => {
    const wire = 'data:image/png;base64,iVBORw0KGgo=';
    expect(build(M01, subject(localFace(1000)), resolvedFace(wire)).body.subject_reference).toEqual([{ type: 'character', image_file: wire }]);
  });
});

describe('官方请求示例', () => {
  it('T2I 示例可由表单原样构造', () => {
    const b = build(M01, { prompt: t2iRequest.prompt, values: { size: preset('16:9'), n: 3, prompt_optimizer: true, response_format: 'url' } });
    expect(b.body).toEqual(t2iRequest);
  });

  it('I2I 示例：多出的只是显式发送的默认值', () => {
    const url = i2iRequest.subject_reference[0]!.image_file;
    const b = build(M01, subject(urlFace(url), { prompt: i2iRequest.prompt, values: { size: preset('16:9'), n: 2 } }), resolvedFace(url));
    expect(b.body).toEqual({ ...i2iRequest, response_format: 'url', prompt_optimizer: false });
  });
});

describe('尺寸', () => {
  it.each(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'])('预设 %s → aspect_ratio，不发宽高', (v) => {
    const b = build(M01, { values: { size: preset(v) } });
    expect(b.body.aspect_ratio).toBe(v);
    expect(b.body).not.toHaveProperty('width');
    expect(b.body).not.toHaveProperty('height');
  });

  it('自定义宽高 → width/height，不发 aspect_ratio', () => {
    const r = ev(M01, { values: { size: custom(1024, 1536) } });
    expect(r.canSubmit).toBe(true);
    const b = build(M01, { values: { size: custom(1024, 1536) } });
    expect(b.body).toEqual({ model: 'image-01', prompt: 'a cat', width: 1024, height: 1536, n: 1, response_format: 'url', prompt_optimizer: false });
    expect(b.issues).toEqual([]);
  });

  it('自定义宽高边界：[512, 2048] 且 8 的倍数', () => {
    expect(ev(M01, { values: { size: custom(512, 2048) } }).canSubmit).toBe(true);
    expect(ids(ev(M01, { values: { size: custom(504, 1024) } }))).toContain('size-custom:size');
    expect(ids(ev(M01, { values: { size: custom(2056, 1024) } }))).toContain('size-custom:size');
    expect(ids(ev(M01, { values: { size: custom(1030, 1024) } }))).toContain('size-custom:size');
  });

  it('image-01-live 不接受自定义宽高：自动回退到默认比例并提示', () => {
    const r = ev(LIVE, subject(urlFace(), { values: { size: custom(1024, 1024) } }));
    expect(ids(r)).not.toContain('size-custom:size');
    expect(r.fields.size!.value).toMatchObject({ mode: 'preset' });
    expect(r.fields.size!.adjusted).toBeDefined();
  });

  it('不在列表里的比例报错', () => {
    expect(ids(ev(M01, { values: { size: preset('5:4') } }))).toContain('size-preset:size');
  });
});

describe('其他字段', () => {
  it('n：1–9 的整数', () => {
    expect(ev(M01, { values: { n: 9 } }).canSubmit).toBe(true);
    expect(build(M01, { values: { n: 9 } }).body.n).toBe(9);
    expect(ids(ev(M01, { values: { n: 0 } }))).toContain('range:n');
    expect(ids(ev(M01, { values: { n: 10 } }))).toContain('range:n');
    expect(ids(ev(M01, { values: { n: 1.5 } }))).toContain('int:n');
  });

  it('seed：null 不发送；硬范围只限 JS 安全整数，范围未核实不硬拦', () => {
    expect(build(M01).body).not.toHaveProperty('seed');
    expect(build(M01, { values: { seed: 42 } }).body.seed).toBe(42);
    expect(ev(M01, { values: { seed: 0 } }).canSubmit).toBe(true);
    expect(ev(M01, { values: { seed: -1 } }).canSubmit).toBe(true);
    expect(ev(M01, { values: { seed: 2147483648 } }).canSubmit).toBe(true);
    expect(build(M01, { values: { seed: 2147483648 } }).body.seed).toBe(2147483648);
    expect(ids(ev(M01, { values: { seed: Number.MAX_SAFE_INTEGER + 2 } }))).toContain('range:seed');
    expect(ids(ev(M01, { values: { seed: 1.5 } }))).toContain('int:seed');
  });

  it('response_format：base64 可选，未知值回退 url', () => {
    expect(build(M01, { values: { response_format: 'base64' } }).body.response_format).toBe('base64');
    const r = ev(M01, { values: { response_format: 'b64_json' } });
    expect(r.fields.response_format!.value).toBe('url');
    expect(r.fields.response_format!.adjusted).toBeDefined();
  });

  it('prompt_optimizer：默认 false，可开启', () => {
    expect(build(M01, { values: { prompt_optimizer: true } }).body.prompt_optimizer).toBe(true);
  });
});

describe('提示词', () => {
  it('必填（两种模式）', () => {
    expect(ids(ev(M01, { prompt: '  ' }))).toContain('prompt:required');
    expect(ids(ev(LIVE, subject(urlFace(), { prompt: '' })))).toContain('prompt:required');
  });

  it('硬上限 1500 字符', () => {
    expect(ev(M01, { prompt: 'a'.repeat(1500) }).canSubmit).toBe(true);
    expect(ids(ev(M01, { prompt: 'a'.repeat(1501) }))).toContain('prompt:max');
  });
});

describe('主体参考槽位', () => {
  it('文生图模式没有素材槽，compose 不写 subject_reference', () => {
    expect(ids(ev(M01, { slots: { subject: [urlFace()] } }))).toContain('slot-unknown:subject');
    expect(build(M01, {}, resolvedFace()).body).not.toHaveProperty('subject_reference');
  });

  it('恰好 1 张', () => {
    expect(ids(ev(M01, { modeId: 'subject', slots: {} }))).toContain('slot-min:subject');
    expect(ids(ev(M01, { modeId: 'subject', slots: { subject: [localFace(1000, 'image/png', 'a'), localFace(1000, 'image/png', 'b')] } }))).toContain('slot-max:subject');
  });

  it('格式只收 jpeg / png（jpg 归一为 jpeg）', () => {
    expect(ev(M01, subject(localFace(1000, 'image/jpg'))).canSubmit).toBe(true);
    expect(ev(M01, subject(localFace(1000, 'image/png'))).canSubmit).toBe(true);
    expect(ids(ev(M01, subject(localFace(1000, 'image/webp'))))).toContain('asset:subject:0');
    expect(ids(ev(M01, subject(localFace(1000, 'image/gif'))))).toContain('asset:subject:0');
  });

  it('小于 10MB：MB 单位未核实，取 10^7 字节', () => {
    expect(SUBJECT_LIMIT_BYTES).toBe(10_000_000);
    expect(ids(ev(M01, subject(localFace(9_999_999))))).not.toContain('asset:subject:0');
    expect(ids(ev(M01, subject(localFace(10_000_000))))).toContain('asset:subject:0');
    expect(ids(ev(M01, subject(localFace(10 * MB - 1))))).toContain('asset:subject:0');
  });

  it('来源：local / url / task-output，其余拒绝', () => {
    expect(ev(M01, subject(outputFace(1000))).canSubmit).toBe(true);
    const asset: AssetRef = { id: 'face', source: { type: 'provider-file', uri: 'mm_file://1' } };
    expect(ids(ev(M01, subject(asset)))).toContain('asset:subject:0');
  });
});

describe('约束', () => {
  afterEach(() => vi.restoreAllMocks());

  it('C-MM-IMG-1：image-01-live 文生图给文档冲突警告', () => {
    expect(ev(LIVE).issues.find((i) => i.id === 'C-MM-IMG-1')?.severity).toBe('warn');
    expect(ids(ev(LIVE, subject()))).not.toContain('C-MM-IMG-1');
    expect(ids(ev(M01))).not.toContain('C-MM-IMG-1');
  });

  it('C-MM-IMG-2：Data URL 发送且编码后 ≥10^7 字节时警告', () => {
    expect(ev(M01, subject(localFace(8 * MB))).issues.find((i) => i.id === 'C-MM-IMG-2')).toMatchObject({ severity: 'warn', slots: ['subject'] });
    expect(ids(ev(M01, subject(localFace(7 * MB))))).not.toContain('C-MM-IMG-2');
    // 边界：编码后恰好 10^7 字节
    expect(base64Size(7_500_000)).toBe(10_000_000);
    expect(ids(ev(M01, subject(localFace(7_500_000))))).toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(localFace(7_499_997))))).not.toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(urlFace(FACE_URL, 8 * MB))))).not.toContain('C-MM-IMG-2');
    expect(ids(ev(M01, { values: {} }))).not.toContain('C-MM-IMG-2');
  });

  it('C-MM-IMG-2：历史输出是否内联与素材解析器一致（原始链接剩余 > 3 小时才直接用）', () => {
    const now = Date.UTC(2026, 9, 8);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const out = 'https://example.com/out.jpeg';
    const h = 3600_000;
    expect(ids(ev(M01, subject(outputFace(8 * MB))))).toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(outputFace(8 * MB, { url: out }))))).toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(outputFace(8 * MB, { url: out, expiresAt: now + 2 * h }))))).toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(outputFace(8 * MB, { url: out, expiresAt: now + 3 * h }))))).toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(outputFace(8 * MB, { url: out, expiresAt: now + 3 * h + 1 }))))).not.toContain('C-MM-IMG-2');
    expect(ids(ev(M01, subject(outputFace(8 * MB, { url: out, expiresAt: now + 20 * h }))))).not.toContain('C-MM-IMG-2');
  });

  it('C-MM-IMG-3：多字节提示词按字节会超 1500 时警告', () => {
    expect(ev(M01, { prompt: '猫'.repeat(600) }).issues.find((i) => i.id === 'C-MM-IMG-3')).toMatchObject({ severity: 'warn', fields: ['prompt'] });
    expect(ev(M01, { prompt: '猫'.repeat(600) }).canSubmit).toBe(true);
    expect(ids(ev(M01, { prompt: '猫'.repeat(400) }))).not.toContain('C-MM-IMG-3');
    expect(ids(ev(M01, { prompt: 'a'.repeat(1500) }))).not.toContain('C-MM-IMG-3');
    const over = ids(ev(M01, { prompt: '猫'.repeat(1501) }));
    expect(over).toContain('prompt:max');
    expect(over).not.toContain('C-MM-IMG-3');
  });

  it('C-MM-IMG-5：image-01-live 主体参考给文档冲突警告', () => {
    expect(ev(LIVE, subject()).issues.find((i) => i.id === 'C-MM-IMG-5')?.severity).toBe('warn');
    expect(ev(LIVE, subject()).canSubmit).toBe(true);
    expect(ids(ev(LIVE))).not.toContain('C-MM-IMG-5');
    expect(ids(ev(M01, subject()))).not.toContain('C-MM-IMG-5');
  });

  it('C-MM-IMG-6：PNG 参考图以 Data URL 内联发送时提示', () => {
    expect(ev(M01, subject(localFace(1000, 'image/png'))).issues.find((i) => i.id === 'C-MM-IMG-6')).toMatchObject({ severity: 'info', slots: ['subject'] });
    expect(ids(ev(M01, subject(outputFace(1000, {}, 'image/png'))))).toContain('C-MM-IMG-6');
    expect(ids(ev(M01, subject(localFace(1000, 'image/jpeg'))))).not.toContain('C-MM-IMG-6');
    const pngUrl: AssetRef = { id: 'face', source: { type: 'url', url: 'https://example.com/face.png' }, meta: { kind: 'image', mime: 'image/png' } };
    expect(ids(ev(M01, subject(pngUrl)))).not.toContain('C-MM-IMG-6');
    expect(ids(ev(M01))).not.toContain('C-MM-IMG-6');
  });

  it('C-MM-IMG-7：seed 超出自拟的 0–2147483647 时警告', () => {
    for (const seed of [-1, 2147483648]) {
      expect(ev(M01, { values: { seed } }).issues.find((i) => i.id === 'C-MM-IMG-7')).toMatchObject({ severity: 'warn', fields: ['seed'] });
    }
    for (const seed of [0, 2147483647, null]) expect(ids(ev(M01, { values: { seed } }))).not.toContain('C-MM-IMG-7');
  });

  it('C-MM-IMG-8：image-01-live 价格未说明时提示（两种模式）', () => {
    expect(ev(LIVE).issues.find((i) => i.id === 'C-MM-IMG-8')?.severity).toBe('info');
    expect(ids(ev(LIVE, subject()))).toContain('C-MM-IMG-8');
    expect(ids(ev(M01))).not.toContain('C-MM-IMG-8');
  });

  it('C-MM-IMG-4：主体参考提示词里引用素材时警告', () => {
    const withRef = subject(urlFace(), { prompt: '{{ref:face}} 站在海边' });
    expect(ev(M01, withRef).issues.find((i) => i.id === 'C-MM-IMG-4')?.severity).toBe('warn');
    expect(build(M01, withRef, resolvedFace()).body.prompt).toBe('Image 1 站在海边');
    expect(ids(ev(M01, subject()))).not.toContain('C-MM-IMG-4');
  });
});

describe('wireGuard', () => {
  const guards = (b: { issues: { id: string }[] }) => ids(b).filter((i) => i.startsWith('guard:'));

  it('正常请求体不触发', () => {
    expect(guards(build(M01))).toEqual([]);
    expect(guards(build(M01, { values: { size: custom(1024, 1024) } }))).toEqual([]);
    expect(guards(build(M01, subject(), resolvedFace()))).toEqual([]);
  });

  it('mm-img-size-pair：width / height 必须成对', () => {
    expect(guards(build(M01, { values: { size: custom(1024, 1024) }, rawOverrides: { height: null } }))).toEqual(['guard:mm-img-size-pair']);
  });

  it('mm-img-size-exclusive：自定义宽高与 aspect_ratio 不能并存', () => {
    expect(guards(build(M01, { values: { size: custom(1024, 1024) }, rawOverrides: { aspect_ratio: '1:1' } }))).toEqual(['guard:mm-img-size-exclusive']);
  });

  it('mm-img-custom-size-model：width/height 只对 image-01 生效', () => {
    expect(guards(build(LIVE, { rawOverrides: { aspect_ratio: null, width: 1024, height: 1024 } }))).toEqual(['guard:mm-img-custom-size-model']);
    expect(guards(build(LIVE, subject(urlFace(), { rawOverrides: { width: 1024, height: 1024 } }), resolvedFace()))).toEqual(['guard:mm-img-size-exclusive', 'guard:mm-img-custom-size-model']);
    expect(guards(build(M01, { values: { size: custom(1024, 1024) }, rawOverrides: { model: 'image-01-live' } }))).toEqual(['guard:mm-img-custom-size-model']);
    expect(guards(build(LIVE))).toEqual([]);
  });

  it('mm-img-single-subject：只能 1 张主体参考', () => {
    const two = [
      { type: 'character', image_file: 'https://example.com/a.jpg' },
      { type: 'character', image_file: 'https://example.com/b.jpg' },
    ];
    expect(guards(build(M01, subject(urlFace(), { rawOverrides: { subject_reference: two } }), resolvedFace()))).toEqual(['guard:mm-img-single-subject']);
  });
});

describe('适配器 normalizeSubmit', () => {
  const T0 = Date.UTC(2026, 9, 8);
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });
  const ok = { base_resp: { status_code: 0, status_msg: 'success' } };
  const parse = (r: ReturnType<typeof res>) => M01.adapter.normalizeSubmit(r);
  afterEach(() => vi.restoreAllMocks());

  it('官方示例响应：计数字符串转数字，url 带 24h 过期', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0);
    const asset = (index: number) => ({ index, role: 'image', kind: 'image', source: { type: 'url', url: 'XXX', expiresAt: T0 + RESULT_URL_TTL_MS } });
    expect(parse(res(200, responseUrl))).toEqual({
      kind: 'sync',
      status: 'succeeded',
      assets: [asset(0), asset(1), asset(2)],
      failures: [],
      usage: { failed_count: 0, success_count: 3 },
    });
    expect(RESULT_URL_TTL_MS).toBe(24 * 3600 * 1000);
  });

  it('base64：只按文件头识别 jpeg / png，识别不出不标 mime', () => {
    const r = parse(res(200, { id: 't', data: { image_base64: ['/9j/4AAQSkZJRg==', 'iVBORw0KGgoAAAANSUhEUg==', 'UklGRiQAAABXRUJQ'] }, metadata: { success_count: 3, failed_count: 0 }, ...ok }));
    expect(r).toEqual({
      kind: 'sync',
      status: 'succeeded',
      assets: [
        { index: 0, role: 'image', kind: 'image', source: { type: 'b64', data: '/9j/4AAQSkZJRg==', mime: 'image/jpeg' }, mime: 'image/jpeg' },
        { index: 1, role: 'image', kind: 'image', source: { type: 'b64', data: 'iVBORw0KGgoAAAANSUhEUg==', mime: 'image/png' }, mime: 'image/png' },
        { index: 2, role: 'image', kind: 'image', source: { type: 'b64', data: 'UklGRiQAAABXRUJQ' } },
      ],
      failures: [],
      usage: { success_count: 3, failed_count: 0 },
    });
  });

  it('success_count 多于实际返回张数 → partial，差额记为位置未知的失败', () => {
    const r = parse(res(200, { id: 'trace-2', data: { image_urls: ['https://x/1.jpeg'] }, metadata: { failed_count: '1', success_count: '3' }, ...ok }));
    if (r.kind !== 'sync') throw new Error('expected sync');
    expect(r.status).toBe('partial');
    expect(r.failures.map((f) => [f.index, f.error.category, f.error.code])).toEqual([
      [-1, 'content_policy', 'failed_count'],
      [-1, 'unknown', 'COUNT_MISMATCH'],
      [-1, 'unknown', 'COUNT_MISMATCH'],
    ]);
    expect(r.failures[1]!.error).toMatchObject({ requestId: 'trace-2', retryable: false, message: 'metadata.success_count=3 but 1 image(s) returned' });
    // 计数一致或少于返回张数时不追加
    const same = parse(res(200, { data: { image_urls: ['u1', 'u2'] }, metadata: { success_count: '1' }, ...ok }));
    expect(same).toMatchObject({ status: 'succeeded', failures: [] });
  });

  it('部分被审核拦截 → partial，failures 记数量、位置未知', () => {
    const r = parse(res(200, { id: 'trace-1', data: { image_urls: ['https://x/1.jpeg', 'https://x/2.jpeg'] }, metadata: { failed_count: '1', success_count: '2' }, ...ok }));
    if (r.kind !== 'sync') throw new Error('expected sync');
    expect(r.status).toBe('partial');
    expect(r.assets.map((a) => a.index)).toEqual([0, 1]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ index: -1, error: { providerId: 'minimax', category: 'content_policy', code: 'failed_count', requestId: 'trace-1', retryable: false } });
    expect(r.usage).toEqual({ failed_count: 1, success_count: 2 });
  });

  it('全部被拦截 → failed + content_policy', () => {
    const r = parse(res(200, { data: { image_urls: [] }, metadata: { failed_count: '2', success_count: '0' }, ...ok }));
    if (r.kind !== 'sync') throw new Error('expected sync');
    expect(r).toMatchObject({ status: 'failed', assets: [], error: { category: 'content_policy' } });
    expect(r.failures).toHaveLength(2);
  });

  it('异常 failed_count 不会撑出超长数组', () => {
    const r = parse(res(200, { data: { image_urls: ['u'] }, metadata: { failed_count: '50' }, ...ok }));
    if (r.kind !== 'sync') throw new Error('expected sync');
    expect(r.failures).toHaveLength(9);
    expect(r.usage).toEqual({ failed_count: 50 });
  });

  it('HTTP 200 + base_resp 业务错误 → kind:error', () => {
    const e = parse(res(200, { data: null, base_resp: { status_code: 1026, status_msg: 'input new_sensitive' } }, { 'trace-id': 'tr-9' }));
    expect(e).toMatchObject({ kind: 'error', error: { category: 'content_policy', code: '1026', httpStatus: 200, requestId: 'tr-9' } });
    expect(parse(res(200, { base_resp: { status_code: 2013, status_msg: 'invalid params' } }))).toMatchObject({ kind: 'error', error: { category: 'invalid_param' } });
    expect(parse(res(200, { base_resp: { status_code: 1004, status_msg: 'not authorized' } }))).toMatchObject({ kind: 'error', error: { category: 'auth' } });
  });

  it('非 200 / 非 JSON / 无图片', () => {
    expect(parse(res(502, 'Bad Gateway'))).toMatchObject({ kind: 'error', error: { category: 'upstream_5xx', retryable: true } });
    expect(parse(res(200, '<html>oops</html>'))).toMatchObject({ kind: 'error', error: { code: 'BAD_RESPONSE', httpStatus: 200 } });
    expect(parse(res(200, { id: 'x', data: {}, ...ok }))).toMatchObject({ kind: 'sync', status: 'failed', assets: [], failures: [], error: { code: 'BAD_RESPONSE', requestId: 'x' } });
  });
});

describe('费用估算', () => {
  it('image-01：$0.0035/张 × n，按标价', () => {
    expect(M01.estimateCost!(ev(M01).ctx)).toEqual({ amount: 0.0035, currency: 'USD', basis: { zh: '$0.0035/张 × 1', en: '$0.0035/image × 1' }, confidence: 'list-price' });
    expect(M01.estimateCost!(ev(M01, { values: { n: 3 } }).ctx)?.amount).toBe(0.0105);
    expect(M01.estimateCost!(ev(M01, { values: { n: 9 } }).ctx)?.amount).toBe(0.0315);
  });

  it('image-01-live：价格未说明，不估算', () => {
    expect(LIVE.estimateCost).toBeUndefined();
  });
});
