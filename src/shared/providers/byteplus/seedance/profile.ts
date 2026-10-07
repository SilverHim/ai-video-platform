/**
 * Seedance 模型能力画像：字段、模式、约束、wireGuard 都从这里派生。
 * 事实来源：docs/research/byteplus/video-api.md、video-models.md、platform-cors.md。
 */
import type { DocRef, Lifecycle, MediaKind } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T, doc } from '../../../catalog/helpers.js';

const BASE = 'https://ai.byteplus.com/ark/region:ap-southeast-1/docs';

export const DOC_URLS = {
  create: `${BASE}/create-video-generation-task-api`,
  get: `${BASE}/get-video-generation-task-api`,
  list: `${BASE}/list-video-generation-tasks-api`,
  cancel: `${BASE}/cancel-or-delete-video-generation-tasks-api`,
  tutorial: `${BASE}/video-generation-tutorial`,
  s25: `${BASE}/seedance-2-5`,
  s20: `${BASE}/seedance-2-0`,
  models: `${BASE}/model-list#7571da3f`,
  deprecation: `${BASE}/model-deprecation-notice`,
  portrait: `${BASE}/seedance-portrait-asset-guide`,
  errors: `${BASE}/error-codes`,
} as const;

export const MODE = {
  t2v: 't2v',
  first: 'i2v_first',
  firstLast: 'i2v_first_last',
  omni: 'omni',
  edit: 'edit',
  extend: 'extend',
  final: 'draft_final',
} as const;

export const SLOT = {
  first: 'first_frame',
  last: 'last_frame',
  image: 'reference_image',
  video: 'reference_video',
  audio: 'reference_audio',
} as const;

/** 视频 / 尾帧 URL 有效 24 小时（未核实起算点，按 created_at 保守估计） */
export const URL_TTL_MS = 24 * 60 * 60 * 1000;
/** 样片任务 ID 从 created_at 起 7 天内可转正片 */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 提示词建议长度 */
export const PROMPT_SOFT_MAX = { zhChars: 500, enWords: 1000 };
export const EXPIRES_RANGE: [number, number] = [3600, 259_200];
export const EXPIRES_DEFAULT = 172_800;
// 文档冲突：1.5 pro 目录元数据写 seed 上限 4294967295，取 OpenAPI / API 正文的 2147483647
export const SEED_MAX = 2_147_483_647;

/** 全模态参考的数量与时长上限 */
export interface OmniLimits {
  image: number;
  video: number;
  audio: number;
  totalVideoSec: number;
  totalAudioSec: number;
  /** 非编辑任务单段视频 / 音频时长 */
  clipSec: [number, number];
  /** 是否允许只传音频（2.0 系列必须带图或视频） */
  audioOnly: boolean;
}

export type SeedanceKey = 'v25' | 'v20' | 'v20fast' | 'v20mini' | 'v15pro' | 'v10pro' | 'v10fast';

export interface SeedanceProfile {
  key: SeedanceKey;
  id: string;
  apiModel: string;
  label: I18nText;
  description: I18nText;
  lifecycle: Lifecycle;
  /** 是否属于 2.x（2.5 / 2.0 系列） */
  v2: boolean;
  resolutions: string[];
  defaultResolution: string;
  duration: { range: [number, number]; auto: boolean; default: number };
  /** frames 字段（只 1.0） */
  frames: boolean;
  generateAudio: boolean;
  outputFormat: boolean;
  /** seed / camera_fixed（只列了 1.x） */
  seedCamera: boolean;
  draft: boolean;
  flex: boolean;
  priority: boolean;
  firstLast: boolean;
  omni: OmniLimits | null;
  /** 编辑 / 延长独立模式（只 2.5） */
  editExtend: boolean;
  /** 首帧 / 首尾帧 / 编辑 / 延长只能 ratio=adaptive（违反为异步失败） */
  adaptiveOnly: boolean;
  /** 文生视频不支持 adaptive（1.0） */
  t2vNoAdaptive: boolean;
  /** 图片支持 heic / heif */
  heic: boolean;
  /** heic / heif 的支持范围有文档冲突（提交时 warn） */
  heicConflict: boolean;
  /** S20 能力表与 API 冲突：ratio 不含 adaptive、duration 只写 4–15 */
  s20Conflict: boolean;
  /** 提示词语言清单里有中文（只有 S25 写了 2.5 支持中文） */
  zhPrompt: boolean;
  /** 提示词素材引用写法 */
  refLabel: (kind: MediaKind, n: number) => string;
  docs: DocRef[];
}

const KIND_NAME: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' };
/** 2.5 提示词指南：@Image 1 / @Video 1 / @Audio 1 */
const atLabel = (k: MediaKind, n: number): string => `@${KIND_NAME[k]} ${n}`;
/** 2.0：素材类型 + 序号，如 Image 1；1.x 文档没有素材引用规则（未核实），沿用同一写法 */
const plainLabel = (k: MediaKind, n: number): string => `${KIND_NAME[k]} ${n}`;

