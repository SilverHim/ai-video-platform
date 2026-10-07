/** Seedance 模式与素材槽；首帧 / 首尾帧 / 全模态参考三类互斥，由模式天然保证 */
import type { AssetSourceType, MediaSpec, ModeDef, PromptSpec, SlotDef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { MB, T } from '../../../catalog/helpers.js';
import { MODE, PROMPT_SOFT_MAX, SLOT, type OmniLimits, type SeedanceProfile } from './profile.js';

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
    help: first ? T('ratio 与图片宽高比不一致时居中裁剪', 'Center-cropped when the ratio differs from the image') : T('宽高比与首帧不一致时，尾帧会被自动裁剪；可与首帧是同一张图', 'Cropped to the first frame aspect ratio when they differ; may be the same image as the first frame'),
  };
}

function refSlots(p: SeedanceProfile, o: OmniLimits, opts: { videoMin: number; videoClip: [number, number]; audio: boolean }): SlotDef[] {
  const video: SlotDef = {
    id: SLOT.video,
    kind: 'video',
    label: T('参考视频', 'Reference videos'),
    role: 'reference_video',
    min: opts.videoMin,
    max: o.video,
    sources: SOURCES,
    spec: videoSpec(opts.videoClip),
    help: T(`最多 ${o.video} 段，单段 ${opts.videoClip[0]}–${opts.videoClip[1]} 秒、总时长 ≤ ${o.totalVideoSec} 秒；只接受 URL / asset://（本地文件需上传到临时托管站）`, `Up to ${o.video}, ${opts.videoClip[0]}–${opts.videoClip[1]} s each, ${o.totalVideoSec} s in total; URL / asset:// only (local files are uploaded to a temporary host)`),
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
    help: T(`最多 ${o.image} 张`, `Up to ${o.image}`),
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
      help: o.audioOnly
        ? T(`最多 ${o.audio} 段，单段 ${o.clipSec[0]}–${o.clipSec[1]} 秒、总时长 ≤ ${o.totalAudioSec} 秒；可以只传音频`, `Up to ${o.audio}, ${o.clipSec[0]}–${o.clipSec[1]} s each, ${o.totalAudioSec} s in total; audio alone is allowed`)
        : T(`最多 ${o.audio} 段，单段 ${o.clipSec[0]}–${o.clipSec[1]} 秒、总时长 ≤ ${o.totalAudioSec} 秒；必须同时有图或视频`, `Up to ${o.audio}, ${o.clipSec[0]}–${o.clipSec[1]} s each, ${o.totalAudioSec} s in total; needs an image or video as well`),
    },
  ];
}

const SYNTAX_HINT_25 = T('用 @Image 1 / @Video 1 / @Audio 1 引用素材；音乐写在 () 里，音效 <>，对白 {}，字幕 【】', 'Refer to assets as @Image 1 / @Video 1 / @Audio 1; music in (), sound effects in <>, dialogue in {}, subtitles in 【】');
const SYNTAX_HINT = T('按同类素材顺序写 Image 1 / Video 1 / Audio 1 引用；不要写 asset ID', 'Refer to assets in order as Image 1 / Video 1 / Audio 1; never write asset IDs');

function promptSpec(p: SeedanceProfile, required: boolean, hint?: I18nText): PromptSpec {
  return { required, softMax: PROMPT_SOFT_MAX, refLabel: p.refLabel, hint: hint ?? (p.key === 'v25' ? SYNTAX_HINT_25 : SYNTAX_HINT) };
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
      prompt: promptSpec(p, true),
    },
    {
      id: MODE.first,
      label: T('首帧', 'First frame'),
      hint: T('用 1 张图作为视频第一帧', 'Uses one image as the first frame'),
      slots: [frameSlot(p, 'first')],
      prompt: promptSpec(p, false),
      ...(lock ? { locked: lock } : {}),
    },
  ];
  if (p.firstLast) {
    modes.push({
      id: MODE.firstLast,
      label: T('首尾帧', 'First + last frame'),
      hint: T('首帧 + 尾帧各 1 张；要求首尾帧严格一致时用这个模式', 'One first and one last frame; use this when the frames must match exactly'),
      slots: [frameSlot(p, 'first'), frameSlot(p, 'last')],
      prompt: promptSpec(p, false),
      ...(lock ? { locked: lock } : {}),
    });
  }
  const o = p.omni;
  if (o) {
    modes.push({
      id: MODE.omni,
      label: T('全模态参考', 'Omni reference'),
      hint: o.audioOnly
        ? T(`参考图 / 视频 / 音频任意组合（${o.image}/${o.video}/${o.audio}），可以只传音频；模型自动判断是参考生成、编辑还是延长`, `Any mix of reference images / videos / audio (${o.image}/${o.video}/${o.audio}), audio alone allowed; the model decides between reference, edit and extend`)
        : T(`参考图 / 视频 / 音频任意组合（${o.image}/${o.video}/${o.audio}），不能只传音频；编辑 / 延长视频也在这里，用提示词说明`, `Any mix of reference images / videos / audio (${o.image}/${o.video}/${o.audio}), not audio alone; edit / extend videos here by saying so in the prompt`),
      slots: refSlots(p, o, { videoMin: 0, videoClip: o.clipSec, audio: true }),
      prompt: promptSpec(p, false),
    });
  }
  if (o && p.editExtend) {
    // 参考图：S25 配置方法里编辑 / 延长的提示词示例都引用了 @Image 1（"replace the character in @Video 1 with the character in @Image 1"），延长示例还用到 @Video 2
    // 未核实：能否同时带参考音频没写，不放音频槽；需要音频时用全模态参考（auto）
    modes.push(
      {
        id: MODE.edit,
        label: T('视频编辑', 'Edit video'),
        hint: T('对参考视频做增 / 删 / 改，可附参考图（如把 @Video 1 里的人物换成 @Image 1 的）；输出时长跟随原视频（可能略短约 0.4 秒）', 'Add / remove / modify content in the reference video, optionally with reference images (e.g. replace the character in @Video 1 with the one in @Image 1); output length follows the source (may be ~0.4 s shorter)'),
        slots: refSlots(p, o, { videoMin: 1, videoClip: EDIT_CLIP_SEC, audio: false }),
        prompt: promptSpec(p, true, T('必须写明编辑意图，例如 edit the video / add / remove / replace / change …', 'State the edit intent, e.g. edit the video / add / remove / replace / change …')),
        locked: {
          ...lock,
          duration: { value: -1, reason: T('编辑任务的时长只能是 -1（跟随原视频）', 'Edit tasks only accept duration -1 (follows the source)') },
        },
        wire: { omni_reference_task_type: 'edit' },
      },
      {
        id: MODE.extend,
        label: T('视频延长', 'Extend video'),
        hint: T('向前或向后延长参考视频，可附参考图 / 多段视频衔接', 'Extends the reference video forward or backward, optionally with reference images / more clips to connect'),
        slots: refSlots(p, o, { videoMin: 1, videoClip: o.clipSec, audio: false }),
        prompt: promptSpec(p, true, T('必须写明延长意图，例如 extend forward / extend backward / continue the story …', 'State the extend intent, e.g. extend forward / extend backward / continue the story …')),
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
