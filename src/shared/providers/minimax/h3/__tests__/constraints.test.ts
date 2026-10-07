import { describe, expect, it } from 'vitest';
import type { AssetRef } from '../../../../catalog/types.js';
import { MINIMAX_INLINE_LIMIT } from '../constraints.js';
import { H3, MAX, aud, evalForm, guardIds, img, issueIds, localImg, many, mmFile, run, vid } from './helpers.js';

const issue = (r: ReturnType<typeof evalForm>, id: string) => r.issues.find((i) => i.id === id);
const r2v = (slots: Record<string, AssetRef[]>, id = H3) => evalForm(id, { modeId: 'r2v', slots });

describe('C-MM-H3-1 时长必填', () => {
  it('命中：duration 为 null', () => {
    const r = evalForm(H3, { values: { duration: null } });
    expect(issue(r, 'C-MM-H3-1')?.severity).toBe('error');
    expect(r.canSubmit).toBe(false);
  });
  it('不命中：默认值与合法整数', () => {
    expect(issueIds(evalForm(H3))).not.toContain('C-MM-H3-1');
    expect(issueIds(evalForm(MAX, { values: { duration: 12 } }))).not.toContain('C-MM-H3-1');
  });
});

describe('C-MM-H3-2 图生视频模式不支持只传尾帧（文档冲突取保守）', () => {
  it('命中：图生视频只传尾帧，提示改用实验模式', () => {
    const r = evalForm(H3, { modeId: 'i2v', slots: { last_frame: [img('l')] } });
    expect(issue(r, 'C-MM-H3-2')?.severity).toBe('error');
    expect(issue(r, 'C-MM-H3-2')?.message.zh).toContain('文档冲突');
    expect(issue(r, 'C-MM-H3-2')?.message.zh).toContain('仅尾帧');
    expect(issueIds(r)).toContain('slot-min:first_frame');
  });
  it('不命中：首帧、首尾帧、实验模式仅尾帧', () => {
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')] } }))).not.toContain('C-MM-H3-2');
    expect(issueIds(evalForm(MAX, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [img('l')] } }))).not.toContain('C-MM-H3-2');
    expect(issueIds(evalForm(H3, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } }))).not.toContain('C-MM-H3-2');
  });
});

describe('C-MM-H3-3 参考生视频至少 1 个参考素材', () => {
  it('命中：没有任何参考素材', () => {
    const r = r2v({});
    expect(issue(r, 'C-MM-H3-3')?.severity).toBe('error');
    expect(r.canSubmit).toBe(false);
  });
  it('不命中：只有 1 段音频；非参考模式', () => {
    expect(issueIds(r2v({ reference_audio: [aud('a', 3)] }))).not.toContain('C-MM-H3-3');
    expect(issueIds(evalForm(H3))).not.toContain('C-MM-H3-3');
  });
});

describe('C-MM-H3-4 参考素材合计 ≤12', () => {
  it('命中：9 图 + 3 视频 + 1 音频 = 13', () => {
    const r = r2v({ reference_image: many(9, (id) => img(id)), reference_video: many(3, (id) => vid(id, 3), 'v'), reference_audio: [aud('a', 3)] });
    expect(issue(r, 'C-MM-H3-4')?.severity).toBe('error');
    expect(r.issues.filter((i) => i.id.startsWith('slot-max'))).toEqual([]);
  });
  it('不命中：9 图 + 3 视频 = 12', () => {
    const r = r2v({ reference_image: many(9, (id) => img(id)), reference_video: many(3, (id) => vid(id, 3), 'v') });
    expect(r.issues).toEqual([]);
  });
});

describe('C-MM-H3-5 参考视频总时长 ≤15 秒', () => {
  it('命中：8 + 8 秒', () => {
    expect(issue(r2v({ reference_video: [vid('a', 8), vid('b', 8)] }), 'C-MM-H3-5')?.severity).toBe('error');
  });
  it('不命中：7.5 + 7.5 秒、时长未知', () => {
    expect(issueIds(r2v({ reference_video: [vid('a', 7.5), vid('b', 7.5)] }))).not.toContain('C-MM-H3-5');
    expect(issueIds(r2v({ reference_video: [vid('a'), vid('b'), vid('c')] }))).not.toContain('C-MM-H3-5');
  });
});

