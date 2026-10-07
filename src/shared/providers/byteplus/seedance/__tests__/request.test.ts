import { describe, expect, it } from 'vitest';
import type { FormInput, MediaKind, ResolvedAssets } from '../../../../catalog/types.js';
import { byteplus } from '../../index.js';
import { SEEDANCE_MODELS } from '../index.js';
import { OFFICIAL_DRAFT_CONTENT } from '../__fixtures__/responses.js';
import {
  OFFICIAL_CREATE_15,
  OFFICIAL_CREATE_15_LEGACY,
  OFFICIAL_S25_DRAFT_STEP1,
  OFFICIAL_S25_DRAFT_STEP2,
  OFFICIAL_S25_EDIT_AUTO,
  OFFICIAL_S25_FIRST_LAST,
  OFFICIAL_TUT_15_DRAFT_STEP1,
  OFFICIAL_TUT_15_DRAFT_STEP2,
} from '../__fixtures__/official.js';
import { ALL, V10, V10F, V15, V1X, V20, V20F, V20M, V20S, V25, aud, draftFrom, evalForm, img, issueIds, model, run, vid, wireOf } from './helpers.js';

type Obj = Record<string, unknown>;
const TEXT = { type: 'text', text: 'a cat' };
const COMMON = { watermark: false, return_last_frame: false, service_tier: 'default', execution_expires_after: 172800 };

describe('默认请求体黄金快照（t2v，提示词 "a cat"）', () => {
  it.each([
    [V25, { model: 'dreamina-seedance-2-5-260628', content: [TEXT], resolution: '720p', ratio: 'adaptive', duration: -1, generate_audio: true, output_format: 'mp4', priority: 0, ...COMMON }],
    // 2.0 系列：ratio=adaptive 是 API 默认值，因 S20 页未列 adaptive 而不发送
    [V20, { model: 'dreamina-seedance-2-0-260128', content: [TEXT], resolution: '720p', duration: 5, generate_audio: true, priority: 0, ...COMMON }],
    [V20F, { model: 'dreamina-seedance-2-0-fast-260128', content: [TEXT], resolution: '720p', duration: 5, generate_audio: true, priority: 0, ...COMMON }],
    [V20M, { model: 'dreamina-seedance-2-0-mini-260615', content: [TEXT], resolution: '720p', duration: 5, generate_audio: true, priority: 0, ...COMMON }],
    [V15, { model: 'seedance-1-5-pro-251215', content: [TEXT], resolution: '720p', ratio: 'adaptive', duration: 5, generate_audio: true, camera_fixed: false, ...COMMON }],
    [V10, { model: 'seedance-1-0-pro-250528', content: [TEXT], resolution: '1080p', ratio: '16:9', duration: 5, camera_fixed: false, ...COMMON }],
    [V10F, { model: 'seedance-1-0-pro-fast-251015', content: [TEXT], resolution: '1080p', ratio: '16:9', duration: 5, camera_fixed: false, ...COMMON }],
  ])('%s', (id, expected) => {
    const { ev, built, body } = run(id);
    expect(body).toEqual(expected);
    // 1.5 pro 只多一条 lifecycle 提示
    expect(issueIds(ev)).toEqual(id === V15 ? ['lifecycle'] : []);
    expect(built.issues).toEqual([]);
    expect(built).toMatchObject({ endpointId: 'video.create', method: 'POST', path: '/contents/generations/tasks', stream: false });
  });
});

