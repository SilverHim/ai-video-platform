/** Seedance 模式与素材槽；首帧 / 首尾帧 / 全模态参考三类互斥，由模式天然保证 */
import type { AssetSourceType, MediaSpec, ModeDef, PromptSpec, SlotDef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { MB, T } from '../../../catalog/helpers.js';
import { MODE, PROMPT_SOFT_MAX, SLOT, type OmniLimits, type SeedanceKey, type SeedanceProfile } from './profile.js';

const IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'];
// 文档冲突：教程写图片宽高比 / 边长为开区间 (0.4, 2.5)、(300, 6000)，API 与 S25 为闭区间；这里按闭区间，边界值由 C-SE-8-boundary 给 warn
export const IMAGE_ASPECT: [number, number] = [0.4, 2.5];
export const IMAGE_SIDE: [number, number] = [300, 6000];
export const VIDEO_PIXELS: [number, number] = [407_696, 8_295_044];
/** 2.5 编辑任务的源视频每段 4–30 秒 */
export const EDIT_CLIP_SEC: [number, number] = [4, 30];

/** 单张"小于 30 MB" */
export function imageSpec(p: SeedanceProfile): MediaSpec {
  return { formats: p.heic ? [...IMAGE_FORMATS, 'heic', 'heif'] : IMAGE_FORMATS, maxBytes: 30 * MB - 1, side: IMAGE_SIDE, aspect: IMAGE_ASPECT };
}

/** 视频：mp4 / mov（H.264 / H.265），单个 ≤ 200 MB，FPS 24–60 */
export function videoSpec(clip: [number, number]): MediaSpec {
  return { formats: ['mp4', 'mov'], maxBytes: 200 * MB, side: IMAGE_SIDE, aspect: IMAGE_ASPECT, pixels: VIDEO_PIXELS, fps: [24, 60], durationSec: clip };
}

/** 音频：wav / mp3，单个 ≤ 15 MB */
export function audioSpec(clip: [number, number]): MediaSpec {
  return { formats: ['wav', 'mp3'], maxBytes: 15 * MB, durationSec: clip };
}

// 视频文档只列了 URL 与 asset://（没有 Base64），本地视频由服务端经 UploadTarget 换成公网直链
const SOURCES: AssetSourceType[] = ['url', 'provider-asset', 'task-output', 'local'];

/** 1.0 指南：首帧 / 尾帧建议用这几种比例，否则自动裁剪到最接近的比例 */
const V10_FRAME_TIP = T('；建议用 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 21:9 的图，其他比例会被自动裁剪到最接近的比例', '; prefer 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 21:9 images, others are auto-cropped to the closest of these');

function frameHelp(p: SeedanceProfile, first: boolean): I18nText {
  const base = first
    ? T('ratio 与图片宽高比不一致时居中裁剪', 'Center-cropped when the ratio differs from the image')
    : p.key === 'v25'
      ? // 文档冲突：API 写尾帧"自动裁剪"（全模型），2.5 提示词指南写 2.5 的尾帧"会被拉伸"；用户决定 2.5 按指南写拉伸
        T('宽高比与首帧不一致时，尾帧会被拉伸，建议首尾帧用同一比例；可与首帧是同一张图', 'Stretched when its aspect ratio differs from the first frame, so use the same ratio for both; may be the same image as the first frame')
      : T('宽高比与首帧不一致时，尾帧会被自动裁剪；可与首帧是同一张图', 'Cropped to the first frame aspect ratio when they differ; may be the same image as the first frame');
  return p.key === 'v10pro' || p.key === 'v10fast' ? T(base.zh + V10_FRAME_TIP.zh, base.en + V10_FRAME_TIP.en) : base;
}

function frameSlot(p: SeedanceProfile, which: 'first' | 'last'): SlotDef {
  const first = which === 'first';
  return {
    id: first ? SLOT.first : SLOT.last,
    kind: 'image',
    label: first ? T('首帧', 'First frame') : T('尾帧', 'Last frame'),
    role: first ? 'first_frame' : 'last_frame',
    min: 1,
    max: 1,
    sources: SOURCES,
    spec: imageSpec(p),
    help: frameHelp(p, first),
  };
}

/** 素材槽说明后面追加的稳定性建议（来自各自的提示词指南） */
interface SlotTips {
  image?: I18nText;
  video?: I18nText;
  audio?: I18nText;
}

/** 2.5 提示词指南「参考素材输入建议」 */
const TIPS_25_OMNI: SlotTips = {
  image: T('参考主体 1–8 个较稳定（9–12 个可能不稳定），超过 5 个主体时用单视角图；多格分镜不超过 15 格', '1–8 subjects are most stable (9–12 may be unstable); use single-view images beyond 5 subjects; keep storyboards to 15 panels or fewer'),
  video: T('做主体参考时 1–5 个主体、单段 5–10 秒较稳定', 'for subject references, 1–5 subjects and 5–10 s clips are most stable'),
  audio: T('做主体参考时 1–5 个主体、单段 5–10 秒较稳定', 'for subject references, 1–5 subjects and 5–10 s clips are most stable'),
};
const TIPS_25_EDIT: SlotTips = {
  image: T('编辑时参考图 1–5 张较稳定（6–8 张可能不稳定）', 'for edits, 1–5 reference images are most stable (6–8 may be unstable)'),
  video: T('源视频 20 秒以内效果较好', 'sources within 20 s work best'),
};
/** 2.0 提示词指南：人物参考与人数 */
const TIPS_20_OMNI: SlotTips = {
  image: T('人物参考建议用面部特写 + 全身照，不用三视图 / 多视图；同时参考的人物超过 4 个时稳定性下降', 'for people, use a facial close-up plus a full-body photo rather than three-view / multi-view sheets; stability drops beyond 4 referenced people'),
};

const withTip = (help: I18nText, tip?: I18nText): I18nText => (tip ? T(`${help.zh}；${tip.zh}`, `${help.en}; ${tip.en}`) : help);

function refSlots(p: SeedanceProfile, o: OmniLimits, opts: { videoMin: number; videoClip: [number, number]; audio: boolean; tips?: SlotTips }): SlotDef[] {
  const video: SlotDef = {
    id: SLOT.video,
    kind: 'video',
    label: T('参考视频', 'Reference videos'),
    role: 'reference_video',
    min: opts.videoMin,
    max: o.video,
    sources: SOURCES,
    spec: videoSpec(opts.videoClip),
    help: withTip(
      T(`最多 ${o.video} 段，单段 ${opts.videoClip[0]}–${opts.videoClip[1]} 秒、总时长 ≤ ${o.totalVideoSec} 秒；只接受 URL / asset://（本地文件需上传到临时托管站）`, `Up to ${o.video}, ${opts.videoClip[0]}–${opts.videoClip[1]} s each, ${o.totalVideoSec} s in total; URL / asset:// only (local files are uploaded to a temporary host)`),
      opts.tips?.video,
    ),
  };
  const image: SlotDef = {
    id: SLOT.image,
    kind: 'image',
    label: T('参考图', 'Reference images'),
    role: 'reference_image',
    min: 0,
    max: o.image,
    sources: SOURCES,
    spec: imageSpec(p),
    help: withTip(T(`最多 ${o.image} 张`, `Up to ${o.image}`), opts.tips?.image),
  };
  if (!opts.audio) return [image, video];
  return [
    image,
    video,
    {
      id: SLOT.audio,
      kind: 'audio',
      label: T('参考音频', 'Reference audio'),
      role: 'reference_audio',
      min: 0,
      max: o.audio,
      sources: SOURCES,
      spec: audioSpec(o.clipSec),
      help: withTip(
        o.audioOnly
          ? T(`最多 ${o.audio} 段，单段 ${o.clipSec[0]}–${o.clipSec[1]} 秒、总时长 ≤ ${o.totalAudioSec} 秒；可以只传音频`, `Up to ${o.audio}, ${o.clipSec[0]}–${o.clipSec[1]} s each, ${o.totalAudioSec} s in total; audio alone is allowed`)
          : T(`最多 ${o.audio} 段，单段 ${o.clipSec[0]}–${o.clipSec[1]} 秒、总时长 ≤ ${o.totalAudioSec} 秒；必须同时有图或视频`, `Up to ${o.audio}, ${o.clipSec[0]}–${o.clipSec[1]} s each, ${o.totalAudioSec} s in total; needs an image or video as well`),
        opts.tips?.audio,
      ),
    },
  ];
}

/** 提示词说明：refs 只给有参考素材的模式（全模态参考 / 编辑 / 延长），byMode 追加在通用说明之后 */
interface PromptHints {
  refs?: I18nText;
  common: I18nText;
  byMode?: Partial<Record<string, I18nText>>;
}

/**
 * 2.5：S25 模型页 Prompt rules 与 2.5 提示词指南。
 * 文档冲突：括号约定只有 S25 写了；2.5 提示词指南没定义，示例里 <> 也用来标素材和角色名、() 写时间段和情绪。用户决定保留 S25 写法并注明出处
 */
const HINTS_25: PromptHints = {
  refs: T('用 @Image 1 / @Video 1 / @Audio 1 按上传顺序引用素材，写明每个素材提供什么（外观、动作、音色等）、不参考什么', 'Refer to assets in upload order as @Image 1 / @Video 1 / @Audio 1 and say what each provides (appearance, action, timbre…) and what not to take from it'),
  common: T(
    '可按整秒时间戳分段（0-3s、3-7s，前后相接不留空档）；Seedance 2.5 教程页约定音乐写在 () 里、音效 <>、对白 {}、字幕【】，非中文对白先写明语言',
    'Integer-second timestamps can split the prompt (0-3s, 3-7s, with no gaps); per the Seedance 2.5 tutorial, music goes in (), sound effects in <>, dialogue in {}, subtitles in 【】, and the language is named before non-Chinese dialogue',
  ),
};

/** 2.0 系列：2.0 提示词指南（音乐用全角（），与指南表格一致） */
const HINTS_20: PromptHints = {
  refs: T('按上传顺序写 Image 1 / Video 1 / Audio 1（也可写 @Image 1）引用素材，写明从每个素材取什么，可用"名字@Image 1"绑定主体；不要写 asset ID', 'Refer to assets in upload order as Image 1 / Video 1 / Audio 1 (or @Image 1), say what to take from each and bind subjects as "Name@Image 1"; never write asset IDs'),
  common: T(
    '复杂内容用 Shot 1 / Shot 2 分镜，不要写 0-3 秒这类时间戳（2.0 不响应）；音乐写在（）里，音效 <>，对白 {}，字幕【】；对白不要中英混用（专有名词除外）',
    'Use Shot 1 / Shot 2 for complex videos instead of timestamps such as 0-3 s (2.0 ignores them); music in （）, sound effects in <>, dialogue in {}, subtitles in 【】; keep dialogue in one language (proper nouns excepted)',
  ),
};

/** 1.5 pro：1.5 pro 提示词指南（没有素材编号写法） */
const HINTS_15: PromptHints = {
  common: T(
    '按"主体 + 动作 + 环境 + 运镜 + 美学 + 声音"写；对白写成 说话人: "台词"，注明语言和情绪、语调、语速；音效写发声的事件，背景音乐写风格、情绪和节奏',
    'Write subject + movement + environment + camera + aesthetics + sound; write dialogue as Speaker: "line" with its language, emotion, tone and pace; describe sound effects as the events that make them and BGM by style, mood and rhythm',
  ),
  byMode: { [MODE.first]: T('用 this image / the input image 指代输入图，只写接下来的动作和变化，并写明要保持一致的外观', 'refer to the input as "this image" / "the input image", describe only what happens next and name the features that must stay consistent') },
};

/** 1.0 pro / pro fast：1.0 提示词指南（没有素材编号写法，图生示例直接称呼图中主体） */
const FRAME_10 = T('直接用图中主体的称呼（如 the man），不用 Image 1 编号', 'refer to the subject in the image directly (e.g. "the man"), not as "Image 1"');
const HINTS_10: PromptHints = {
  common: T('以"主体 + 动作"为基础，多个动作按发生顺序写；用运镜、景别、视角词控制镜头，多个镜头之间用 Camera switch 连接', 'Build on subject + action, writing several actions in the order they happen; steer the camera with movement, shot-size and angle words, and join shots with "Camera switch"'),
  byMode: { [MODE.t2v]: T('风格词可以放在句首（如 3D cartoon:）', 'a style can lead the prompt (e.g. "3D cartoon:")'), [MODE.first]: FRAME_10, [MODE.firstLast]: FRAME_10 },
};

const HINTS: Record<SeedanceKey, PromptHints> = { v25: HINTS_25, v20: HINTS_20, v20fast: HINTS_20, v20mini: HINTS_20, v15pro: HINTS_15, v10pro: HINTS_10, v10fast: HINTS_10 };
const REF_MODES: string[] = [MODE.omni, MODE.edit, MODE.extend];

const join = (parts: I18nText[]): I18nText => T(parts.map((x) => x.zh).join('；'), parts.map((x) => x.en).join('; '));

/** intent：编辑 / 延长必须写的意图词，放在最前 */
function promptSpec(p: SeedanceProfile, modeId: string, required: boolean, intent?: I18nText): PromptSpec {
  const h = HINTS[p.key];
  const extra = h.byMode?.[modeId];
  const hint = join([...(intent ? [intent] : []), ...(h.refs && REF_MODES.includes(modeId) ? [h.refs] : []), h.common, ...(extra ? [extra] : [])]);
  return { required, softMax: PROMPT_SOFT_MAX, ...(p.refLabel ? { refLabel: p.refLabel } : { refs: false as const }), hint };
}

const ADAPTIVE_REASON = T('Seedance 2.5 的首帧 / 首尾帧 / 编辑 / 延长只支持 adaptive（违反时任务异步失败）', 'Seedance 2.5 first-frame / first-last / edit / extend tasks only accept adaptive (otherwise the task fails asynchronously)');

function adaptiveLock(p: SeedanceProfile): ModeDef['locked'] {
  return p.adaptiveOnly ? { ratio: { value: 'adaptive', reason: ADAPTIVE_REASON } } : undefined;
}

export function buildModes(p: SeedanceProfile): ModeDef[] {
  const lock = adaptiveLock(p);
  const modes: ModeDef[] = [
    {
      id: MODE.t2v,
      label: T('文生视频', 'Text to video'),
      slots: [],
      prompt: promptSpec(p, MODE.t2v, true),
    },
    {
      id: MODE.first,
      label: T('首帧', 'First frame'),
      hint: T('用 1 张图作为视频第一帧', 'Uses one image as the first frame'),
      slots: [frameSlot(p, 'first')],
      prompt: promptSpec(p, MODE.first, false),
      ...(lock ? { locked: lock } : {}),
    },
  ];
  if (p.firstLast) {
    modes.push({
      id: MODE.firstLast,
      label: T('首尾帧', 'First + last frame'),
      hint: T('首帧 + 尾帧各 1 张；要求首尾帧严格一致时用这个模式', 'One first and one last frame; use this when the frames must match exactly'),
      slots: [frameSlot(p, 'first'), frameSlot(p, 'last')],
      prompt: promptSpec(p, MODE.firstLast, false),
      ...(lock ? { locked: lock } : {}),
    });
  }
  const o = p.omni;
  if (o) {
    modes.push({
      id: MODE.omni,
      label: T('全模态参考', 'Omni reference'),
      hint: o.audioOnly
        ? T(
            `参考图 / 视频 / 音频任意组合（${o.image}/${o.video}/${o.audio}），可以只传音频；模型按提示词里有没有编辑 / 延长触发词判断是参考生成、编辑还是延长；多主体按出场顺序上传；要严格按分镜出画面时把分镜逐张上传，第一句写 Use Images 1 to N in order as keyframes.；也可写 Image 1 is the first frame 让参考图当首帧（不锁比例，只是近似，严格首尾帧请用首尾帧模式）`,
            `Any mix of reference images / videos / audio (${o.image}/${o.video}/${o.audio}), audio alone allowed; edit / extend trigger words in the prompt decide between reference, edit and extend; upload subjects in order of appearance; for strict storyboard alignment upload each frame separately and open with "Use Images 1 to N in order as keyframes."; "Image 1 is the first frame" also works (ratio not locked, only approximate; use the first + last frame mode for exact frames)`,
          )
        : T(
            `参考图 / 视频 / 音频任意组合（${o.image}/${o.video}/${o.audio}），不能只传音频；编辑 / 延长视频也在这里：直接写 Video 1，不要写 reference Video 1（否则会被当成参考任务），如 Strictly edit Video 1, change … to … / Extend Video 1 backward …；建议素材总数 4–5 个，不必用满上限`,
            `Any mix of reference images / videos / audio (${o.image}/${o.video}/${o.audio}), not audio alone; edit / extend videos here too: write Video 1, not "reference Video 1" (that makes it a reference task), e.g. "Strictly edit Video 1, change … to …" / "Extend Video 1 backward …"; 4–5 assets in total work best, there is no need to use the full limit`,
          ),
      slots: refSlots(p, o, { videoMin: 0, videoClip: o.clipSec, audio: true, tips: p.key === 'v25' ? TIPS_25_OMNI : TIPS_20_OMNI }),
      prompt: promptSpec(p, MODE.omni, false),
    });
  }
  if (o && p.editExtend) {
    // 参考图：S25 配置方法里编辑 / 延长的提示词示例都引用了 @Image 1（"replace the character in @Video 1 with the character in @Image 1"），延长示例还用到 @Video 2
    // 参考音频：2.5 提示词指南的任务表把 reference_audio 列为编辑 / 延长的触发条件之一，API / S25 没写编辑 / 延长能否带参考音频及其限制；
    // 用户决定先不放音频槽，需要音频时用全模态参考（auto）
    modes.push(
      {
        id: MODE.edit,
        label: T('视频编辑', 'Edit video'),
        // 文档冲突：API / S25 写输出约短 0.4 秒，2.5 提示词指南写约 0.3 秒（FAQ 约 0.33 秒）；用户决定按 API / S25 写 0.4 秒。2.5 生成的输入无差异、8n+1 帧等长出自 2.5 指南
        hint: T(
          '对参考视频做增 / 删 / 改，可附参考图（如把 @Video 1 里的人物换成 @Image 1 的）；输出时长跟随原视频（可能略短约 0.4 秒；输入是 2.5 生成的视频时没有差异，输入帧数为 8n+1 时与原视频等长）；建议输入输出都用 mov',
          'Add / remove / modify content in the reference video, optionally with reference images (e.g. replace the character in @Video 1 with the one in @Image 1); output length follows the source (may be ~0.4 s shorter; no difference when the source was generated by Seedance 2.5, and equal length when the source has 8n+1 frames); mov is recommended for input and output',
        ),
        slots: refSlots(p, o, { videoMin: 1, videoClip: EDIT_CLIP_SEC, audio: false, tips: TIPS_25_EDIT }),
        prompt: promptSpec(
          p,
          MODE.edit,
          true,
          T('必须写明编辑意图，例如 edit the video / add / insert / remove / delete / modify / replace / change to …，尽量写成从 A 改为 B', 'State the edit intent, e.g. edit the video / add / insert / remove / delete / modify / replace / change to …, ideally as "change A to B"'),
        ),
        locked: {
          ...lock,
          duration: { value: -1, reason: T('编辑任务的时长只能是 -1（跟随原视频）', 'Edit tasks only accept duration -1 (follows the source)') },
        },
        wire: { omni_reference_task_type: 'edit' },
      },
      {
        id: MODE.extend,
        label: T('视频延长', 'Extend video'),
        hint: T('向前或向后延长参考视频，可附参考图 / 多段视频衔接；建议输入输出都用 mov', 'Extends the reference video forward or backward, optionally with reference images / more clips to connect; mov is recommended for input and output'),
        slots: refSlots(p, o, { videoMin: 1, videoClip: o.clipSec, audio: false }),
        // 触发词：S25 写 extend forward/backward、continue、continue the story，2.5 提示词指南另列 continue from、extend the story，这里取并集
        prompt: promptSpec(
          p,
          MODE.extend,
          true,
          T('必须写明延长意图，例如 extend forward / extend backward / continue / continue from / continue the story / extend the story …；有多段视频时点名延长哪一段', 'State the extend intent, e.g. extend forward / extend backward / continue / continue from / continue the story / extend the story …; name the video to extend when there are several'),
        ),
        ...(lock ? { locked: lock } : {}),
        wire: { omni_reference_task_type: 'extend' },
      },
    );
  }
  if (p.draft) {
    modes.push({
      id: MODE.final,
      label: T('样片转正片', 'Draft to final'),
      hint: T('用 7 天内的样片任务生成正式视频：提示词、素材、时长、比例等沿用样片，只能重设输出类参数', 'Turns a draft from the last 7 days into the final video: prompt, assets, duration, ratio etc. are reused; only output options can be changed'),
      entry: 'derived',
      slots: [],
      prompt: { required: false, hint: T('正片沿用样片的提示词，这里不用填写', 'The final reuses the draft prompt; leave this empty') },
      ...(p.key === 'v25'
        ? {
            locked: { resolution: { value: '1080p', reason: T('2.5 正片默认且只支持 1080p', 'Seedance 2.5 finals are 1080p only') } },
            // 文档冲突：S25 / TUT / API 写 2.5 支持样片，arkcli 目录写不支持；以官方文档为准，标实验
            experimental: true,
          }
        : {}),
    });
  }
  return modes;
}
