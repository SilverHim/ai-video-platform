import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormInput } from '../../../../catalog/types.js';
import { OFFICIAL_LEGACY_FLAGS } from '../__fixtures__/responses.js';
import { ALL, V10, V10F, V15, V20, V20F, V20M, V20S, V25, aud, draftFrom, evalForm, guardIds, img, issueIds, model, vid } from './helpers.js';

const DAY = 24 * 3600_000;
const ids = (id: string, over: Partial<FormInput>) => issueIds(evalForm(id, over));
const issue = (id: string, over: Partial<FormInput>, cid: string) => evalForm(id, over).issues.find((i) => i.id === cid);

afterEach(() => {
  vi.useRealTimers();
});

const PROMPT = ['C-SE-16-legacy', 'C-SE-16-asset', 'C-SE-16-asset-id'];
const OMNI = ['C-SE-7-empty', 'C-SE-7-video-total', 'C-SE-7-audio-total', 'C-SE-7-unverified', 'C-SE-8-codec', 'C-SE-9'];
const FINAL = ['C-SE-6-source', 'C-SE-6-ttl', 'C-SE-6-model', 'C-SE-6-prompt'];
const DECLARED: [string, string[], string[]][] = [
  [V25, [...PROMPT, 'C-SE-8-boundary', 'C-SE-8-heic', ...OMNI, 'C-SE-3', 'C-SE-4', 'C-SE-2-auto', 'C-SE-2-clip', ...FINAL, 'C-SE-5-input'], ['content-resolved', 'role-exclusive', 'capability', 'C-SE-7', 'C-SE-2', 'C-SE-3', 'C-SE-5', 'C-SE-6', 'C-SE-13']],
  ...V20S.map((id): [string, string[], string[]] => [id, [...PROMPT, 'C-SE-16-zh', 'C-SE-8-boundary', ...OMNI, 'C-SE-7-audio-only', 'C-SE-20-auto'], ['content-resolved', 'role-exclusive', 'capability', 'C-SE-7', 'C-SE-13']]),
  [V15, [...PROMPT, 'C-SE-16-zh', 'C-SE-8-boundary', ...FINAL], ['content-resolved', 'role-exclusive', 'capability', 'C-SE-5', 'C-SE-6', 'C-SE-13']],
  [V10, [...PROMPT, 'C-SE-16-zh', 'C-SE-8-boundary'], ['content-resolved', 'role-exclusive', 'capability', 'C-SE-13']],
  [V10F, [...PROMPT, 'C-SE-16-zh', 'C-SE-8-boundary'], ['content-resolved', 'role-exclusive', 'capability', 'C-SE-13']],
];

describe('每个模型声明的约束与 guard', () => {
  it.each(DECLARED)('%s', (id, constraints, guards) => {
    expect(model(id).constraints.map((c) => c.id)).toEqual(constraints);
    expect(model(id).wireGuards?.map((g) => g.id)).toEqual(guards);
  });
});