describe('模型注册与能力矩阵', () => {
  it('7 个模型注册进 BytePlus，endpoint 都在服务商白名单里', () => {
    expect(SEEDANCE_MODELS.map((m) => m.id)).toEqual(ALL);
    for (const m of SEEDANCE_MODELS) {
      expect(byteplus.models).toContain(m);
      expect(m).toMatchObject({ providerId: 'byteplus', family: 'seedance', kind: 'async', output: 'video', allowModelOverride: true });
      expect(m.endpoints).toEqual({ submit: 'video.create', get: 'video.get', cancel: 'video.delete', list: 'video.list' });
      for (const ep of Object.values(m.endpoints)) expect(byteplus.endpoints[ep]).toBeDefined();
      expect(m.adapter.normalizeTask).toBeTypeOf('function');
      expect(m.docs.length).toBeGreaterThan(0);
    }
  });

  it('1.5 pro 已 Retired 且默认隐藏，note 写明停服日期；其余 active', () => {
    for (const id of ALL) {
      const lc = model(id).lifecycle;
      if (id === V15) {
        expect(lc).toMatchObject({ status: 'retired', hiddenByDefault: true });
        expect(lc.note?.zh).toContain('2026-11-11');
        expect(lc.note?.en).toContain('2026-11-11');
      } else expect(lc).toEqual({ status: 'active' });
    }
  });

  it('徽标：2.0 系列也标"编辑 / 延长（提示词）"，描述里写明', () => {
    const badges = (id: string) => (model(id).badges ?? []).map((b) => b.en);
    expect(badges(V25)).toEqual(['Audio', 'Omni reference', 'Edit / Extend', 'Draft']);
    for (const id of V20S) {
      expect(badges(id)).toEqual(['Audio', 'Omni reference', 'Edit / Extend (via prompt)']);
      expect(model(id).description?.zh).toContain('编辑 / 延长');
    }
    expect(badges(V15)).toEqual(['Audio', 'Draft', 'Flex']);
    for (const id of [V10, V10F]) expect(badges(id)).toEqual(['Flex']);
  });

  it('模式按模型开放；正片模式为派生入口', () => {
    const modes = (id: string) => model(id).modes.map((m) => m.id);
    expect(modes(V25)).toEqual(['t2v', 'i2v_first', 'i2v_first_last', 'omni', 'edit', 'extend', 'draft_final']);
    for (const id of V20S) expect(modes(id)).toEqual(['t2v', 'i2v_first', 'i2v_first_last', 'omni']);
    expect(modes(V15)).toEqual(['t2v', 'i2v_first', 'i2v_first_last', 'draft_final']);
    expect(modes(V10)).toEqual(['t2v', 'i2v_first', 'i2v_first_last']);
    expect(modes(V10F)).toEqual(['t2v', 'i2v_first']);
    for (const id of [V25, V15]) expect(model(id).modes.find((m) => m.id === 'draft_final')?.entry).toBe('derived');
    expect(model(V25).modes.find((m) => m.id === 'draft_final')?.experimental).toBe(true);
  });

  it('字段按模型显隐', () => {
    const has = (id: string, key: string) => model(id).fields.some((f) => f.key === key);
    for (const id of ALL) {
      expect(has(id, 'frames') && has(id, 'lengthMode')).toBe([V10, V10F].includes(id));
      expect(has(id, 'seed') && has(id, 'camera_fixed')).toBe(V1X.includes(id));
      expect(has(id, 'generate_audio')).toBe([V25, ...V20S, V15].includes(id));
      expect(has(id, 'output_format')).toBe(id === V25);
      expect(has(id, 'priority')).toBe([V25, ...V20S].includes(id));
      expect(has(id, 'draft')).toBe([V25, V15].includes(id));
      for (const k of ['resolution', 'ratio', 'duration', 'watermark', 'return_last_frame', 'service_tier', 'execution_expires_after']) expect(has(id, k)).toBe(true);
      // 不暴露：tools、callback_url、safety_identifier、omni_reference_task_type（只由模式 wire 写入）
      for (const k of ['tools', 'callback_url', 'safety_identifier', 'omni_reference_task_type']) expect(model(id).fields.some((f) => f.key === k || f.wire === k)).toBe(false);
    }
  });

  it('文档冲突项：output_format 为实验字段且 mov 徽标写明冲突；2.0 的 adaptive 徽标写明不发送', () => {
    const fmt = model(V25).fields.find((f) => f.key === 'output_format');
    expect(fmt?.experimental).toBe(true);
    expect(fmt?.type === 'enum' ? fmt.options.find((o) => o.value === 'mov')?.badge?.zh : '').toContain('文档冲突');
    for (const id of ALL) {
      const ratio = model(id).fields.find((f) => f.key === 'ratio');
      const badge = ratio?.type === 'enum' ? ratio.options.find((o) => o.value === 'adaptive')?.badge : undefined;
      expect(Boolean(badge)).toBe(V20S.includes(id));
    }
  });

  it('分辨率与时长取值按模型', () => {
    const opts = (id: string) => {
      const f = model(id).fields.find((x) => x.key === 'resolution');
      return f?.type === 'enum' ? f.options.map((o) => o.value) : [];
    };
    expect(opts(V25)).toEqual(['480p', '720p', '1080p']);
    expect(opts(V20)).toEqual(['480p', '720p', '1080p', '4k']);
    for (const id of [V20F, V20M]) expect(opts(id)).toEqual(['480p', '720p']);
    for (const id of V1X) expect(opts(id)).toEqual(['480p', '720p', '1080p']);
    const dur = (id: string) => {
      const f = model(id).fields.find((x) => x.key === 'duration');
      return f?.type === 'int' ? [f.min, f.max, f.default, (f.specials ?? []).map((s) => s.value)] : [];
    };
    expect(dur(V25)).toEqual([4, 30, -1, [-1]]);
    for (const id of V20S) expect(dur(id)).toEqual([4, 15, 5, [-1]]);
    expect(dur(V15)).toEqual([4, 12, 5, [-1]]);
    for (const id of [V10, V10F]) expect(dur(id)).toEqual([2, 12, 5, []]);
  });

  it('素材槽上限与来源：2.5 为 30/10/10，2.0 系列 9/3/3；编辑 / 延长有参考图与参考视频、没有音频', () => {
    const slots = (id: string, mode = 'omni') => model(id).modes.find((m) => m.id === mode)!.slots.map((s) => [s.id, s.role, s.min, s.max]);
    expect(slots(V25)).toEqual([['reference_image', 'reference_image', 0, 30], ['reference_video', 'reference_video', 0, 10], ['reference_audio', 'reference_audio', 0, 10]]);
    for (const mode of ['edit', 'extend']) expect(slots(V25, mode)).toEqual([['reference_image', 'reference_image', 0, 30], ['reference_video', 'reference_video', 1, 10]]);
    for (const id of V20S) expect(slots(id)).toEqual([['reference_image', 'reference_image', 0, 9], ['reference_video', 'reference_video', 0, 3], ['reference_audio', 'reference_audio', 0, 3]]);
    for (const m of SEEDANCE_MODELS) for (const mode of m.modes) for (const s of mode.slots) expect(s.sources).toEqual(['url', 'provider-asset', 'task-output', 'local']);
  });

  it('素材规格按报告：图片 < 30MB、视频 ≤ 200MB、音频 ≤ 15MB；2.5 编辑源视频 4–30 秒', () => {
    const spec = (id: string, mode: string, slot: string) => model(id).modes.find((m) => m.id === mode)!.slots.find((s) => s.id === slot)!.spec;
    expect(spec(V25, 'omni', 'reference_image')).toEqual({ formats: ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'heic', 'heif'], maxBytes: 30 * 1024 * 1024 - 1, side: [300, 6000], aspect: [0.4, 2.5] });
    expect(spec(V25, 'omni', 'reference_video')).toEqual({ formats: ['mp4', 'mov'], maxBytes: 200 * 1024 * 1024, side: [300, 6000], aspect: [0.4, 2.5], pixels: [407696, 8295044], fps: [24, 60], durationSec: [2, 30] });
    expect(spec(V25, 'omni', 'reference_audio')).toEqual({ formats: ['wav', 'mp3'], maxBytes: 15 * 1024 * 1024, durationSec: [2, 30] });
    expect(spec(V25, 'edit', 'reference_video').durationSec).toEqual([4, 30]);
    expect(spec(V25, 'extend', 'reference_video').durationSec).toEqual([2, 30]);
    expect(spec(V25, 'edit', 'reference_image')).toEqual(spec(V25, 'omni', 'reference_image'));
    expect(spec(V20, 'omni', 'reference_video').durationSec).toEqual([2, 15]);
    // heic / heif 只写了 1.5 pro 及之后
    expect(spec(V10, 'i2v_first', 'first_frame').formats).toEqual(['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif']);
  });

  it('提示词：软上限 500 汉字 / 1000 英文单词；2.5 用 @Image n，其余 Image n', () => {
    for (const m of SEEDANCE_MODELS) for (const mode of m.modes.filter((x) => x.id !== 'draft_final')) expect(mode.prompt.softMax).toEqual({ zhChars: 500, enWords: 1000 });
    expect(model(V25).modes[0]!.prompt.refLabel?.('video', 2)).toBe('@Video 2');
    expect(model(V20).modes[0]!.prompt.refLabel?.('audio', 1)).toBe('Audio 1');
  });

  it('费用估算：报告没有 token 单价与公式，一律返回 null', () => {
    for (const id of ALL) {
      const m = model(id);
      expect(m.estimateCost?.(evalForm(id).ctx)).toBeNull();
      expect(m.estimateCost?.(evalForm(id, { values: { resolution: '480p', duration: 10 } }).ctx)).toBeNull();
    }
  });
});