const COMMON_DOCS = [doc(DOC_URLS.create), doc(DOC_URLS.get), doc(DOC_URLS.tutorial), doc(DOC_URLS.models)];
const V20_DOCS = [...COMMON_DOCS, doc(DOC_URLS.s20), doc(DOC_URLS.portrait)];

const OMNI_V20: OmniLimits = { image: 9, video: 3, audio: 3, totalVideoSec: 15, totalAudioSec: 15, clipSec: [2, 15], audioOnly: false };

// 文档冲突：S20 能力表的 ratio 不含 adaptive、duration 只写 4–15；API / S25 能力总览 / TUT 都写 2.0 支持 adaptive（默认）与 -1。
// 取保守做法：adaptive 是 API 写明的默认值，选它时不发送 ratio；-1 不是默认值，必须显式发送，给 warn（C-SE-20-auto）
const v20Base = {
  v2: true,
  lifecycle: { status: 'active' },
  defaultResolution: '720p',
  duration: { range: [4, 15], auto: true, default: 5 },
  frames: false,
  generateAudio: true,
  outputFormat: false,
  seedCamera: false,
  draft: false,
  flex: false,
  priority: true,
  firstLast: true,
  omni: OMNI_V20,
  editExtend: false,
  adaptiveOnly: false,
  t2vNoAdaptive: false,
  heic: true,
  heicConflict: false,
  s20Conflict: true,
  zhPrompt: false,
  refLabel: plainLabel,
  docs: V20_DOCS,
} satisfies Partial<SeedanceProfile>;

const v10Base = {
  v2: false,
  lifecycle: { status: 'active' },
  resolutions: ['480p', '720p', '1080p'],
  defaultResolution: '1080p',
  // 未核实：1.0 文档没有列出 duration=-1，不提供"自动"
  duration: { range: [2, 12], auto: false, default: 5 },
  frames: true,
  generateAudio: false,
  outputFormat: false,
  seedCamera: true,
  draft: false,
  flex: true,
  priority: false,
  omni: null,
  editExtend: false,
  adaptiveOnly: false,
  t2vNoAdaptive: true,
  // heic / heif 只写了 1.5 pro 及之后的模型
  heic: false,
  heicConflict: false,
  s20Conflict: false,
  zhPrompt: false,
  refLabel: plainLabel,
  docs: COMMON_DOCS,
} satisfies Partial<SeedanceProfile>;