describe('提示词 lint（C-SE-16）', () => {
  it.each(ALL)('%s：官方示例的 --rs / --rt / --dur / --seed / --cf / --wm 旧写法给 warn', (id) => {
    expect(issue(id, { prompt: `a cat ${OFFICIAL_LEGACY_FLAGS}` }, 'C-SE-16-legacy')?.severity).toBe('warn');
    expect(ids(id, { prompt: 'a cat --dur=5' })).toContain('C-SE-16-legacy');
    expect(ids(id, { prompt: 'a cat -- runs --fast' })).not.toContain('C-SE-16-legacy');
  });

  it.each(ALL)('%s：asset:// 写进提示词报 error；asset-xxx 形式（启发式）只给 warn', (id) => {
    expect(issue(id, { prompt: 'asset://abc dances' }, 'C-SE-16-asset')?.severity).toBe('error');
    expect(ids(id, { prompt: 'asset://abc dances' })).not.toContain('C-SE-16-asset-id');
    // PORT 的错误示例原文
    expect(issue(id, { prompt: 'asset-2026**** is a girl' }, 'C-SE-16-asset-id')?.severity).toBe('warn');
    expect(ids(id, { prompt: 'asset-2026**** is a girl' })).not.toContain('C-SE-16-asset');
    expect(ids(id, { prompt: 'a cat with assets' })).toEqual([...(id === V15 ? ['lifecycle'] : [])]);
  });

  it('C-SE-16-zh：2.0 系列与 1.x 的提示词含中文给 warn；2.5 不提示；2.0 含假名按日语处理', () => {
    for (const id of [...V20S, V15, V10, V10F]) {
      expect(issue(id, { prompt: '一只猫在跳舞' }, 'C-SE-16-zh')?.severity).toBe('warn');
      expect(ids(id, { prompt: 'a cat dancing' })).not.toContain('C-SE-16-zh');
    }
    expect(ids(V25, { prompt: '一只猫在跳舞' })).toEqual([]);
    for (const id of V20S) expect(ids(id, { prompt: '猫が踊っている' })).not.toContain('C-SE-16-zh');
    expect(ids(V10, { prompt: '猫が踊っている' })).toContain('C-SE-16-zh');
    // 素材引用 token 不算；正片不发提示词
    expect(ids(V20, { modeId: 'omni', prompt: '{{ref:i}} dances', slots: { reference_image: [img('i')] } })).toEqual([]);
    expect(ids(V15, { modeId: 'draft_final', derivedFrom: draftFrom(V15), prompt: '一只猫' })).not.toContain('C-SE-16-zh');
  });

  it('素材引用 token 的 id 不误判为 asset ID', () => {
    expect(ids(V20, { modeId: 'omni', prompt: '{{ref:asset-1}} dances', slots: { reference_image: [img('asset-1')] } })).toEqual([]);
  });

  it('正片模式不检查提示词 lint（提示词不发送）', () => {
    const r = ids(V25, { modeId: 'draft_final', derivedFrom: draftFrom(V25), prompt: `asset://x ${OFFICIAL_LEGACY_FLAGS}` });
    expect(r).not.toContain('C-SE-16-legacy');
    expect(r).not.toContain('C-SE-16-asset');
    expect(r).toContain('C-SE-6-prompt');
  });
});

