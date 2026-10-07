/** MiniMax V2 视频的字段、素材槽与模式声明 */
import type { AssetSourceType, FieldDef, MediaKind, MediaSpec, ModeDef, PromptSpec, SlotDef } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import {
  DOCS,
  EXPANSION_MODES,
  MODE_I2V,
  MODE_I2V_LAST,
  MODE_R2V,
  MODE_T2V,
  RATIOS,
  REF_LIMITS,
  SLOT_FIRST,
  SLOT_LAST,
  SLOT_REF_AUDIO,
  SLOT_REF_IMAGE,
  SLOT_REF_VIDEO,
  TEXT_MAX_CHARS,
  type H3Profile,
} from './profile.js';

/* ---------------- 字段 ---------------- */

const FIELD_DOCS = [DOCS.create, DOCS.spec];
/** 未核实：文生视频的 ratio 必填但没有默认值，取官方示例用的 16:9 */
export const T2V_DEFAULT_RATIO = '16:9';

const RATIO_LABELS: Record<string, ReturnType<typeof T>> = {
  adaptive: T('自适应', 'Adaptive'),
};

export function h3Fields(p: H3Profile): FieldDef[] {
  const fields: FieldDef[] = [
    {
      key: 'resolution',
      type: 'enum',
      label: T('分辨率', 'Resolution'),
      help: T(`可选 ${p.resolutions.join(' / ')}；必填，一律显式发送`, `${p.resolutions.join(' / ')}; required and always sent`),
      group: 'basic',
      wire: 'resolution',
      default: p.defaultResolution,
      control: 'segmented',
      options: p.resolutions.map((value) => ({ value })),
      docs: FIELD_DOCS,
    },
    {
      key: 'duration',
      type: 'int',
      label: T('时长（秒）', 'Duration (s)'),
      help: T(`${p.duration[0]}–${p.duration[1]} 秒的整数；必填`, `Integer ${p.duration[0]}–${p.duration[1]} seconds; required`),
      group: 'basic',
      wire: 'duration',
      default: p.defaultDuration,
      min: p.duration[0],
      max: p.duration[1],
      step: 1,
      docs: FIELD_DOCS,
    },
    {
      key: 'ratio',
      type: 'enum',
      label: T('画面比例', 'Aspect ratio'),
      help: T(
        '文生视频必须指定具体比例；参考生视频默认自适应；图生视频始终跟随首帧，不发送该字段',
        'Text-to-video needs a specific ratio; reference-to-video defaults to adaptive; image-to-video always follows the first frame and omits this field',
      ),
      group: 'basic',
      // 图生视频：文档写始终按 adaptive 处理、传其他值会被忽略 → 不发送
      modes: [MODE_T2V, MODE_R2V],
      wire: 'ratio',
      default: (c) => (c.mode.id === MODE_T2V ? T2V_DEFAULT_RATIO : 'adaptive'),
      control: 'select',
      options: RATIOS.map((value) => ({
        value,
        ...(RATIO_LABELS[value] ? { label: RATIO_LABELS[value] } : {}),
        ...(value === 'adaptive'
          ? { unavailable: (c) => (c.mode.id === MODE_T2V ? T('文生视频必须指定具体比例，不能自适应', 'Text-to-video needs a specific ratio, not adaptive') : null) }
          : {}),
      })),
      docs: FIELD_DOCS,
    },
  ];
  if (p.promptExpansion) {
    fields.push({
      key: 'prompt_expansion_mode',
      type: 'enum',
      label: T('提示词扩写', 'Prompt expansion'),
      help: T('关闭 / 均衡（默认）/ 质量优先；extra 只接受这一个字段', 'Disabled / balanced (default) / quality; extra accepts only this field'),
      group: 'advanced',
      wire: 'extra.prompt_expansion_mode',
      default: 'balanced',
      control: 'segmented',
      options: EXPANSION_MODES.map((value) => ({
        value,
        label: value === 'disabled' ? T('关闭', 'Disabled') : value === 'balanced' ? T('均衡', 'Balanced') : T('质量优先', 'Quality'),
      })),
      docs: FIELD_DOCS,
    });
  }
  return fields;
}

/* ---------------- 素材槽 ---------------- */