/* ---------------- 模型 × 模式 content[] 快照 ---------------- */

const label = (id: string, k: MediaKind, n: number): string => model(id).modes[0]!.prompt.refLabel!(k, n);
const imageItem = (a: string, role: string) => ({ type: 'image_url', image_url: { url: wireOf(a) }, role });
const videoItem = (a: string) => ({ type: 'video_url', video_url: { url: wireOf(a) }, role: 'reference_video' });
const audioItem = (a: string) => ({ type: 'audio_url', audio_url: { url: wireOf(a) }, role: 'reference_audio' });
const text = (t: string) => ({ type: 'text', text: t });

/** 每个模式的典型输入与期望的 content[]（text 在前，素材按槽位声明顺序 → 槽位内顺序） */
function modeCase(id: string, modeId: string): { over: Partial<FormInput>; content: Obj[] } {
  const L = (k: MediaKind, n: number) => label(id, k, n);
  switch (modeId) {
    case 't2v':
      return { over: { values: { ratio: '16:9' } }, content: [TEXT] };
    case 'i2v_first':
      return { over: { prompt: '{{ref:f}} starts to dance', values: { ratio: '16:9' }, slots: { first_frame: [img('f')] } }, content: [text(`${L('image', 1)} starts to dance`), imageItem('f', 'first_frame')] };
    case 'i2v_first_last':
      return {
        over: { prompt: 'from {{ref:a}} to {{ref:b}}', values: { ratio: '16:9' }, slots: { first_frame: [img('a')], last_frame: [img('b')] } },
        content: [text(`from ${L('image', 1)} to ${L('image', 2)}`), imageItem('a', 'first_frame'), imageItem('b', 'last_frame')],
      };
    case 'omni':
      return {
        // 用默认 ratio / duration（2.5 的推荐配置）；素材故意乱序引用，编号仍按 content 顺序
        over: { prompt: '{{ref:i2}} wears the outfit of {{ref:i1}}, moves like {{ref:v1}}, music from {{ref:a1}}', slots: { reference_image: [img('i1'), img('i2')], reference_video: [vid('v1')], reference_audio: [aud('a1')] } },
        content: [
          text(`${L('image', 2)} wears the outfit of ${L('image', 1)}, moves like ${L('video', 1)}, music from ${L('audio', 1)}`),
          imageItem('i1', 'reference_image'),
          imageItem('i2', 'reference_image'),
          videoItem('v1'),
          audioItem('a1'),
        ],
      };
    case 'edit':
      // S25 编辑配置的提示词示例原文
      return {
        over: { prompt: 'replace the character in {{ref:v}} with the character in {{ref:i}}', values: { ratio: '16:9', duration: 10 }, slots: { reference_image: [img('i')], reference_video: [vid('v', { durationSec: 8 })] } },
        content: [text('replace the character in @Video 1 with the character in @Image 1'), imageItem('i', 'reference_image'), videoItem('v')],
      };
    case 'extend':
      // S25 延长配置的提示词示例（含 @Image 1 与 @Video 2）
      return {
        over: { prompt: 'Extend {{ref:v1}} backward, and have the character in {{ref:i}} descend from the sky; continue with {{ref:v2}}', values: { ratio: '16:9' }, slots: { reference_image: [img('i')], reference_video: [vid('v1'), vid('v2')] } },
        content: [text('Extend @Video 1 backward, and have the character in @Image 1 descend from the sky; continue with @Video 2'), imageItem('i', 'reference_image'), videoItem('v1'), videoItem('v2')],
      };
    default:
      throw new Error(`没有 ${modeId} 的用例`);
  }
}