describe('素材约束', () => {
  it('C-SE-7-empty：全模态参考至少 1 个素材', () => {
    for (const id of [V25, ...V20S]) {
      expect(issue(id, { modeId: 'omni', slots: {} }, 'C-SE-7-empty')?.severity).toBe('error');
      expect(ids(id, { modeId: 'omni', slots: { reference_video: [vid('v')] } })).not.toContain('C-SE-7-empty');
    }
  });

  it('C-SE-7-audio-only：2.0 系列不能只传音频，2.5 可以', () => {
    for (const id of V20S) {
      expect(issue(id, { modeId: 'omni', slots: { reference_audio: [aud('a')] } }, 'C-SE-7-audio-only')?.severity).toBe('error');
      expect(ids(id, { modeId: 'omni', slots: { reference_audio: [aud('a')], reference_image: [img('i')] } })).toEqual([]);
    }
    expect(ids(V25, { modeId: 'omni', slots: { reference_audio: [aud('a')] } })).toEqual([]);
  });

  it('C-SE-7-video-total：2.5 总长 ≤ 30 秒，2.0 系列 ≤ 15 秒', () => {
    const vids = (n: number, sec: number) => Array.from({ length: n }, (_, i) => vid(`v${i}`, { durationSec: sec }));
    expect(issue(V25, { modeId: 'omni', slots: { reference_video: vids(4, 8) } }, 'C-SE-7-video-total')?.severity).toBe('error');
    expect(ids(V25, { modeId: 'omni', slots: { reference_video: vids(3, 10) } })).toEqual([]);
    expect(ids(V25, { modeId: 'edit', prompt: 'remove the hat', slots: { reference_video: vids(2, 16) } })).toContain('C-SE-7-video-total');
    expect(ids(V20, { modeId: 'omni', slots: { reference_video: vids(2, 8) } })).toContain('C-SE-7-video-total');
    expect(ids(V20F, { modeId: 'omni', slots: { reference_video: vids(3, 5) } })).toEqual([]);
  });

  it('C-SE-7-audio-total：2.5 总长 ≤ 30 秒，2.0 系列 ≤ 15 秒', () => {
    const auds = (n: number, sec: number) => Array.from({ length: n }, (_, i) => aud(`a${i}`, { durationSec: sec }));
    expect(issue(V25, { modeId: 'omni', slots: { reference_audio: auds(2, 16) } }, 'C-SE-7-audio-total')?.severity).toBe('error');
    expect(ids(V25, { modeId: 'omni', slots: { reference_audio: auds(3, 10) } })).toEqual([]);
    expect(ids(V20M, { modeId: 'omni', slots: { reference_image: [img('i')], reference_audio: auds(2, 8) } })).toContain('C-SE-7-audio-total');
    expect(ids(V20M, { modeId: 'omni', slots: { reference_image: [img('i')], reference_audio: auds(3, 5) } })).toEqual([]);
  });

  it('C-SE-7-unverified：URL / asset:// 视频音频读不到时长时提示未校验', () => {
    expect(issue(V25, { modeId: 'omni', slots: { reference_video: [vid('v', null)] } }, 'C-SE-7-unverified')?.severity).toBe('warn');
    expect(ids(V20, { modeId: 'omni', slots: { reference_video: [vid('v', null, { type: 'provider-asset', uri: 'asset://x' })] } })).toContain('C-SE-7-unverified');
    expect(ids(V20, { modeId: 'omni', slots: { reference_video: [vid('v')] } })).not.toContain('C-SE-7-unverified');
    // 本地素材缺元数据由引擎统一提示
    const local = vid('v', null, { type: 'local', assetId: 'x', mime: 'video/mp4', bytes: 10 });
    expect(ids(V20, { modeId: 'omni', slots: { reference_video: [local] } })).not.toContain('C-SE-7-unverified');
  });

  it('C-SE-8-boundary：图片恰好落在 300 / 6000 或 0.4 / 2.5 边界给 warn（开闭区间文档冲突）', () => {
    expect(issue(V25, { modeId: 'i2v_first', slots: { first_frame: [img('f', { width: 300, height: 400 })] } }, 'C-SE-8-boundary')?.severity).toBe('warn');
    expect(ids(V10, { modeId: 'i2v_first', slots: { first_frame: [img('f', { width: 1500, height: 600 })] } })).toContain('C-SE-8-boundary');
    expect(ids(V20, { modeId: 'omni', slots: { reference_image: [img('i', { width: 600, height: 1500 })] } })).toContain('C-SE-8-boundary');
    expect(ids(V25, { modeId: 'i2v_first', slots: { first_frame: [img('f', { width: 301, height: 400 })] } })).toEqual([]);
  });

  it('C-SE-8-heic：2.5 收到 heic / heif 图片给文档冲突 warn；2.0 系列不提示', () => {
    const heic = img('f', { mime: 'image/heic' });
    expect(issue(V25, { modeId: 'i2v_first', slots: { first_frame: [heic] } }, 'C-SE-8-heic')?.severity).toBe('warn');
    expect(ids(V25, { modeId: 'omni', slots: { reference_image: [img('i', { mime: 'image/heif' })] } })).toContain('C-SE-8-heic');
    const url = { id: 'u', source: { type: 'url' as const, url: 'https://media.test/a.HEIC?x=1' } };
    expect(ids(V25, { modeId: 'omni', slots: { reference_image: [url] } })).toContain('C-SE-8-heic');
    const local = { id: 'l', source: { type: 'local' as const, assetId: 'x', mime: 'image/heif', bytes: 10 } };
    expect(ids(V25, { modeId: 'i2v_first', slots: { first_frame: [local] } })).toContain('C-SE-8-heic');
    expect(ids(V25, { modeId: 'i2v_first', slots: { first_frame: [img('f')] } })).toEqual([]);
    expect(ids(V20, { modeId: 'i2v_first', slots: { first_frame: [heic] } })).toEqual([]);
  });

  it('C-SE-8-codec：视频编码不是 H.264 / H.265 给 warn', () => {
    expect(issue(V25, { modeId: 'omni', slots: { reference_video: [vid('v', { codec: 'vp9' })] } }, 'C-SE-8-codec')?.severity).toBe('warn');
    for (const codec of ['h264', 'hevc', 'H.265']) expect(ids(V25, { modeId: 'omni', slots: { reference_video: [vid('v', { codec })] } })).toEqual([]);
  });

  it('C-SE-9：本地视频提示需要上传到临时托管站', () => {
    const local = vid('v', {}, { type: 'local', assetId: 'x', mime: 'video/mp4', bytes: 10 });
    expect(issue(V20, { modeId: 'omni', slots: { reference_video: [local] } }, 'C-SE-9')?.severity).toBe('info');
    expect(ids(V20, { modeId: 'omni', slots: { reference_video: [vid('v')] } })).not.toContain('C-SE-9');
  });
});

