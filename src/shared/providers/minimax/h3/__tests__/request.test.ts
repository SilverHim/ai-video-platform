import { describe, expect, it } from 'vitest';
import { MB } from '../../../../catalog/helpers.js';
import { getModel, listModels } from '../../../registry.js';
import { minimax } from '../../index.js';
// 官方 V2 OpenAPI（docs/api-reference/video/generation/api/v2-video-generation.json）创建接口 requestBody examples 原样摘录
import i2vaRequest from '../__fixtures__/create.i2va.request.json';
import r2vaRequest from '../__fixtures__/create.r2va.request.json';
import t2vaRequest from '../__fixtures__/create.t2va.request.json';
import { ALL, H3, MAX, aud, evalForm, img, issueIds, localImg, mmFile, model, run, url, vid, wireOf } from './helpers.js';

const text = (t = 'a cat') => ({ type: 'text', text: t });
const image = (id: string, role: string) => ({ type: 'image_url', image_url: { url: wireOf(id) }, role });
const video = (id: string) => ({ type: 'video_url', video_url: { url: wireOf(id) }, role: 'reference_video' });
const audio = (id: string) => ({ type: 'audio_url', audio_url: { url: wireOf(id) }, role: 'reference_audio' });

describe('目录声明', () => {
  it('两个模型挂在 minimax 下，异步视频，四个 endpoint 都在服务商白名单里', () => {
    expect(ALL.map((id) => model(id).apiModel)).toEqual(['MiniMax-H3', 'MiniMax-H3-Max']);
    for (const id of ALL) {
      const m = model(id);
      expect(getModel(id)?.provider.id).toBe('minimax');
      expect(m).toMatchObject({ providerId: 'minimax', family: 'h3', output: 'video', kind: 'async', lifecycle: { status: 'active' } });
      expect(m.endpoints).toEqual({ submit: 'video.create', get: 'video.get', cancel: 'video.delete', list: 'video.list' });
      for (const ep of Object.values(m.endpoints)) expect(minimax.endpoints[ep!]).toBeDefined();
      expect(m.allowModelOverride).toBeFalsy();
      expect(m.adapter.normalizeTask).toBeTypeOf('function');
    }
    expect(listModels().map((x) => x.model.id)).toEqual(expect.arrayContaining(ALL));
  });

  it('模式：H3 文生 / 图生 / 参考生开放；仅尾帧实验且默认隐藏；H3-Max 参考生视频也是实验且默认隐藏', () => {
    const modes = (id: string) => model(id).modes.map((m) => [m.id, !!m.experimental, !!m.hiddenByDefault]);
    expect(modes(H3)).toEqual([
      ['t2v', false, false],
      ['i2v', false, false],
      ['i2v_last', true, true],
      ['r2v', false, false],
    ]);
    expect(modes(MAX)).toEqual([
      ['t2v', false, false],
      ['i2v', false, false],
      ['i2v_last', true, true],
      ['r2v', true, true],
    ]);
  });

  it('字段集合：只有 H3-Max 有提示词扩写；没有 prompt_optimizer / aigc_watermark / callback_url', () => {
    expect(model(H3).fields.map((f) => f.key)).toEqual(['resolution', 'duration', 'ratio']);
    expect(model(MAX).fields.map((f) => f.key)).toEqual(['resolution', 'duration', 'ratio', 'prompt_expansion_mode']);
  });

  it('素材槽：role、数量与来源', () => {
    const slots = (modeId: string) => model(H3).modes.find((m) => m.id === modeId)!.slots.map((s) => [s.id, s.kind, s.role, s.min, s.max]);
    expect(slots('t2v')).toEqual([]);
    expect(slots('i2v')).toEqual([
      ['first_frame', 'image', 'first_frame', 1, 1],
      ['last_frame', 'image', 'last_frame', 0, 1],
    ]);
    expect(slots('i2v_last')).toEqual([['last_frame', 'image', 'last_frame', 1, 1]]);
    expect(slots('r2v')).toEqual([
      ['reference_image', 'image', 'reference_image', 0, 9],
      ['reference_video', 'video', 'reference_video', 0, 3],
      ['reference_audio', 'audio', 'reference_audio', 0, 3],
    ]);
    for (const m of model(MAX).modes) for (const s of m.slots) expect(s.sources).toEqual(['local', 'url', 'task-output', 'provider-file']);
  });

  it('提示词：必填，硬上限 7000；引用写法：图生 / 仅尾帧 "Image n"，参考生 "reference image / video / audio n"', () => {
    for (const id of ALL) {
      for (const m of model(id).modes) {
        expect(m.prompt.required).toBe(true);
        expect(m.prompt.maxChars).toBe(7000);
      }
    }
    const label = (modeId: string) => model(H3).modes.find((m) => m.id === modeId)!.prompt.refLabel!;
    for (const modeId of ['t2v', 'i2v', 'i2v_last']) expect([label(modeId)('image', 1), label(modeId)('image', 2)]).toEqual(['Image 1', 'Image 2']);
    const r = label('r2v');
    expect([r('image', 2), r('video', 1), r('audio', 3)]).toEqual(['reference image 2', 'reference video 1', 'reference audio 3']);
    expect(model(MAX).modes.find((m) => m.id === 'r2v')!.prompt.refLabel!('audio', 1)).toBe('reference audio 1');
  });
});