const MATRIX: [string, string][] = SEEDANCE_MODELS.flatMap((m) => m.modes.filter((x) => x.entry !== 'derived').map((x): [string, string] => [m.id, x.id]));

describe('模型 × 模式的 content[]（顺序、role、ratio、任务类型）', () => {
  it('矩阵覆盖所有用户可进入的模式', () => {
    expect(MATRIX.length).toBe(6 + 4 * 3 + 3 + 3 + 2);
  });

  it.each(MATRIX)('%s × %s', (id, modeId) => {
    const c = modeCase(id, modeId);
    const { ev, built, body } = run(id, { modeId, ...c.over });
    expect(body.content).toEqual(c.content);
    expect(issueIds(ev)).toEqual(id === V15 ? ['lifecycle'] : []);
    expect(built.issues).toEqual([]);
    // ratio：2.5 首帧 / 首尾帧 / 编辑 / 延长锁 adaptive；2.0 系列 adaptive 不发送；其余照用户值
    const adaptiveLocked = id === V25 && !['t2v', 'omni'].includes(modeId);
    const expectedRatio = modeId === 'omni' ? (id === V25 ? 'adaptive' : undefined) : adaptiveLocked ? 'adaptive' : '16:9';
    expect(body.ratio).toBe(expectedRatio);
    if (adaptiveLocked) expect(ev.fields.ratio!.locked?.value).toBe('adaptive');
    expect(body.omni_reference_task_type).toBe(modeId === 'edit' || modeId === 'extend' ? modeId : undefined);
    if (modeId === 'edit') expect(body.duration).toBe(-1);
  });

  it('提示词为空时不发 text', () => {
    const { body, ev } = run(V20, { modeId: 'i2v_first', prompt: '', slots: { first_frame: [img('f')] } });
    expect(body.content).toEqual([imageItem('f', 'first_frame')]);
    expect(ev.issues).toEqual([]);
  });

  it('1.0 pro 首帧：ratio 默认 adaptive 且可改', () => {
    expect(run(V10, { modeId: 'i2v_first', slots: { first_frame: [img('f')] } }).body.ratio).toBe('adaptive');
    expect(run(V10, { modeId: 'i2v_first', values: { ratio: '9:16' }, slots: { first_frame: [img('f')] } }).body.ratio).toBe('9:16');
  });

  it('2.0 系列：adaptive 不发送 ratio，具体比例照常发送', () => {
    for (const id of V20S) {
      expect(run(id, { modeId: 'i2v_first', slots: { first_frame: [img('f')] } }).body).not.toHaveProperty('ratio');
      const { body, ev } = run(id, { values: { ratio: 'adaptive' } });
      expect(body).not.toHaveProperty('ratio');
      expect(ev.fields.ratio).toMatchObject({ value: 'adaptive', sent: true });
      expect(run(id, { values: { ratio: '21:9' } }).body.ratio).toBe('21:9');
    }
  });
});