describe('任务类型与时长', () => {
  it('C-SE-3：编辑提示词缺编辑意图关键词给 warn', () => {
    const edit = (prompt: string) => ({ modeId: 'edit', prompt, slots: { reference_video: [vid('v')] } });
    expect(issue(V25, edit('make it night'), 'C-SE-3')?.severity).toBe('warn');
    expect(ids(V25, edit('address the camera'))).toContain('C-SE-3');
    for (const p of ['Replace the sky with stars', 'edit the video: night', 'remove the hat', 'changing colors']) expect(ids(V25, edit(p))).toEqual([]);
    // 空提示词由引擎报必填
    expect(ids(V25, edit(''))).toEqual(['prompt:required']);
  });

  it('C-SE-4：延长提示词缺延长意图关键词给 warn', () => {
    const ext = (prompt: string) => ({ modeId: 'extend', prompt, slots: { reference_video: [vid('v')] } });
    expect(issue(V25, ext('more of this'), 'C-SE-4')?.severity).toBe('warn');
    for (const p of ['extend backward', 'continue the story', 'Continues walking']) expect(ids(V25, ext(p))).toEqual([]);
  });

  it('C-SE-2-auto：2.5 全模态参考带视频且非 adaptive + -1 时给 warn 与一键修复', () => {
    const over = { modeId: 'omni', values: { ratio: '16:9' }, slots: { reference_video: [vid('v')] } };
    const hit = issue(V25, over, 'C-SE-2-auto');
    expect(hit).toMatchObject({ severity: 'warn', fix: { patch: { ratio: 'adaptive', duration: -1 } } });
    expect(ids(V25, { ...over, values: { ...over.values, ...hit!.fix!.patch } })).toEqual([]);
    expect(ids(V25, { modeId: 'omni', values: { duration: 10 }, slots: { reference_video: [vid('v')] } })).toContain('C-SE-2-auto');
    expect(ids(V25, { modeId: 'omni', values: { ratio: '16:9' }, slots: { reference_image: [img('i')] } })).toEqual([]);
  });

  it('C-SE-2-clip：2.5 全模态参考有短于 4 秒的参考视频给 warn（即使用了 adaptive + -1）', () => {
    const over = (sec: number) => ({ modeId: 'omni', slots: { reference_video: [vid('v1'), vid('v2', { durationSec: sec })] } });
    expect(issue(V25, over(3), 'C-SE-2-clip')?.severity).toBe('warn');
    expect(ids(V25, over(3))).not.toContain('C-SE-2-auto');
    expect(ids(V25, over(4))).toEqual([]);
    // 读不到时长时不在这里重复提示（由 C-SE-7-unverified 提示）
    expect(ids(V25, { modeId: 'omni', slots: { reference_video: [vid('v', null)] } })).not.toContain('C-SE-2-clip');
    // 延长模式单段 2–30 秒合法，不提示
    expect(ids(V25, { modeId: 'extend', prompt: 'continue', slots: { reference_video: [vid('v', { durationSec: 3 })] } })).toEqual([]);
  });

  it('编辑 / 延长可带参考图：提示词可引用 @Image 1，不报 prompt:refs', () => {
    const slots = { reference_image: [img('i')], reference_video: [vid('v')] };
    expect(ids(V25, { modeId: 'edit', prompt: 'replace the character in {{ref:v}} with the character in {{ref:i}}', slots })).toEqual([]);
    expect(ids(V25, { modeId: 'extend', prompt: 'extend {{ref:v}} and add {{ref:i}}', slots })).toEqual([]);
    // 仍然至少要 1 段参考视频
    expect(ids(V25, { modeId: 'edit', prompt: 'remove the hat', slots: { reference_image: [img('i')] } })).toContain('slot-min:reference_video');
  });

  it('C-SE-20-auto：2.0 系列选 -1 给文档冲突 warn', () => {
    for (const id of V20S) {
      expect(issue(id, { values: { duration: -1 } }, 'C-SE-20-auto')?.severity).toBe('warn');
      expect(ids(id, { values: { duration: 15 } })).toEqual([]);
    }
  });

  it('C-SE-5-input：2.5 全模态参考开样片给未核实 warn；文生开样片不提示', () => {
    expect(issue(V25, { modeId: 'omni', values: { draft: true }, slots: { reference_image: [img('i')] } }, 'C-SE-5-input')?.severity).toBe('warn');
    expect(ids(V25, { modeId: 'omni', slots: { reference_image: [img('i')] } })).toEqual([]);
    expect(ids(V25, { values: { draft: true } })).toEqual([]);
  });
});