describe('默认请求体黄金快照', () => {
  it('H3 文生视频', () => {
    const r = run(H3);
    expect(r.ev.canSubmit).toBe(true);
    expect(r.ev.issues).toEqual([]);
    expect(r.body).toEqual({ model: 'MiniMax-H3', content: [text()], resolution: '768P', duration: 4, ratio: '16:9' });
    expect(r.built).toMatchObject({ endpointId: 'video.create', method: 'POST', path: '/v2/video_generation', stream: false, issues: [] });
  });

  it('H3-Max 文生视频（extra.prompt_expansion_mode 显式发送）', () => {
    const r = run(MAX);
    expect(r.ev.issues).toEqual([]);
    expect(r.body).toEqual({ model: 'MiniMax-H3-Max', content: [text()], resolution: '768P', duration: 5, ratio: '16:9', extra: { prompt_expansion_mode: 'balanced' } });
    expect(r.built.issues).toEqual([]);
  });

  it('H3 图生视频（首帧）：不发送 ratio', () => {
    const r = run(H3, { modeId: 'i2v', slots: { first_frame: [img('f')] } });
    expect(r.ev.issues).toEqual([]);
    expect(r.body).toEqual({ model: 'MiniMax-H3', content: [text(), image('f', 'first_frame')], resolution: '768P', duration: 4 });
    expect(r.built.issues).toEqual([]);
  });

  it('H3-Max 图生视频（首尾帧）', () => {
    const r = run(MAX, { modeId: 'i2v', slots: { last_frame: [img('l')], first_frame: [img('f')] } });
    expect(r.ev.issues).toEqual([]);
    expect(r.body).toEqual({
      model: 'MiniMax-H3-Max',
      content: [text(), image('f', 'first_frame'), image('l', 'last_frame')],
      resolution: '768P',
      duration: 5,
      extra: { prompt_expansion_mode: 'balanced' },
    });
  });

  it('H3 仅尾帧（实验）：只带 1 张 role=last_frame，不发送 ratio，只多一条文档冲突提示', () => {
    const r = run(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } });
    expect(issueIds(r.ev)).toEqual(['C-MM-H3-12']);
    expect(r.ev.canSubmit).toBe(true);
    expect(r.body).toEqual({ model: 'MiniMax-H3', content: [text(), image('l', 'last_frame')], resolution: '768P', duration: 4 });
    expect(r.built.issues).toEqual([]);
  });

  it('H3-Max 仅尾帧（实验）', () => {
    const r = run(MAX, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } });
    expect(issueIds(r.ev)).toEqual(['C-MM-H3-12']);
    expect(r.body).toEqual({ model: 'MiniMax-H3-Max', content: [text(), image('l', 'last_frame')], resolution: '768P', duration: 5, extra: { prompt_expansion_mode: 'balanced' } });
    expect(r.built.issues).toEqual([]);
  });

  it('H3 参考生视频：ratio 默认 adaptive', () => {
    const r = run(H3, { modeId: 'r2v', slots: { reference_image: [img('r1')] } });
    expect(r.ev.issues).toEqual([]);
    expect(r.body).toEqual({ model: 'MiniMax-H3', content: [text(), image('r1', 'reference_image')], resolution: '768P', duration: 4, ratio: 'adaptive' });
    expect(r.built.issues).toEqual([]);
  });

  it('H3-Max 参考生视频（实验）：只多一条文档冲突提示', () => {
    const r = run(MAX, { modeId: 'r2v', slots: { reference_image: [img('r1')] } });
    expect(issueIds(r.ev)).toEqual(['C-MM-H3-11']);
    expect(r.ev.canSubmit).toBe(true);
    expect(r.body).toEqual({
      model: 'MiniMax-H3-Max',
      content: [text(), image('r1', 'reference_image')],
      resolution: '768P',
      duration: 5,
      ratio: 'adaptive',
      extra: { prompt_expansion_mode: 'balanced' },
    });
  });
});