describe('C-MM-H3-6 参考音频总时长 ≤15 秒', () => {
  it('命中：10 + 6 秒', () => {
    expect(issue(r2v({ reference_audio: [aud('a', 10), aud('b', 6)] }), 'C-MM-H3-6')?.severity).toBe('error');
  });
  it('不命中：5 + 5 + 5 秒', () => {
    expect(issueIds(r2v({ reference_audio: [aud('a', 5), aud('b', 5), aud('c', 5)] }))).not.toContain('C-MM-H3-6');
  });
});

describe('C-MM-H3-7 参考视频编码', () => {
  it('命中：VP9（只给 warn）', () => {
    const r = r2v({ reference_video: [vid('a', 5, { codec: 'vp9' })] });
    expect(issue(r, 'C-MM-H3-7')?.severity).toBe('warn');
    expect(r.canSubmit).toBe(true);
  });
  it('不命中：h264 / HEVC / 编码未知', () => {
    expect(issueIds(r2v({ reference_video: [vid('a', 5, { codec: 'h264' }), vid('b', 5, { codec: 'HEVC' }), vid('c', 5)] }))).not.toContain('C-MM-H3-7');
  });
});

describe('C-MM-H3-8 mm_file 引用与有效期', () => {
  it('命中：不是 mm_file://、已过期', () => {
    expect(issue(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [mmFile('f', undefined, 'file://x')] } }), 'C-MM-H3-8')?.message.zh).toContain('mm_file://');
    const expired = evalForm(H3, { modeId: 'r2v', slots: { reference_video: [mmFile('v', Date.now() - 1)] } });
    expect(issue(expired, 'C-MM-H3-8')?.message.zh).toContain('7 天');
    expect(expired.canSubmit).toBe(false);
  });
  it('不命中：未过期或无过期时间', () => {
    expect(issueIds(evalForm(H3, { modeId: 'r2v', slots: { reference_video: [mmFile('v', Date.now() + 3600_000)], reference_audio: [mmFile('a')] } }))).not.toContain('C-MM-H3-8');
  });
});

describe('C-MM-H3-9 尾帧使用 mm_file（未核实）', () => {
  it('内联上限与素材解析器一致（10 MiB）', () => {
    expect(MINIMAX_INLINE_LIMIT).toBe(10 * 1024 * 1024);
  });
  it('命中：尾帧是 mm_file（warn）；仅尾帧模式同样提示', () => {
    const r = evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [mmFile('l')] } });
    expect(issue(r, 'C-MM-H3-9')?.severity).toBe('warn');
    expect(r.canSubmit).toBe(true);
    expect(issue(evalForm(MAX, { modeId: 'i2v_last', slots: { last_frame: [mmFile('l')] } }), 'C-MM-H3-9')?.severity).toBe('warn');
  });
  it('命中：本地尾帧超过 10 MiB，会被自动上传成 mm_file（warn）', () => {
    const big = localImg('l', { bytes: MINIMAX_INLINE_LIMIT + 1 });
    const r = evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [big] } });
    expect(issue(r, 'C-MM-H3-9')?.severity).toBe('warn');
    expect(issue(r, 'C-MM-H3-9')?.message.zh).toContain('自动上传');
    expect(r.canSubmit).toBe(true);
    expect(issueIds(evalForm(H3, { modeId: 'i2v_last', slots: { last_frame: [big] } }))).toContain('C-MM-H3-9');
  });
  it('不命中：首帧是 mm_file 或大图、尾帧是 URL、本地尾帧恰好 10 MiB、参考图是大图', () => {
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [mmFile('f')], last_frame: [img('l')] } }))).not.toContain('C-MM-H3-9');
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [localImg('f', { bytes: MINIMAX_INLINE_LIMIT + 1 })] } }))).not.toContain('C-MM-H3-9');
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [localImg('l', { bytes: MINIMAX_INLINE_LIMIT })] } }))).not.toContain('C-MM-H3-9');
    expect(issueIds(r2v({ reference_image: [localImg('r', { bytes: MINIMAX_INLINE_LIMIT + 1 })] }))).not.toContain('C-MM-H3-9');
  });
});