describe('正片（C-SE-6）', () => {
  const final = (id: string, over: Partial<FormInput> = {}): Partial<FormInput> => ({ modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(id), ...over });

  it('C-SE-6-source：缺少样片、关系不对、模型不同 → error', () => {
    for (const id of [V25, V15]) {
      const { derivedFrom: _omit, ...noSource } = final(id);
      expect(issue(id, noSource, 'C-SE-6-source')?.severity).toBe('error');
      expect(ids(id, final(id, { derivedFrom: draftFrom(id, { relation: 'edit' }) }))).toContain('C-SE-6-source');
      expect(ids(id, final(id, { derivedFrom: draftFrom(id, { upstreamTaskId: '' }) }))).toContain('C-SE-6-source');
      expect(ids(id, final(id, { derivedFrom: draftFrom(id === V25 ? V15 : V25) }))).toContain('C-SE-6-source');
      expect(ids(id, final(id))).not.toContain('C-SE-6-source');
      expect(ids(id, final(id, { derivedFrom: draftFrom(model(id).apiModel) }))).not.toContain('C-SE-6-source');
    }
  });

  it('C-SE-6-ttl：样片超过 7 天 → error', () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const now = Date.now();
    for (const id of [V25, V15]) {
      expect(issue(id, final(id, { derivedFrom: draftFrom(id, { createdAt: now - 7 * DAY }) }), 'C-SE-6-ttl')?.severity).toBe('error');
      expect(ids(id, final(id, { derivedFrom: draftFrom(id, { createdAt: now - 7 * DAY + 60_000 }) }))).not.toContain('C-SE-6-ttl');
    }
  });

  it('C-SE-6-model：正片用了 Endpoint 覆盖时给 warn（无法核对是否与样片相同）', () => {
    for (const id of [V25, V15]) {
      expect(issue(id, final(id, { modelOverride: 'ep-20261008-xyz' }), 'C-SE-6-model')?.severity).toBe('warn');
      expect(ids(id, final(id))).not.toContain('C-SE-6-model');
    }
    expect(ids(V25, { modelOverride: 'ep-20261008-xyz' })).toEqual([]);
  });

  it('C-SE-6-prompt：正片填了提示词给 warn（不会发送）', () => {
    expect(issue(V25, final(V25, { prompt: 'new idea' }), 'C-SE-6-prompt')?.severity).toBe('warn');
    expect(ids(V25, final(V25))).toEqual([]);
  });

  it('正片不能带素材（引擎报未知槽位）', () => {
    expect(ids(V25, final(V25, { slots: { first_frame: [img('f')] } }))).toContain('slot-unknown:first_frame');
  });
});

