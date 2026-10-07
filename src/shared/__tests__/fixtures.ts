import type { FormInput, ModelDef, ProviderDef } from '../catalog/types.js';
import { T } from '../catalog/helpers.js';

/** 测试用的假服务商：覆盖锁定、显隐、枚举可用性、尺寸、素材槽、wireGuard */
export const demoModel: ModelDef = {
  id: 'demo/m1',
  providerId: 'byteplus',
  apiModel: 'demo-model-001',
  family: 'demo',
  label: T('演示模型', 'Demo model'),
  output: 'image',
  kind: 'sync',
  lifecycle: { status: 'active' },
  docs: [],
  endpoints: { submit: 'gen', stream: 'gen.stream' },
  allowModelOverride: true,
  modes: [
    {
      id: 'basic',
      label: T('基础', 'Basic'),
      slots: [
        { id: 'image', kind: 'image', label: T('参考图', 'Reference'), min: 0, max: 2, sources: ['local', 'url'], spec: { formats: ['png', 'jpeg'], maxBytes: 1000, side: [10, 100] } },
      ],
      prompt: { required: true, maxChars: 20, softMax: { zhChars: 5, enWords: 3 } },
    },
    {
      id: 'locked',
      label: T('锁定', 'Locked'),
      slots: [],
      prompt: { required: false },
      locked: { quality: { value: 'high', reason: T('该模式只能高质量', 'High only') } },
      wire: { special: true },
    },
  ],
  fields: [
    { key: 'quality', type: 'enum', label: T('质量', 'Quality'), group: 'basic', wire: 'quality', default: 'std', options: [{ value: 'std' }, { value: 'high' }, { value: 'fast', unavailable: (c) => (c.values.stream ? T('流式下不可用', 'not with stream') : null) }] },
    { key: 'stream', type: 'bool', label: T('流式', 'Stream'), group: 'output', wire: 'stream', default: false },
    { key: 'n', type: 'int', label: T('张数', 'Count'), group: 'basic', wire: 'options.n', default: 1, min: 1, max: 4 },
    { key: 'frames', type: 'int', label: T('帧数', 'Frames'), group: 'advanced', wire: 'frames', default: null, min: 29, max: 289, pattern: { base: 25, step: 4 }, send: 'if-set' },
    { key: 'seed', type: 'seed', label: T('种子', 'Seed'), group: 'advanced', wire: 'seed', default: null, min: -1, max: 2147483647 },
    { key: 'onlyBasic', type: 'bool', label: T('仅基础', 'Basic only'), group: 'advanced', wire: 'only_basic', default: true, modes: ['basic'] },
    { key: 'hiddenWhenStream', type: 'text', label: T('隐藏', 'Hidden'), group: 'advanced', wire: 'note', default: 'x', visible: (c) => !c.values.stream },
    { key: 'disabled', type: 'bool', label: T('禁用', 'Disabled'), group: 'advanced', wire: 'disabled', default: true, disabled: () => T('永远禁用', 'always') },
    {
      key: 'size',
      type: 'size',
      label: T('尺寸', 'Size'),
      group: 'basic',
      wire: null,
      default: { mode: 'preset', value: '1K' },
      spec: () => ({
        presets: [{ value: '1K' }, { value: '2K' }],
        custom: { minPixels: 100, maxPixels: 10_000, aspect: [0.5, 2], multipleOf: 8 },
        toWire: (v) => ({ size: v.mode === 'preset' ? v.value : `${v.width}x${v.height}` }),
      }),
      fragment: (v) => ({ size: v.mode === 'preset' ? v.value : `${v.width}x${v.height}` }),
    },
  ],
  constraints: [
    { id: 'C-DEMO-1', severity: 'warn', check: (c) => (c.effective.n === 4 ? { message: T('4 张较慢', '4 is slow'), fields: ['n'] } : null) },
  ],
  wireGuards: [{ id: 'no-high-stream', check: (body) => (body.quality === 'high' && body.stream === true ? T('高质量不能流式', 'no high+stream') : null) }],
  adapter: {
    compose: (c) => {
      const images = Object.keys(c.refOrder).map((id) => c.resolved[id]?.wire ?? '');
      return { model: c.model.apiModel, prompt: c.renderedPrompt, ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}) };
    },
    normalizeSubmit: () => ({ kind: 'sync', status: 'succeeded', assets: [], failures: [] }),
  },
};

export const demoProvider: ProviderDef = {
  id: 'byteplus',
  label: T('演示', 'Demo'),
  baseUrls: [{ id: 'x', label: T('x', 'x'), url: 'https://example.invalid/api', default: true }],
  auth: { scheme: 'bearer', keyHelpUrl: 'https://example.invalid' },
  endpoints: {
    gen: { id: 'gen', method: 'POST', path: '/gen', timeoutMs: 1000, retry: 'none' },
    'gen.stream': { id: 'gen.stream', method: 'POST', path: '/gen', timeoutMs: 1000, retry: 'none', stream: true },
  },
  limits: { maxRequestBytes: 2000 },
  models: [demoModel],
  normalizeError: () => null,
};

export function input(over: Partial<FormInput> = {}): FormInput {
  return { providerId: 'byteplus', modelId: 'demo/m1', modeId: 'basic', values: {}, slots: {}, prompt: 'cat', ...over };
}