describe('C-MM-H3-10 提示词引用写法（未核实）', () => {
  it('命中：参考生视频提示 reference … n（官方示例措辞）；图生视频提示 Image n', () => {
    const r = evalForm(H3, { modeId: 'r2v', slots: { reference_image: [img('r')] }, prompt: 'make {{ref:r}} walk' });
    expect(issue(r, 'C-MM-H3-10')?.severity).toBe('warn');
    expect(issue(r, 'C-MM-H3-10')?.message.zh).toContain('reference image n / reference video n / reference audio n');
    expect(issue(r, 'C-MM-H3-10')?.message.zh).toContain('官方示例');
    const i = evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')] }, prompt: 'start from {{ref:f}}' });
    expect(issue(i, 'C-MM-H3-10')?.message.zh).toContain('「Image n」');
    expect(issue(i, 'C-MM-H3-10')?.message.zh).not.toContain('官方示例');
  });
  it('不命中：没有引用', () => {
    expect(issueIds(evalForm(H3, { modeId: 'r2v', slots: { reference_image: [img('r')] } }))).not.toContain('C-MM-H3-10');
  });
});

describe('C-MM-H3-11 H3-Max 参考生视频文档冲突', () => {
  it('命中：H3-Max 参考生视频（warn）', () => {
    expect(issue(r2v({ reference_image: [img('r')] }, MAX), 'C-MM-H3-11')?.severity).toBe('warn');
  });
  it('不命中：H3-Max 其他模式、H3 参考生视频', () => {
    expect(issueIds(evalForm(MAX))).not.toContain('C-MM-H3-11');
    expect(issueIds(r2v({ reference_image: [img('r')] }))).not.toContain('C-MM-H3-11');
  });
});

describe('C-MM-H3-12 仅尾帧文档冲突', () => {
  it('命中：两个模型的仅尾帧模式（warn，可提交）', () => {
    for (const id of [H3, MAX]) {
      const r = evalForm(id, { modeId: 'i2v_last', slots: { last_frame: [img('l')] } });
      expect(issue(r, 'C-MM-H3-12')?.severity).toBe('warn');
      expect(r.canSubmit).toBe(true);
    }
  });
  it('不命中：图生视频首尾帧、文生视频', () => {
    expect(issueIds(evalForm(H3, { modeId: 'i2v', slots: { first_frame: [img('f')], last_frame: [img('l')] } }))).not.toContain('C-MM-H3-12');
    expect(issueIds(evalForm(MAX))).not.toContain('C-MM-H3-12');
  });
});

/* ---------------- wireGuard ---------------- */

const T2V = {};
const I2V = { modeId: 'i2v', slots: { first_frame: [img('f')] } };
const I2V_LAST = { modeId: 'i2v_last', slots: { last_frame: [img('l')] } };
const R2V = { modeId: 'r2v', slots: { reference_image: [img('r')] } };
const text = { type: 'text', text: 'a cat' };
const item = (type: 'image_url' | 'video_url' | 'audio_url', role?: string, u = 'https://x.test/a') => ({ type, [type]: { url: u }, ...(role ? { role } : {}) });
const withContent = (content: unknown[], base: object = T2V) => ({ ...base, rawOverrides: { content } });

describe('wireGuard：默认请求全部通过', () => {
  it.each([
    ['H3 t2v', H3, T2V],
    ['H3 i2v', H3, I2V],
    ['H3 i2v_last', H3, I2V_LAST],
    ['H3 r2v', H3, R2V],
    ['Max t2v', MAX, T2V],
    ['Max i2v', MAX, I2V],
    ['Max i2v_last', MAX, I2V_LAST],
    ['Max r2v', MAX, R2V],
  ])('%s', (_n, id, over) => {
    expect(guardIds(run(id, over))).toEqual([]);
  });
});

describe('mm-h3-model', () => {
  it('命中：rawOverrides 把 model 改成另一个模型或删掉', () => {
    expect(guardIds(run(H3, { rawOverrides: { model: 'MiniMax-H3-Max' } }))).toContain('guard:mm-h3-model');
    expect(guardIds(run(MAX, { rawOverrides: { model: 'MiniMax-H3' } }))).toContain('guard:mm-h3-model');
    expect(guardIds(run(H3, { rawOverrides: { model: null } }))).toContain('guard:mm-h3-model');
  });
  it('命中：改成 H3-Max 后发 2K + 4 秒（H3 的范围检查放行，但 model 检查拦下）', () => {
    const ids = guardIds(run(H3, { values: { resolution: '2K', duration: 4 }, rawOverrides: { model: 'MiniMax-H3-Max' } }));
    expect(ids).toEqual(['guard:mm-h3-model']);
  });
  it('不命中：默认 model；modelOverride 被忽略（不允许覆盖）', () => {
    expect(guardIds(run(H3))).not.toContain('guard:mm-h3-model');
    const r = run(MAX, { modelOverride: 'MiniMax-H3' });
    expect(r.body.model).toBe('MiniMax-H3-Max');
    expect(guardIds(r)).toEqual([]);
  });
});