describe('wireGuard（经 rawOverrides 注入违规字段）', () => {
  const first = { modeId: 'i2v_first', slots: { first_frame: [img('f')] } };
  const editVid = { modeId: 'edit', prompt: 'remove the hat', slots: { reference_video: [vid('v')] } };
  const finalOf = (id: string, raw?: Record<string, unknown>): Partial<FormInput> => ({ modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(id), ...(raw ? { rawOverrides: raw } : {}) });

  it('C-SE-2：2.5 请求体出现 first_frame / last_frame role 或编辑 / 延长时 ratio 必须 adaptive', () => {
    expect(guardIds(V25, { ...first, rawOverrides: { ratio: '16:9' } })).toContain('guard:C-SE-2');
    expect(guardIds(V25, { ...editVid, rawOverrides: { ratio: '1:1' } })).toContain('guard:C-SE-2');
    expect(guardIds(V25, first)).toEqual([]);
    // 文生视频不受限
    expect(guardIds(V25, { values: { ratio: '16:9' } })).toEqual([]);
    expect(guardIds(V25, { rawOverrides: { content: [{ type: 'text', text: 'x' }], ratio: '4:3' } })).toEqual([]);
  });

  it('C-SE-3：omni_reference_task_type=edit 时 duration 必须 -1；编辑 / 延长必须带参考视频', () => {
    expect(guardIds(V25, { ...editVid, rawOverrides: { duration: 5 } })).toContain('guard:C-SE-3');
    expect(guardIds(V25, { ...editVid, rawOverrides: { content: [{ type: 'text', text: 'remove the hat' }] } })).toContain('guard:C-SE-3');
    expect(guardIds(V25, editVid)).toEqual([]);
    expect(guardIds(V25, { modeId: 'extend', prompt: 'continue', values: { duration: 8 }, slots: { reference_video: [vid('v')] } })).toEqual([]);
  });

  it('C-SE-5：draft=true 时 resolution 必须是 480p', () => {
    expect(guardIds(V25, { values: { draft: true }, rawOverrides: { resolution: '720p' } })).toContain('guard:C-SE-5');
    expect(guardIds(V15, { rawOverrides: { draft: true } })).toContain('guard:C-SE-5');
    expect(guardIds(V15, { values: { draft: true } })).toEqual([]);
  });

  it('C-SE-6：带 draft_task 时不得出现 text / 素材 / duration / ratio / seed / generate_audio / omni_reference_task_type', () => {
    for (const id of [V25, V15]) {
      expect(guardIds(id, finalOf(id))).toEqual([]);
      for (const [k, v] of [['duration', 5], ['ratio', 'adaptive'], ['seed', 1], ['generate_audio', true], ['omni_reference_task_type', 'auto'], ['camera_fixed', false], ['draft', true]] as const) {
        expect(guardIds(id, finalOf(id, { [k]: v }))).toContain('guard:C-SE-6');
      }
      const draftItem = { type: 'draft_task', draft_task: { id: 'cgt-draft-1' } };
      expect(guardIds(id, finalOf(id, { content: [draftItem, { type: 'text', text: 'x' }] }))).toContain('guard:C-SE-6');
      expect(guardIds(id, finalOf(id, { content: [draftItem, { type: 'image_url', image_url: { url: 'https://x' }, role: 'first_frame' }] }))).toContain('guard:C-SE-6');
    }
    // 2.5 正片只支持 1080p；1.5 pro 可重设分辨率
    expect(guardIds(V25, finalOf(V25, { resolution: '720p' }))).toContain('guard:C-SE-6');
    expect(guardIds(V25, finalOf(V25, { resolution: '1080p' }))).toEqual([]);
    expect(guardIds(V15, finalOf(V15, { resolution: '480p' }))).toEqual([]);
  });

  it('C-SE-7：参考素材数量与 2.0 只传音频', () => {
    const videoItem = (i: number) => ({ type: 'video_url', video_url: { url: `https://v/${i}` }, role: 'reference_video' });
    const audioItem = { type: 'audio_url', audio_url: { url: 'https://a/1' }, role: 'reference_audio' };
    expect(guardIds(V20, { rawOverrides: { content: [0, 1, 2, 3].map(videoItem) } })).toContain('guard:C-SE-7');
    expect(guardIds(V20, { rawOverrides: { content: [0, 1, 2].map(videoItem) } })).toEqual([]);
    expect(guardIds(V25, { rawOverrides: { content: Array.from({ length: 10 }, (_, i) => videoItem(i)) } })).toEqual([]);
    expect(guardIds(V20M, { rawOverrides: { content: [{ type: 'text', text: 'x' }, audioItem] } })).toContain('guard:C-SE-7');
    expect(guardIds(V25, { rawOverrides: { content: [{ type: 'text', text: 'x' }, audioItem] } })).toEqual([]);
  });

  it('C-SE-13：flex 只给 1.x，1.5 pro 样片也不行', () => {
    for (const id of [V25, ...V20S]) expect(guardIds(id, { rawOverrides: { service_tier: 'flex' } })).toContain('guard:C-SE-13');
    expect(guardIds(V15, { values: { draft: true }, rawOverrides: { service_tier: 'flex' } })).toContain('guard:C-SE-13');
    for (const id of [V15, V10, V10F]) expect(guardIds(id, { values: { service_tier: 'flex' } })).toEqual([]);
  });

  it('content-resolved：content 为空、素材未解析、未知类型、正片缺 id', () => {
    expect(guardIds(V20, { prompt: '' })).toContain('guard:content-resolved');
    expect(guardIds(V20, { rawOverrides: { content: [{ type: 'image_url', image_url: { url: '' }, role: 'reference_image' }] } })).toContain('guard:content-resolved');
    expect(guardIds(V20, { rawOverrides: { content: [{ type: 'file_url', file_url: { url: 'x' } }] } })).toContain('guard:content-resolved');
    expect(guardIds(V25, { modeId: 'draft_final', prompt: '', derivedFrom: draftFrom(V25, { upstreamTaskId: '' }) })).toContain('guard:content-resolved');
    expect(guardIds(V20, { modeId: 'omni', slots: { reference_image: [img('i')] } })).toEqual([]);
  });

  it('role-exclusive：首帧 / 首尾帧与参考素材不能混用；首尾帧各 1 张', () => {
    const frame = (role: string) => ({ type: 'image_url', image_url: { url: 'https://i' }, role });
    expect(guardIds(V20, { rawOverrides: { content: [frame('first_frame'), frame('reference_image')] } })).toContain('guard:role-exclusive');
    expect(guardIds(V20, { rawOverrides: { content: [frame('first_frame'), frame('first_frame')] } })).toContain('guard:role-exclusive');
    expect(guardIds(V20, { rawOverrides: { content: [frame('last_frame')] } })).toContain('guard:role-exclusive');
    expect(guardIds(V20, { rawOverrides: { content: [frame('first_frame'), frame('last_frame')] } })).toEqual([]);
  });

  it('capability：模型不支持的能力不能混进请求', () => {
    const video = { type: 'video_url', video_url: { url: 'https://v' }, role: 'reference_video' };
    expect(guardIds(V10, { rawOverrides: { content: [video] } })).toContain('guard:capability');
    expect(guardIds(V15, { rawOverrides: { content: [{ type: 'image_url', image_url: { url: 'https://i' }, role: 'reference_image' }] } })).toContain('guard:capability');
    expect(guardIds(V10F, { rawOverrides: { content: [{ type: 'image_url', image_url: { url: 'https://a' }, role: 'first_frame' }, { type: 'image_url', image_url: { url: 'https://b' }, role: 'last_frame' }] } })).toContain('guard:capability');
    expect(guardIds(V20, { rawOverrides: { omni_reference_task_type: 'edit' } })).toContain('guard:capability');
    expect(guardIds(V20, { rawOverrides: { draft: true } })).toContain('guard:capability');
    expect(guardIds(V10, { rawOverrides: { content: [{ type: 'draft_task', draft_task: { id: 'cgt-1' } }] } })).toContain('guard:capability');
    expect(guardIds(V20, { rawOverrides: { output_format: 'mov' } })).toContain('guard:capability');
    expect(guardIds(V25, { rawOverrides: { frames: 121 } })).toContain('guard:capability');
    // 文档按模型列了适用范围：generate_audio（2.5 / 2.0 / 1.5 pro）、priority（2.5 / 2.0）、resolution 枚举
    for (const id of [V10, V10F]) expect(guardIds(id, { rawOverrides: { generate_audio: true } })).toContain('guard:capability');
    expect(guardIds(V15, { rawOverrides: { generate_audio: false } })).toEqual([]);
    for (const id of [V15, V10, V10F]) expect(guardIds(id, { rawOverrides: { priority: 1 } })).toContain('guard:capability');
    expect(guardIds(V20M, { rawOverrides: { priority: 9 } })).toEqual([]);
    for (const id of [V20F, V20M]) for (const r of ['1080p', '4k']) expect(guardIds(id, { rawOverrides: { resolution: r } })).toContain('guard:capability');
    for (const id of [V25, V15, V10, V10F]) expect(guardIds(id, { rawOverrides: { resolution: '4k' } })).toContain('guard:capability');
    expect(guardIds(V20, { rawOverrides: { resolution: '4k' } })).toEqual([]);
    // seed / camera_fixed 对 2.x 按方案留给 rawOverrides
    expect(guardIds(V25, { rawOverrides: { seed: 1, camera_fixed: true } })).toEqual([]);
    for (const id of ALL) expect(guardIds(id, {})).toEqual([]);
    expect(guardIds(V25, { rawOverrides: { omni_reference_task_type: 'reference', content: [video] } })).toEqual([]);
  });
});