describe('content[] 顺序与 role', () => {
  it('参考生视频：图（槽内顺序）→ 视频 → 音频，与提示词编号一致', () => {
    const slots = { reference_audio: [aud('a1', 5)], reference_video: [vid('v1', 6), vid('v2', 4)], reference_image: [img('r1'), img('r2')] };
    const r = run(H3, { modeId: 'r2v', slots, prompt: '{{ref:r2}} dances to {{ref:a1}} like {{ref:v2}} in front of {{ref:r1}}' });
    expect(r.body.content).toEqual([
      text('reference image 2 dances to reference audio 1 like reference video 2 in front of reference image 1'),
      image('r1', 'reference_image'),
      image('r2', 'reference_image'),
      video('v1'),
      video('v2'),
      audio('a1'),
    ]);
  });

  it('图生视频：首帧永远在尾帧之前，编号 Image 1 / Image 2', () => {
    const r = run(H3, { modeId: 'i2v', slots: { last_frame: [img('l')], first_frame: [img('f')] }, prompt: 'from {{ref:f}} to {{ref:l}}' });
    expect(r.body.content).toEqual([text('from Image 1 to Image 2'), image('f', 'first_frame'), image('l', 'last_frame')]);
  });

  it('仅尾帧：唯一素材 role=last_frame（不省略 role，避免被当作首帧）', () => {
    const r = run(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')] }, prompt: 'ends at {{ref:l}}' });
    expect(r.body.content).toEqual([text('ends at Image 1'), image('l', 'last_frame')]);
  });

  it('素材值取自 resolved（mm_file / Data URL 原样写入）', () => {
    const f = mmFile('f');
    const r = run(H3, { modeId: 'i2v', slots: { first_frame: [f] } }, { f: { wire: 'mm_file://123', preview: 'mm_file://123', bytes: 13 } });
    expect(r.body.content).toEqual([text(), { type: 'image_url', image_url: { url: 'mm_file://123' }, role: 'first_frame' }]);
  });

  it('文生视频不带任何素材', () => {
    expect(run(H3).body.content).toEqual([text()]);
  });
});

describe('官方请求示例', () => {
  it('t2va 示例可由表单原样构造', () => {
    const r = run(H3, { prompt: t2vaRequest.content[0]!.text, values: { resolution: '2K', duration: 5, ratio: '16:9' } });
    expect(r.body).toEqual(t2vaRequest);
    expect(r.built.issues).toEqual([]);
  });

  it('i2va 示例：唯一差异是我们不发送 ratio（文档写图生视频始终按 adaptive 处理）', () => {
    const prompt = i2vaRequest.content[0]!.text!;
    const first = i2vaRequest.content[1]!.image_url!.url;
    const r = run(H3, { modeId: 'i2v', prompt, values: { resolution: '2K', duration: 5, ratio: 'adaptive' }, slots: { first_frame: [img('f')] } }, { f: { wire: first, preview: '', bytes: 0 } });
    const { ratio, ...expected } = i2vaRequest;
    expect(ratio).toBe('adaptive');
    expect(r.body).toEqual(expected);
  });

  it('r2va 示例可由表单原样构造（参考视频在前、音频在后）', () => {
    const [t, v, a] = r2vaRequest.content;
    const r = run(
      H3,
      { modeId: 'r2v', prompt: t!.text!, values: { resolution: '2K', duration: 5 }, slots: { reference_audio: [aud('a')], reference_video: [vid('v')] } },
      { v: { wire: v!.video_url!.url, preview: '', bytes: 0 }, a: { wire: a!.audio_url!.url, preview: '', bytes: 0 } },
    );
    expect(r.body).toEqual(r2vaRequest);
    expect(r.built.issues).toEqual([]);
  });

  it('r2va 示例里的 "reference audio 1" 可由素材引用渲染得到', () => {
    const [t, v, a] = r2vaRequest.content;
    const prompt = t!.text!.replace('reference audio 1', '{{ref:a}}');
    expect(prompt).not.toBe(t!.text);
    const r = run(
      H3,
      { modeId: 'r2v', prompt, values: { resolution: '2K', duration: 5 }, slots: { reference_video: [vid('v')], reference_audio: [aud('a')] } },
      { v: { wire: v!.video_url!.url, preview: '', bytes: 0 }, a: { wire: a!.audio_url!.url, preview: '', bytes: 0 } },
    );
    expect(r.body).toEqual(r2vaRequest);
  });
});

describe('字段', () => {
  it('ratio：文生视频选 adaptive 会回退到 16:9；7 种比例都能发送', () => {
    const r = evalForm(H3, { values: { ratio: 'adaptive' } });
    expect(r.fields.ratio!.value).toBe('16:9');
    expect(r.fields.ratio!.adjusted).toBeDefined();
    expect(r.fields.ratio!.options!.find((o) => o.value === 'adaptive')!.disabledReason).toBeDefined();
    for (const v of ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']) expect(run(H3, { values: { ratio: v } }).body.ratio).toBe(v);
  });

  it('ratio：参考生视频可选 adaptive 或具体比例；图生视频不可见、不发送', () => {
    const slots = { reference_image: [img('r')] };
    expect(run(H3, { modeId: 'r2v', slots, values: { ratio: '9:16' } }).body.ratio).toBe('9:16');
    expect(evalForm(H3, { modeId: 'r2v', slots }).fields.ratio!.options!.every((o) => !o.disabledReason)).toBe(true);
    const i2v = run(H3, { modeId: 'i2v', slots: { first_frame: [img('f')] }, values: { ratio: '16:9' } });
    expect(i2v.ev.fields.ratio).toMatchObject({ visible: false, sent: false });
    expect(i2v.body).not.toHaveProperty('ratio');
    const last = run(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')] }, values: { ratio: '16:9' } });
    expect(last.ev.fields.ratio).toMatchObject({ visible: false, sent: false });
    expect(last.body).not.toHaveProperty('ratio');
  });

  it('resolution：H3 768P / 2K，H3-Max 480P / 768P；不支持的值回退默认 768P', () => {
    expect(run(H3, { values: { resolution: '2K' } }).body.resolution).toBe('2K');
    expect(run(MAX, { values: { resolution: '480P' } }).body.resolution).toBe('480P');
    const h3 = evalForm(H3, { values: { resolution: '480P' } });
    expect([h3.fields.resolution!.value, !!h3.fields.resolution!.adjusted]).toEqual(['768P', true]);
    const max = evalForm(MAX, { values: { resolution: '2K' } });
    expect([max.fields.resolution!.value, !!max.fields.resolution!.adjusted]).toEqual(['768P', true]);
  });

  it('duration：H3 4–15、H3-Max 5–15 的整数', () => {
    expect(evalForm(H3, { values: { duration: 4 } }).canSubmit).toBe(true);
    expect(evalForm(H3, { values: { duration: 15 } }).canSubmit).toBe(true);
    expect(run(H3, { values: { duration: 15 } }).body.duration).toBe(15);
    expect(issueIds(evalForm(H3, { values: { duration: 3 } }))).toContain('range:duration');
    expect(issueIds(evalForm(H3, { values: { duration: 16 } }))).toContain('range:duration');
    expect(issueIds(evalForm(H3, { values: { duration: 4.5 } }))).toContain('int:duration');
    expect(issueIds(evalForm(MAX, { values: { duration: 4 } }))).toContain('range:duration');
    expect(evalForm(MAX, { values: { duration: 5 } }).canSubmit).toBe(true);
  });

  it('prompt_expansion_mode：三种取值写进 extra；未知值回退 balanced；H3 忽略', () => {
    for (const v of ['disabled', 'balanced', 'quality']) expect(run(MAX, { values: { prompt_expansion_mode: v } }).body.extra).toEqual({ prompt_expansion_mode: v });
    const r = evalForm(MAX, { values: { prompt_expansion_mode: 'balance' } });
    expect(r.fields.prompt_expansion_mode!.value).toBe('balanced');
    expect(run(H3, { values: { prompt_expansion_mode: 'quality' } }).body).not.toHaveProperty('extra');
  });
});

describe('提示词', () => {
  it('必填：空白也不行', () => {
    expect(issueIds(evalForm(H3, { prompt: '   ' }))).toContain('prompt:required');
    expect(issueIds(evalForm(MAX, { modeId: 'i2v', prompt: '', slots: { first_frame: [img('f')] } }))).toContain('prompt:required');
  });

  it('硬上限 7000 字符（按字符计）', () => {
    expect(evalForm(H3, { prompt: 'a'.repeat(7000) }).canSubmit).toBe(true);
    expect(evalForm(H3, { prompt: '猫'.repeat(7000) }).canSubmit).toBe(true);
    expect(issueIds(evalForm(H3, { prompt: 'a'.repeat(7001) }))).toContain('prompt:max');
  });
});

describe('素材槽数量与规格', () => {
  it('仅尾帧：尾帧必填且最多 1 张；不接受首帧', () => {
    expect(issueIds(evalForm(H3, { modeId: 'i2v_last' }))).toContain('slot-min:last_frame');
    expect(issueIds(evalForm(H3, { modeId: 'i2v_last', slots: { last_frame: [img('a'), img('b')] } }))).toContain('slot-max:last_frame');
    expect(issueIds(evalForm(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')], first_frame: [img('f')] } }))).toContain('slot-unknown:first_frame');
  });

  it('图生视频：首帧必填；首帧、尾帧各最多 1 张', () => {
    expect(issueIds(evalForm(H3, { modeId: 'i2v' }))).toContain('slot-min:first_frame');
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('a'), img('b')] } }))).toContain('slot-max:first_frame');
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [img('a'), img('b')] } }))).toContain('slot-max:last_frame');
  });

  it('参考生视频：图 ≤9、视频 ≤3、音频 ≤3', () => {
    const ids = (slots: Record<string, ReturnType<typeof img>[]>) => issueIds(evalForm(H3, { modeId: 'r2v', slots }));
    expect(ids({ reference_image: Array.from({ length: 9 }, (_, i) => img(`r${i}`)) })).toEqual([]);
    expect(ids({ reference_image: Array.from({ length: 10 }, (_, i) => img(`r${i}`)) })).toContain('slot-max:reference_image');
    expect(ids({ reference_video: Array.from({ length: 4 }, (_, i) => vid(`v${i}`, 3)) })).toContain('slot-max:reference_video');
    expect(ids({ reference_audio: Array.from({ length: 4 }, (_, i) => aud(`a${i}`, 3)) })).toContain('slot-max:reference_audio');
  });

  it('其他模式没有素材槽', () => {
    expect(issueIds(evalForm(H3, { slots: { first_frame: [img('f')] } }))).toContain('slot-unknown:first_frame');
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], reference_image: [img('r')] } }))).toContain('slot-unknown:reference_image');
  });

  const firstFrame = (a: ReturnType<typeof img>) => issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [a] } }));

  it('图片：JPG / PNG / WEBP / HEIC / HEIF，≤30MB（按 10^6 计），宽高 [256, 5760]，宽高比 [0.4, 2.5]', () => {
    for (const mime of ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) expect(firstFrame(localImg('f', { mime }))).toEqual([]);
    expect(firstFrame(localImg('f', { mime: 'image/gif' }))).toContain('asset:first_frame:0');
    expect(firstFrame(localImg('f', { bytes: 30_000_000 }))).toEqual([]);
    expect(firstFrame(localImg('f', { bytes: 30_000_001 }))).toContain('asset:first_frame:0');
    // 30 MiB 落在两种口径之间：取保守值，报错
    expect(firstFrame(localImg('f', { bytes: 30 * MB }))).toContain('asset:first_frame:0');
    expect(firstFrame(localImg('f', { width: 256, height: 256 }))).toEqual([]);
    expect(firstFrame(localImg('f', { width: 255, height: 300 }))).toContain('asset:first_frame:0');
    expect(firstFrame(localImg('f', { width: 5761, height: 5000 }))).toContain('asset:first_frame:0');
    expect(firstFrame(localImg('f', { width: 1000, height: 400 }))).toEqual([]);
    expect(firstFrame(localImg('f', { width: 1001, height: 400 }))).toContain('asset:first_frame:0');
    expect(firstFrame(localImg('f', { width: 400, height: 1001 }))).toContain('asset:first_frame:0');
  });

  it('来源：不接受 asset://（provider-asset）', () => {
    expect(firstFrame({ id: 'f', source: { type: 'provider-asset', uri: 'asset://x' } })).toContain('asset:first_frame:0');
    expect(firstFrame(mmFile('f'))).toEqual([]);
  });

  const refVideo = (a: ReturnType<typeof vid>) => issueIds(evalForm(H3, { modeId: 'r2v', slots: { reference_video: [a] } }));

  it('视频：MP4 / MOV，≤50MB，单段 [2, 15] 秒，帧率 [23.976, 60]', () => {
    expect(refVideo(vid('v', 2))).toEqual([]);
    expect(refVideo(vid('v', 15, { mime: 'video/quicktime' }))).toEqual([]);
    expect(refVideo(vid('v', 5, { mime: 'video/webm' }))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 1.9))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 15.1))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 5, { bytes: 50_000_000 }))).toEqual([]);
    expect(refVideo(vid('v', 5, { bytes: 50_000_001 }))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 5, { bytes: 50 * MB }))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 5, { fps: 23.976 }))).toEqual([]);
    expect(refVideo(vid('v', 5, { fps: 20 }))).toContain('asset:reference_video:0');
    expect(refVideo(vid('v', 5, { width: 3000, height: 1000 }))).toContain('asset:reference_video:0');
  });

  const refAudio = (a: ReturnType<typeof aud>) => issueIds(evalForm(H3, { modeId: 'r2v', slots: { reference_audio: [a] } }));

  it('音频：WAV / MP3，≤15MB，单段 [2, 15] 秒', () => {
    expect(refAudio(aud('a', 2))).toEqual([]);
    expect(refAudio(aud('a', 10, { mime: 'audio/wav' }))).toEqual([]);
    expect(refAudio(aud('a', 10, { mime: 'audio/aac' }))).toContain('asset:reference_audio:0');
    expect(refAudio(aud('a', 16))).toContain('asset:reference_audio:0');
    expect(refAudio(aud('a', 10, { bytes: 15_000_000 }))).toEqual([]);
    expect(refAudio(aud('a', 10, { bytes: 15_000_001 }))).toContain('asset:reference_audio:0');
    expect(refAudio(aud('a', 10, { bytes: 15 * MB }))).toContain('asset:reference_audio:0');
  });

  it('URL 素材无元数据时不报错', () => {
    expect(refVideo(url('v', 'video', { mime: undefined }))).toEqual([]);
  });
});