describe('mm-h3-text', () => {
  it('命中：没有 text 或 text 为空白', () => {
    expect(guardIds(run(H3, withContent([item('image_url', 'first_frame')], I2V)))).toContain('guard:mm-h3-text');
    expect(guardIds(run(H3, withContent([{ type: 'text', text: '  ' }])))).toContain('guard:mm-h3-text');
  });
  it('不命中：有非空 text', () => {
    expect(guardIds(run(H3, withContent([text])))).not.toContain('guard:mm-h3-text');
  });
});

describe('mm-h3-text-max', () => {
  it('命中：渲染后的 text 超过 7000 字符', () => {
    expect(guardIds(run(H3, withContent([{ type: 'text', text: 'a'.repeat(7001) }])))).toContain('guard:mm-h3-text-max');
  });
  it('不命中：7000 个汉字', () => {
    expect(guardIds(run(H3, { prompt: '猫'.repeat(7000) }))).not.toContain('guard:mm-h3-text-max');
  });
});

describe('mm-h3-media', () => {
  it('命中：空 url、未知类型、role 与类型不符、多素材缺 role、非对象条目', () => {
    expect(guardIds(run(H3, withContent([text, item('image_url', 'first_frame', '')], I2V)))).toContain('guard:mm-h3-media');
    expect(guardIds(run(H3, withContent([text, { type: 'file_url', file_url: { url: 'x' }, role: 'reference_image' }], R2V)))).toContain('guard:mm-h3-media');
    expect(guardIds(run(H3, withContent([text, item('video_url', 'first_frame')], R2V)))).toContain('guard:mm-h3-media');
    expect(guardIds(run(H3, withContent([text, item('image_url'), item('image_url', 'reference_image')], R2V)))).toContain('guard:mm-h3-media');
    expect(guardIds(run(H3, withContent([text, 'oops'])))).toContain('guard:mm-h3-media');
  });
  it('不命中：唯一一张图不写 role（默认当首帧）', () => {
    const r = run(H3, withContent([text, item('image_url')], I2V));
    expect(guardIds(r)).toEqual([]);
  });
});

describe('mm-h3-frames', () => {
  it('命中：非实验模式下只传尾帧、两张首帧、首帧混参考素材', () => {
    expect(guardIds(run(H3, withContent([text, item('image_url', 'last_frame')], I2V)))).toContain('guard:mm-h3-frames');
    expect(guardIds(run(H3, withContent([text, item('image_url', 'last_frame')], R2V)))).toContain('guard:mm-h3-frames');
    expect(guardIds(run(MAX, withContent([text, item('image_url', 'last_frame'), item('image_url', 'last_frame')], I2V_LAST)))).toContain('guard:mm-h3-frames');
    expect(guardIds(run(H3, withContent([text, item('image_url', 'first_frame'), item('image_url', 'first_frame')], I2V)))).toContain('guard:mm-h3-frames');
    expect(guardIds(run(H3, withContent([text, item('image_url', 'first_frame'), item('audio_url', 'reference_audio')], I2V)))).toContain('guard:mm-h3-frames');
  });
  it('不命中：首尾帧；实验模式仅尾帧', () => {
    expect(guardIds(run(H3, withContent([text, item('image_url', 'first_frame'), item('image_url', 'last_frame')], I2V)))).toEqual([]);
    expect(guardIds(run(H3, withContent([text, item('image_url', 'last_frame')], I2V_LAST)))).toEqual([]);
  });
});

describe('mm-h3-refs', () => {
  const refs = (img: number, vid: number, aud: number) => [
    text,
    ...Array.from({ length: img }, () => item('image_url', 'reference_image')),
    ...Array.from({ length: vid }, () => item('video_url', 'reference_video')),
    ...Array.from({ length: aud }, () => item('audio_url', 'reference_audio')),
  ];
  it('命中：参考图 10 张、视频 4 段、合计 13', () => {
    expect(guardIds(run(H3, withContent(refs(10, 0, 0), R2V)))).toContain('guard:mm-h3-refs');
    expect(guardIds(run(H3, withContent(refs(0, 4, 0), R2V)))).toContain('guard:mm-h3-refs');
    expect(guardIds(run(H3, withContent(refs(9, 3, 1), R2V)))).toContain('guard:mm-h3-refs');
  });
  it('不命中：9 + 3 = 12', () => {
    expect(guardIds(run(H3, withContent(refs(9, 3, 0), R2V)))).toEqual([]);
  });
});