describe('样片与正片', () => {
  it('样片：2.5 开 draft 发送 draft:true 并锁 480p，尾帧不发送', () => {
    const { body, ev } = run(V25, { values: { draft: true, resolution: '1080p', return_last_frame: true } });
    expect(body).toEqual({ model: 'dreamina-seedance-2-5-260628', content: [TEXT], resolution: '480p', ratio: 'adaptive', duration: -1, generate_audio: true, draft: true, output_format: 'mp4', priority: 0, watermark: false, service_tier: 'default', execution_expires_after: 172800 });
    expect(ev.fields.resolution!.locked?.value).toBe('480p');
    expect(ev.fields.return_last_frame!.disabledReason).toBeDefined();
  });

  it('样片：1.5 pro 开 draft 锁 480p，flex 不可选、尾帧不发送', () => {
    const { body, ev } = run(V15, { modeId: 'i2v_first', values: { draft: true, service_tier: 'flex' }, slots: { first_frame: [img('f')] } });
    expect(body).toMatchObject({ draft: true, resolution: '480p', service_tier: 'default' });
    expect(body).not.toHaveProperty('return_last_frame');
    expect(ev.fields.service_tier!.adjusted).toBeDefined();
  });

  it('编辑 / 延长不开放样片：残留的 draft=true 不发送也不锁分辨率', () => {
    const { body } = run(V25, { modeId: 'edit', prompt: 'remove the hat', values: { draft: true }, slots: { reference_video: [vid('v')] } });
    expect(body).not.toHaveProperty('draft');
    expect(body.resolution).toBe('720p');
  });

  it('2.5 正片：只发 draft_task、锁定的 1080p 与允许重设的字段', () => {
    const { body, ev, built } = run(V25, {
      modeId: 'draft_final',
      prompt: '',
      derivedFrom: draftFrom(V25),
      values: { duration: 10, ratio: '16:9', generate_audio: false, draft: true, resolution: '720p', output_format: 'mov', priority: 3, return_last_frame: true },
    });
    expect(body).toEqual({
      model: 'dreamina-seedance-2-5-260628',
      content: [{ type: 'draft_task', draft_task: { id: 'cgt-draft-1' } }],
      resolution: '1080p',
      output_format: 'mov',
      priority: 3,
      return_last_frame: true,
      watermark: false,
      service_tier: 'default',
      execution_expires_after: 172800,
    });
    expect(ev.fields.resolution).toMatchObject({ visible: true, sent: true, locked: { value: '1080p' } });
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
  });

  it('1.5 pro 正片：可重设 resolution / watermark / service_tier / 尾帧；超时只在改过时发送；被沿用的参数不出现', () => {
    const { body, ev, built } = run(V15, { modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(V15), values: { resolution: '1080p', seed: 7, camera_fixed: true, service_tier: 'flex' } });
    expect(body).toEqual({
      model: 'seedance-1-5-pro-251215',
      content: [{ type: 'draft_task', draft_task: { id: 'cgt-draft-1' } }],
      resolution: '1080p',
      watermark: false,
      return_last_frame: false,
      service_tier: 'flex',
    });
    expect(issueIds(ev)).toEqual(['lifecycle']);
    expect(built.issues).toEqual([]);
    expect(run(V15, { modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(V15), values: { execution_expires_after: 7200 } }).body.execution_expires_after).toBe(7200);
    // 非正片模式照常发送默认超时
    expect(run(V15).body.execution_expires_after).toBe(172800);
  });

  it('正片请求体与官方 draft_task 片段同形，且不含 text / 素材 / duration / ratio / seed / generate_audio / omni_reference_task_type', () => {
    const shape = JSON.parse(OFFICIAL_DRAFT_CONTENT) as { type: string; draft_task: { id: string } }[];
    for (const id of [V25, V15]) {
      const { body } = run(id, { modeId: 'draft_final', prompt: 'change the prompt', derivedFrom: draftFrom(id), values: { duration: 8, ratio: '1:1', seed: 3, generate_audio: false } });
      const content = body.content as { type: string; draft_task: { id: string } }[];
      expect(content.map((c) => [c.type, Object.keys(c.draft_task)])).toEqual(shape.map((c) => [c.type, Object.keys(c.draft_task)]));
      for (const k of ['duration', 'ratio', 'seed', 'generate_audio', 'omni_reference_task_type', 'camera_fixed', 'frames', 'draft']) expect(body).not.toHaveProperty(k);
    }
  });
});