export const PROFILES: SeedanceProfile[] = [
  {
    key: 'v25',
    id: 'byteplus/seedance-2-5',
    apiModel: 'dreamina-seedance-2-5-260628',
    label: T('Seedance 2.5', 'Seedance 2.5'),
    description: T(
      '文生、首帧、首尾帧、全模态参考（图 30 / 视频 10 / 音频 10）、视频编辑与延长、样片；4–30 秒，可生成音频',
      'Text, first frame, first + last frame, omni reference (30 images / 10 videos / 10 audios), video edit & extend, drafts; 4–30 s with audio',
    ),
    lifecycle: { status: 'active' },
    v2: true,
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    duration: { range: [4, 30], auto: true, default: -1 },
    frames: false,
    generateAudio: true,
    outputFormat: true,
    seedCamera: false,
    draft: true,
    flex: false,
    priority: true,
    firstLast: true,
    omni: { image: 30, video: 10, audio: 10, totalVideoSec: 30, totalAudioSec: 30, clipSec: [2, 30], audioOnly: true },
    editExtend: true,
    adaptiveOnly: true,
    t2vNoAdaptive: false,
    // 文档冲突：教程写 heic / heif 适用 1.5 Pro 与 2.0 系列；API（1.5 pro 及之后）与 S25 都列了 2.5。放行但提交时 warn（C-SE-8-heic）
    heic: true,
    heicConflict: true,
    s20Conflict: false,
    // S25 多语言节写 2.5 原生支持中文；API 的语言清单没有中文
    zhPrompt: true,
    refLabel: atLabel,
    docs: [...COMMON_DOCS, doc(DOC_URLS.s25), doc(DOC_URLS.portrait)],
  },
  {
    ...v20Base,
    key: 'v20',
    id: 'byteplus/seedance-2-0',
    apiModel: 'dreamina-seedance-2-0-260128',
    label: T('Seedance 2.0', 'Seedance 2.0'),
    description: T(
      '文生、首帧、首尾帧、全模态参考（图 9 / 视频 3 / 音频 3，可用提示词编辑 / 延长视频）；4–15 秒，最高 4K，可生成音频',
      'Text, first frame, first + last frame, omni reference (9 images / 3 videos / 3 audios; edit / extend videos via the prompt); 4–15 s, up to 4K, with audio',
    ),
    resolutions: ['480p', '720p', '1080p', '4k'],
  },
  {
    ...v20Base,
    key: 'v20fast',
    id: 'byteplus/seedance-2-0-fast',
    apiModel: 'dreamina-seedance-2-0-fast-260128',
    label: T('Seedance 2.0 fast', 'Seedance 2.0 fast'),
    description: T('能力同 2.0（含用提示词编辑 / 延长视频），最高 720p', 'Same modes as 2.0 (including edit / extend via the prompt), up to 720p'),
    resolutions: ['480p', '720p'],
  },
  {
    ...v20Base,
    key: 'v20mini',
    id: 'byteplus/seedance-2-0-mini',
    apiModel: 'dreamina-seedance-2-0-mini-260615',
    label: T('Seedance 2.0 mini', 'Seedance 2.0 mini'),
    description: T('能力同 2.0（含用提示词编辑 / 延长视频），最高 720p；官方推荐的 1.5 pro 替代模型', 'Same modes as 2.0 (including edit / extend via the prompt), up to 720p; the official replacement for 1.5 pro'),
    resolutions: ['480p', '720p'],
  },
  {
    key: 'v15pro',
    id: 'byteplus/seedance-1-5-pro',
    apiModel: 'seedance-1-5-pro-251215',
    label: T('Seedance 1.5 pro', 'Seedance 1.5 pro'),
    description: T('文生、首帧、首尾帧、样片；4–12 秒，可生成音频', 'Text, first frame, first + last frame, drafts; 4–12 s with audio'),
    // 文档冲突：模型列表标 Retired，arkcli 目录标 Retiring；按 Retired 处理
    lifecycle: {
      status: 'retired',
      hiddenByDefault: true,
      note: T(
        'Seedance 1.5 pro 已 Retired：2026-09-15 起不能新建推理接入点，2026-11-11 17:00（UTC+8）停止服务且不会自动迁移；官方推荐改用 Seedance 2.0 mini',
        'Seedance 1.5 pro is retired: no new endpoints since 2026-09-15; service stops on 2026-11-11 17:00 (UTC+8) with no automatic migration; the official replacement is Seedance 2.0 mini',
      ),
    },
    v2: false,
    resolutions: ['480p', '720p', '1080p'],
    defaultResolution: '720p',
    duration: { range: [4, 12], auto: true, default: 5 },
    frames: false,
    generateAudio: true,
    outputFormat: false,
    seedCamera: true,
    draft: true,
    flex: true,
    priority: false,
    firstLast: true,
    omni: null,
    editExtend: false,
    adaptiveOnly: false,
    t2vNoAdaptive: false,
    heic: true,
    heicConflict: false,
    s20Conflict: false,
    zhPrompt: false,
    refLabel: plainLabel,
    docs: [...COMMON_DOCS, doc(DOC_URLS.deprecation, '第四批：2026-11-11 停止服务')],
  },
  {
    ...v10Base,
    key: 'v10pro',
    id: 'byteplus/seedance-1-0-pro',
    apiModel: 'seedance-1-0-pro-250528',
    label: T('Seedance 1.0 pro', 'Seedance 1.0 pro'),
    description: T('文生、首帧、首尾帧；2–12 秒或按帧数，无音频', 'Text, first frame, first + last frame; 2–12 s or by frame count, no audio'),
    firstLast: true,
  },
  {
    ...v10Base,
    key: 'v10fast',
    id: 'byteplus/seedance-1-0-pro-fast',
    apiModel: 'seedance-1-0-pro-fast-251015',
    label: T('Seedance 1.0 pro fast', 'Seedance 1.0 pro fast'),
    description: T('文生、首帧；2–12 秒或按帧数，无音频', 'Text and first frame; 2–12 s or by frame count, no audio'),
    firstLast: false,
  },
];

/** 模型开放的模式（Tab 顺序） */
export function modeIdsOf(p: SeedanceProfile): string[] {
  return [
    MODE.t2v,
    MODE.first,
    ...(p.firstLast ? [MODE.firstLast] : []),
    ...(p.omni ? [MODE.omni] : []),
    ...(p.editExtend ? [MODE.edit, MODE.extend] : []),
    ...(p.draft ? [MODE.final] : []),
  ];
}

/** 用户可直接进入的模式（不含派生的正片模式） */
export const userModesOf = (p: SeedanceProfile): string[] => modeIdsOf(p).filter((m) => m !== MODE.final);

/**
 * 可以开样片的模式。
 * 未核实：文档没写样片支持哪些输入（2.5 示例是首帧 + 文本），编辑 / 延长不开放；2.5 全模态参考开放但给 warn
 */
export const draftModesOf = (p: SeedanceProfile): string[] => (p.draft ? userModesOf(p).filter((m) => m !== MODE.edit && m !== MODE.extend) : []);

/** 正片只能沿用样片的这些参数，不能再传（2.5 写明即使值相同也报错；1.5 pro 未核实，同样不传） */
export const FINAL_BANNED_KEYS = ['duration', 'ratio', 'seed', 'generate_audio', 'omni_reference_task_type', 'camera_fixed', 'frames'] as const;