describe('mm-h3-ratio', () => {
  it('命中：文生视频 adaptive / 缺失；任何模式的非法比例', () => {
    expect(guardIds(run(H3, { rawOverrides: { ratio: 'adaptive' } }))).toContain('guard:mm-h3-ratio');
    expect(guardIds(run(MAX, { rawOverrides: { ratio: null } }))).toContain('guard:mm-h3-ratio');
    expect(guardIds(run(H3, { ...R2V, rawOverrides: { ratio: '2:1' } }))).toContain('guard:mm-h3-ratio');
  });
  it('不命中：参考生视频 adaptive；图生视频不带 ratio', () => {
    expect(guardIds(run(H3, { ...R2V, values: { ratio: 'adaptive' } }))).not.toContain('guard:mm-h3-ratio');
    expect(guardIds(run(H3, I2V))).not.toContain('guard:mm-h3-ratio');
  });
});

describe('mm-h3-resolution', () => {
  it('命中：H3 发 480P、H3-Max 发 2K', () => {
    expect(guardIds(run(H3, { rawOverrides: { resolution: '480P' } }))).toContain('guard:mm-h3-resolution');
    expect(guardIds(run(MAX, { rawOverrides: { resolution: '2K' } }))).toContain('guard:mm-h3-resolution');
  });
  it('不命中：H3 2K、H3-Max 480P', () => {
    expect(guardIds(run(H3, { values: { resolution: '2K' } }))).toEqual([]);
    expect(guardIds(run(MAX, { values: { resolution: '480P' } }))).toEqual([]);
  });
});

describe('mm-h3-duration', () => {
  it('命中：H3 3 秒、H3-Max 4 秒、小数、缺失', () => {
    expect(guardIds(run(H3, { rawOverrides: { duration: 3 } }))).toContain('guard:mm-h3-duration');
    expect(guardIds(run(MAX, { rawOverrides: { duration: 4 } }))).toContain('guard:mm-h3-duration');
    expect(guardIds(run(H3, { rawOverrides: { duration: 5.5 } }))).toContain('guard:mm-h3-duration');
    expect(guardIds(run(H3, { values: { duration: null } }))).toContain('guard:mm-h3-duration');
  });
  it('不命中：H3 4 秒、H3-Max 15 秒', () => {
    expect(guardIds(run(H3, { values: { duration: 4 } }))).toEqual([]);
    expect(guardIds(run(MAX, { values: { duration: 15 } }))).toEqual([]);
  });
});

describe('mm-h3-extra', () => {
  it('命中：H3 带 extra；H3-Max 的 extra 取值非法或多字段', () => {
    expect(guardIds(run(H3, { rawOverrides: { extra: { prompt_expansion_mode: 'balanced' } } }))).toContain('guard:mm-h3-extra');
    expect(guardIds(run(MAX, { rawOverrides: { extra: { prompt_expansion_mode: 'balance' } } }))).toContain('guard:mm-h3-extra');
    expect(guardIds(run(MAX, { rawOverrides: { extra: { seed: 1 } } }))).toContain('guard:mm-h3-extra');
    expect(guardIds(run(MAX, { rawOverrides: { extra: { prompt_expansion_mode: '' } } }))).toContain('guard:mm-h3-extra');
    expect(guardIds(run(MAX, { rawOverrides: { extra: true } }))).toContain('guard:mm-h3-extra');
  });
  it('不命中：H3-Max quality；H3 不带 extra', () => {
    expect(guardIds(run(MAX, { values: { prompt_expansion_mode: 'quality' } }))).toEqual([]);
    expect(run(H3).body).not.toHaveProperty('extra');
  });
});

describe('mm-h3-video-data-uri', () => {
  const slots = { reference_video: [vid('v', 5)] };
  const as = (wire: string) => run(H3, { modeId: 'r2v', slots }, { v: { wire, preview: wire, bytes: wire.length } });
  it('命中：data:video/quicktime', () => {
    expect(guardIds(as('data:video/quicktime;base64,AAAA'))).toContain('guard:mm-h3-video-data-uri');
  });
  it('不命中：data:video/mp4、URL、mm_file', () => {
    expect(guardIds(as('data:video/mp4;base64,AAAA'))).toEqual([]);
    expect(guardIds(as('https://x.test/v.mov'))).toEqual([]);
    expect(guardIds(as('mm_file://1'))).toEqual([]);
  });
});