describe('官方示例对照（__fixtures__/official.ts）', () => {
  const parse = (s: string) => JSON.parse(s) as Obj & { content: Obj[] };
  const urlOf = (item: Obj): string => String((item.image_url as Obj | undefined)?.url ?? (item.video_url as Obj | undefined)?.url);
  const resolvedTo = (map: Record<string, string>): ResolvedAssets => Object.fromEntries(Object.entries(map).map(([k, url]) => [k, { wire: url, preview: url, bytes: 10 }]));

  it('1.5 pro 常规请求体：官方字段原样出现，只多出我们显式发送的默认值', () => {
    const official = parse(OFFICIAL_CREATE_15);
    const { body, ev, built } = run(V15, { prompt: 'The kitten is yawning at the camera.', values: { resolution: '720p', ratio: '16:9', duration: 5, seed: 11, camera_fixed: false, watermark: true } });
    expect(body).toEqual({ ...official, generate_audio: true, return_last_frame: false, service_tier: 'default', execution_expires_after: 172800 });
    expect(issueIds(ev)).toEqual(['lifecycle']);
    expect(built.issues).toEqual([]);
  });

  it('1.5 pro 旧写法：content 与官方一致，并给 C-SE-16-legacy warn', () => {
    const official = parse(OFFICIAL_CREATE_15_LEGACY);
    const prompt = String(official.content[0]!.text);
    const { body, ev } = run(V15, { prompt });
    expect(body.content).toEqual(official.content);
    expect(ev.issues.find((i) => i.id === 'C-SE-16-legacy')?.severity).toBe('warn');
  });

  it('2.5 首尾帧：content（顺序、role）与官方一致', () => {
    const official = parse(OFFICIAL_S25_FIRST_LAST);
    const url = urlOf(official.content[1]!);
    const over: Partial<FormInput> = { modeId: 'i2v_first_last', prompt: String(official.content[0]!.text), values: { duration: 5 }, slots: { first_frame: [img('a')], last_frame: [img('b')] } };
    const { body, ev, built } = run(V25, over, resolvedTo({ a: url, b: url }));
    expect(body).toEqual({ ...official, resolution: '720p', output_format: 'mp4', priority: 0, ...COMMON });
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
  });

  it('2.5 编辑（auto）：全模态参考模式不发 omni_reference_task_type，与官方请求体一致', () => {
    const official = parse(OFFICIAL_S25_EDIT_AUTO);
    const over: Partial<FormInput> = { modeId: 'omni', prompt: String(official.content[0]!.text), values: { output_format: 'mov' }, slots: { reference_video: [vid('v')] } };
    const { body, ev, built } = run(V25, over, resolvedTo({ v: urlOf(official.content[1]!) }));
    expect(body).toEqual({ ...official, resolution: '720p', priority: 0, ...COMMON });
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
  });

  it('2.5 样片第 1 步：与官方一致，差异只有首帧显式写 role 与显式默认值', () => {
    const official = parse(OFFICIAL_S25_DRAFT_STEP1);
    const [t, image] = official.content as [Obj, Obj];
    const over: Partial<FormInput> = { modeId: 'i2v_first', prompt: String(t.text), values: { duration: 5, draft: true, output_format: 'mov' }, slots: { first_frame: [img('f')] } };
    const { body, ev, built } = run(V25, over, resolvedTo({ f: urlOf(image) }));
    // S25 配置方法要求首帧带 role=first_frame（示例本身没写），所以总是显式写；2.5 样片不发 return_last_frame
    expect(body).toEqual({ ...official, content: [t, { ...image, role: 'first_frame' }], generate_audio: true, priority: 0, watermark: false, execution_expires_after: 172800 });
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
  });

  it('2.5 样片第 2 步：与官方一致（显式 1080p），只多出显式默认值', () => {
    const official = parse(OFFICIAL_S25_DRAFT_STEP2);
    const id = String((official.content[0]!.draft_task as Obj).id);
    const { body, ev, built } = run(V25, { modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(V25, { upstreamTaskId: id }), values: { output_format: 'mov' } });
    expect(body).toEqual({ ...official, priority: 0, ...COMMON });
    expect(ev.issues).toEqual([]);
    expect(built.issues).toEqual([]);
  });

  it('1.5 pro 样片第 1 步：官方没传 resolution，我们显式传 480p（不传时行为未核实）', () => {
    const official = parse(OFFICIAL_TUT_15_DRAFT_STEP1);
    const [t, image] = official.content as [Obj, Obj];
    const over: Partial<FormInput> = { modeId: 'i2v_first', prompt: String(t.text), values: { seed: 20, duration: 6, draft: true }, slots: { first_frame: [img('f')] } };
    const { body, built } = run(V15, over, resolvedTo({ f: urlOf(image) }));
    expect(body).toEqual({
      ...official,
      content: [t, { ...image, role: 'first_frame' }],
      resolution: '480p',
      ratio: 'adaptive',
      generate_audio: true,
      camera_fixed: false,
      watermark: false,
      service_tier: 'default',
      execution_expires_after: 172800,
    });
    expect(built.issues).toEqual([]);
  });

  it('1.5 pro 样片第 2 步：请求体与官方完全一致', () => {
    const official = parse(OFFICIAL_TUT_15_DRAFT_STEP2);
    const id = String((official.content[0]!.draft_task as Obj).id);
    const { body, built } = run(V15, { modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(V15, { upstreamTaskId: id }), values: { watermark: false, resolution: '720p', return_last_frame: true, service_tier: 'default' } });
    expect(body).toEqual(official);
    expect(built.issues).toEqual([]);
  });
});