/** 公网 URL、mm_file://、Data URL 都可以；mm_file 由 minimax-files 上传目标产生 */
const SOURCES: AssetSourceType[] = ['local', 'url', 'task-output', 'provider-file'];

// 未核实：原文只写 "≤ 30 MB / 50 MB / 15 MB"，没说 MB 是 10^6 还是 2^20 → 取较小的 10^6（与 maxRequestBytes 64_000_000 同口径）
export const IMAGE_MAX_BYTES = 30_000_000;
export const VIDEO_MAX_BYTES = 50_000_000;
export const AUDIO_MAX_BYTES = 15_000_000;

// guide 的参考图一栏没写宽高比，API 对所有 image_url 写了 [0.4, 2.5] → 取严格者
const IMAGE_SPEC: MediaSpec = { formats: ['jpeg', 'png', 'webp', 'heic', 'heif'], maxBytes: IMAGE_MAX_BYTES, side: [256, 5760], aspect: [0.4, 2.5] };
// 视频编码 H.264 / H.265 由约束 C-MM-H3-7 提示；音轨须为 AAC / MP3，素材元数据里没有音轨编码，未校验
const VIDEO_SPEC: MediaSpec = { formats: ['mp4', 'mov'], maxBytes: VIDEO_MAX_BYTES, side: [256, 5760], aspect: [0.4, 2.5], durationSec: [2, 15], fps: [23.976, 60] };
const AUDIO_SPEC: MediaSpec = { formats: ['wav', 'mp3'], maxBytes: AUDIO_MAX_BYTES, durationSec: [2, 15] };

const IMAGE_HELP = T(
  'JPG / PNG / WEBP / HEIC / HEIF，≤30MB（按 30,000,000 字节计），宽高 256–5760px，宽高比 0.4–2.5',
  'JPG / PNG / WEBP / HEIC / HEIF, ≤30MB (counted as 30,000,000 bytes), 256–5760px per side, aspect 0.4–2.5',
);

function slot(id: string, kind: MediaKind, label: ReturnType<typeof T>, min: number, max: number, spec: MediaSpec, help: ReturnType<typeof T>): SlotDef {
  return { id, kind, label, role: id, min, max, sources: SOURCES, spec, help };
}

export const FIRST_SLOT = slot(SLOT_FIRST, 'image', T('首帧', 'First frame'), 1, 1, IMAGE_SPEC, IMAGE_HELP);
export const LAST_SLOT = slot(
  SLOT_LAST,
  'image',
  T('尾帧（可选）', 'Last frame (optional)'),
  0,
  1,
  IMAGE_SPEC,
  T(
    `文档冲突：本模式暂不支持只传尾帧，需与首帧一起提供（只传尾帧见实验模式「仅尾帧」）。${IMAGE_HELP.zh}`,
    `Docs conflict: this mode does not support a last frame alone; pair it with a first frame (see the experimental "Last frame only" mode). ${IMAGE_HELP.en}`,
  ),
);
/** 实验模式「仅尾帧」的唯一素材槽 */
export const LAST_ONLY_SLOT = slot(SLOT_LAST, 'image', T('尾帧', 'Last frame'), 1, 1, IMAGE_SPEC, IMAGE_HELP);
export const REF_IMAGE_SLOT = slot(SLOT_REF_IMAGE, 'image', T('参考图', 'Reference images'), 0, REF_LIMITS[SLOT_REF_IMAGE], IMAGE_SPEC, T(`最多 9 张。${IMAGE_HELP.zh}`, `Up to 9. ${IMAGE_HELP.en}`));
export const REF_VIDEO_SLOT = slot(
  SLOT_REF_VIDEO,
  'video',
  T('参考视频', 'Reference videos'),
  0,
  REF_LIMITS[SLOT_REF_VIDEO],
  VIDEO_SPEC,
  T(
    '最多 3 段，MP4 / MOV（H.264 / H.265），≤50MB（按 50,000,000 字节计），每段 2–15 秒、合计 ≤15 秒，帧率 23.976–60',
    'Up to 3 clips, MP4 / MOV (H.264 / H.265), ≤50MB (counted as 50,000,000 bytes), 2–15 s each and ≤15 s total, 23.976–60 fps',
  ),
);
export const REF_AUDIO_SLOT = slot(
  SLOT_REF_AUDIO,
  'audio',
  T('参考音频', 'Reference audio'),
  0,
  REF_LIMITS[SLOT_REF_AUDIO],
  AUDIO_SPEC,
  T('最多 3 段，WAV / MP3，≤15MB（按 15,000,000 字节计），每段 2–15 秒、合计 ≤15 秒', 'Up to 3 clips, WAV / MP3, ≤15MB (counted as 15,000,000 bytes), 2–15 s each and ≤15 s total'),
);