describe('其他字段', () => {
  it('1.0：默认按秒，切到按帧数时只发 frames', () => {
    expect(run(V10).body).not.toHaveProperty('frames');
    const { body, ev } = run(V10, { values: { lengthMode: 'frames', duration: 8 } });
    expect(body.frames).toBe(121);
    expect(body).not.toHaveProperty('duration');
    expect(body).not.toHaveProperty('lengthMode');
    expect(ev.issues).toEqual([]);
    expect(run(V10F, { values: { lengthMode: 'frames', frames: 289 } }).body.frames).toBe(289);
  });

  it('1.0 文生视频不支持 adaptive：回退到 16:9 并说明', () => {
    const { body, ev } = run(V10, { values: { ratio: 'adaptive' } });
    expect(body.ratio).toBe('16:9');
    expect(ev.fields.ratio!.adjusted).toBeDefined();
    expect(ev.fields.ratio!.options!.find((o) => o.value === 'adaptive')?.disabledReason).toBeDefined();
  });

  it('1.x 可设 seed / camera_fixed；flex 可选', () => {
    const { body } = run(V10, { values: { seed: 42, camera_fixed: true, service_tier: 'flex' } });
    expect(body).toMatchObject({ seed: 42, camera_fixed: true, service_tier: 'flex' });
  });

  it('2.x 选 flex 回退到 default', () => {
    const { body, ev } = run(V20, { values: { service_tier: 'flex' } });
    expect(body.service_tier).toBe('default');
    expect(ev.fields.service_tier!.options!.find((o) => o.value === 'flex')?.disabledReason).toBeDefined();
  });

  it('Endpoint ID 覆盖 model', () => {
    const { body, built } = run(V20, { modelOverride: 'ep-20261008-xyz' });
    expect(body.model).toBe('ep-20261008-xyz');
    expect(built.notes.length).toBe(1);
  });

  it('范围与模式校验（引擎）：duration 越界、1.0 不接受 -1、frames 不满足 25+4n、priority / 超时越界', () => {
    expect(issueIds(evalForm(V25, { values: { duration: 31 } }))).toContain('range:duration');
    expect(issueIds(evalForm(V25, { values: { duration: -1 } }))).toEqual([]);
    expect(issueIds(evalForm(V10, { values: { duration: -1 } }))).toContain('range:duration');
    expect(issueIds(evalForm(V10, { values: { lengthMode: 'frames', frames: 122 } }))).toContain('pattern:frames');
    expect(issueIds(evalForm(V20, { values: { priority: 10 } }))).toContain('range:priority');
    expect(issueIds(evalForm(V20, { values: { execution_expires_after: 3599 } }))).toContain('range:execution_expires_after');
  });

  it('素材槽：首帧必填、全模态参考超上限、编辑源视频短于 4 秒', () => {
    expect(issueIds(evalForm(V25, { modeId: 'i2v_first', slots: {} }))).toContain('slot-min:first_frame');
    const many = Array.from({ length: 10 }, (_, i) => img(`i${i}`));
    expect(issueIds(evalForm(V20, { modeId: 'omni', slots: { reference_image: many } }))).toContain('slot-max:reference_image');
    expect(issueIds(evalForm(V25, { modeId: 'omni', slots: { reference_image: many } }))).not.toContain('slot-max:reference_image');
    expect(issueIds(evalForm(V25, { modeId: 'edit', prompt: 'remove the hat', slots: { reference_video: [vid('v', { durationSec: 3 })] } }))).toContain('asset:reference_video:0');
    expect(issueIds(evalForm(V25, { modeId: 'extend', prompt: 'continue', slots: { reference_video: [vid('v', { durationSec: 3 })] } }))).toEqual([]);
    // 编辑 / 延长没有音频槽
    expect(issueIds(evalForm(V25, { modeId: 'edit', prompt: 'remove the hat', slots: { reference_video: [vid('v')], reference_audio: [aud('a')] } }))).toContain('slot-unknown:reference_audio');
  });
});