/* ---------------- 模式 ---------------- */

const kindWord = (k: MediaKind) => (k === 'image' ? 'Image' : k === 'video' ? 'Video' : 'Audio');

/** 文生 / 图生视频：未核实，文档没有给出提示词里引用素材的写法，按纯文本 "Image n" 渲染（见 C-MM-H3-10） */
export const PROMPT: PromptSpec = {
  required: true,
  maxChars: TEXT_MAX_CHARS,
  refLabel: (k, n) => `${kindWord(k)} ${n}`,
};

/**
 * 参考生视频：未核实，文档没有规定写法；按官方 r2va 请求示例的措辞（"…follows reference audio 1"）渲染成
 * "reference image n / reference video n / reference audio n"，依据是示例而非规则（见 C-MM-H3-10）
 */
export const R2V_PROMPT: PromptSpec = {
  required: true,
  maxChars: TEXT_MAX_CHARS,
  refLabel: (k, n) => `reference ${k} ${n}`,
};

export const T2V_MODE: ModeDef = {
  id: MODE_T2V,
  label: T('文生视频', 'Text to video'),
  hint: T('只用文字生成视频，需指定具体画面比例', 'Generate video from text only; a specific aspect ratio is required'),
  slots: [],
  prompt: PROMPT,
};

/** 文档冲突：content 描述与 guide 允许只传尾帧，role 描述却写 last_frame 必须与 first_frame 成对 → 本模式不支持只传尾帧 */
export const I2V_MODE: ModeDef = {
  id: MODE_I2V,
  label: T('图生视频', 'Image to video'),
  hint: T('首帧，或首帧 + 尾帧；画面比例跟随首帧', 'First frame, or first + last frame; the aspect ratio follows the first frame'),
  slots: [FIRST_SLOT, LAST_SLOT],
  prompt: PROMPT,
};

/** 文档冲突（同上）：按 plan.md 把"只传尾帧"做成实验模式、默认隐藏；ratio 与图生视频一样不发送 */
export const I2V_LAST_MODE: ModeDef = {
  id: MODE_I2V_LAST,
  label: T('仅尾帧', 'Last frame only'),
  hint: T(
    '文档冲突：content 描述与 guide 允许只传尾帧，role 描述却写尾帧必须与首帧成对；可能被拒绝',
    'Docs conflict: the content description and guide allow a last frame alone, but the role description says it must be paired with a first frame; it may be rejected',
  ),
  slots: [LAST_ONLY_SLOT],
  prompt: PROMPT,
  experimental: true,
  hiddenByDefault: true,
};

export function r2vMode(p: H3Profile): ModeDef {
  return {
    id: MODE_R2V,
    label: T('参考生视频', 'Reference to video'),
    slots: [REF_IMAGE_SLOT, REF_VIDEO_SLOT, REF_AUDIO_SLOT],
    prompt: R2V_PROMPT,
    ...(p.r2vConflict
      ? {
          // 文档冲突：v2json / overview / guide 写 H3-Max 支持参考生视频，models 页只写 T2V / I2V
          experimental: true,
          hiddenByDefault: true,
          hint: T('文档冲突：模型介绍页没有列出 H3-Max 的参考生视频，可能被拒绝', 'Docs conflict: the models page does not list reference-to-video for H3-Max; it may be rejected'),
        }
      : { hint: T('参考图、参考视频、参考音频任意组合（合计最多 12 个文件）', 'Any mix of reference images, videos and audio (up to 12 files in total)') }),
  };
}

export const h3Modes = (p: H3Profile): ModeDef[] => [T2V_MODE, I2V_MODE, I2V_LAST_MODE, r2vMode(p)];
