/**
 * MiniMax V2 视频（MiniMax-H3 / MiniMax-H3-Max）的模型档案与文档常量。
 * 事实来源：docs/research/minimax/minimax-video.md（A 节 V2 接口、A5 素材、A10 价格）、minimax-platform-cors.md（§5 文件上传）。
 */
import { T, doc } from '../../../catalog/helpers.js';
import type { I18nText } from '../../../i18n.js';

export const DOCS = {
  create: doc('https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md'),
  query: doc('https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md', 'content.url 有时效，具体时长未说明'),
  list: doc('https://platform.minimax.io/docs/api-reference/video-generation-v2-list.md'),
  remove: doc('https://platform.minimax.io/docs/api-reference/video-generation-v2-delete.md', 'queued 取消；succeeded/failed 删除；running/cancelled 报错'),
  spec: doc('https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json'),
  guide: doc('https://platform.minimax.io/docs/guides/video-generation.md', '混合输入最多 12 个文件；建议每 10 秒轮询'),
  overview: doc('https://platform.minimax.io/docs/api-reference/api-overview.md', 'H3-Max 只支持创建接口（不含 Context-IR / 再生成）'),
  models: doc('https://platform.minimax.io/docs/guides/models-intro.md', 'H3-Max 只写 T2V/I2V；输出 24 fps'),
  pricing: doc('https://platform.minimax.io/docs/guides/pricing-paygo.md'),
  rateLimits: doc('https://platform.minimax.io/docs/guides/rate-limits.md', 'MiniMax-H3 RPM 300、inflight 30；H3-Max 未单列'),
  files: doc('https://platform.minimax.io/docs/api-reference/file/management/api/openapi.json', 'video_generation_input → mm_file://，有效 7 天'),
};

export const MODE_T2V = 't2v';
export const MODE_I2V = 'i2v';
/** 实验：只传尾帧（文档冲突） */
export const MODE_I2V_LAST = 'i2v_last';
export const MODE_R2V = 'r2v';

export const SLOT_FIRST = 'first_frame';
export const SLOT_LAST = 'last_frame';
export const SLOT_REF_IMAGE = 'reference_image';
export const SLOT_REF_VIDEO = 'reference_video';
export const SLOT_REF_AUDIO = 'reference_audio';
export const REF_SLOTS = [SLOT_REF_IMAGE, SLOT_REF_VIDEO, SLOT_REF_AUDIO] as const;

/** 每条 text 最多 7000 字符（按字符计） */
export const TEXT_MAX_CHARS = 7000;
/** 参考素材上限：图 9、视频 3、音频 3 */
export const REF_LIMITS = { [SLOT_REF_IMAGE]: 9, [SLOT_REF_VIDEO]: 3, [SLOT_REF_AUDIO]: 3 } as const;
/** 混合输入总文件数（只在 guide 中出现） */
export const REF_TOTAL_MAX = 12;
/** 参考视频 / 参考音频各自的总时长上限（秒） */
export const REF_TOTAL_SEC = 15;
/** mm_file:// 有效期 7 天 */
export const MM_FILE_TTL_MS = 7 * 24 * 3600_000;

export const RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const SPECIFIC_RATIOS: readonly string[] = RATIOS.filter((r) => r !== 'adaptive');
export const EXPANSION_MODES = ['disabled', 'balanced', 'quality'] as const;

export type H3Key = 'h3' | 'max';

export interface H3Price {
  /** 输出 USD/秒（按分辨率） */
  output: Record<string, number>;
  /** 免费输入图片张数 */
  freeImages: number;
  /** 超出部分每张 */
  extraImage: number;
  /** 参考视频 USD/秒（按输出分辨率） */
  refVideo: Record<string, number>;
}

export interface H3Profile {
  key: H3Key;
  id: string;
  apiModel: string;
  label: I18nText;
  description: I18nText;
  resolutions: string[];
  defaultResolution: string;
  duration: [number, number];
  defaultDuration: number;
  /** 是否带 extra.prompt_expansion_mode */
  promptExpansion: boolean;
  /** 参考生视频是否文档冲突 */
  r2vConflict: boolean;
  price: H3Price;
}

export const H3_ID = 'minimax/h3';
export const H3_MAX_ID = 'minimax/h3-max';

export const PROFILES: Record<H3Key, H3Profile> = {
  h3: {
    key: 'h3',
    id: H3_ID,
    apiModel: 'MiniMax-H3',
    label: T('MiniMax-H3', 'MiniMax-H3'),
    description: T('V2 视频：文生、首帧 / 首尾帧、图视频音频全模态参考；768P / 2K，4–15 秒', 'V2 video: text, first / first+last frame, and image-video-audio references; 768P / 2K, 4–15 s'),
    resolutions: ['768P', '2K'],
    // 未核实：H3 的 resolution 默认值文档未说明（且为必填），取较低档 768P
    defaultResolution: '768P',
    duration: [4, 15],
    // 未核实：duration 必填且无默认值，取最小值 4
    defaultDuration: 4,
    promptExpansion: false,
    r2vConflict: false,
    // 按量付费标价（pricing-paygo）
    price: { output: { '768P': 0.08, '2K': 0.13 }, freeImages: 5, extraImage: 0.04, refVideo: { '768P': 0.08, '2K': 0.13 } },
  },
  max: {
    key: 'max',
    id: H3_MAX_ID,
    apiModel: 'MiniMax-H3-Max',
    label: T('MiniMax-H3-Max', 'MiniMax-H3-Max'),
    description: T(
      'H3 的快速生成版本（fal.ai 在 H3 基础上后训练）；480P / 768P，5–15 秒，可调提示词扩写；参考生视频文档冲突，列为实验',
      'Fast-generation variant of H3 (post-trained by fal.ai); 480P / 768P, 5–15 s, adjustable prompt expansion; reference-to-video is experimental due to conflicting docs',
    ),
    resolutions: ['480P', '768P'],
    // 文档冲突：描述写 "defaults to 768P"，schema 却把 resolution 列为必填 → 一律显式发送 768P
    defaultResolution: '768P',
    duration: [5, 15],
    // 未核实：duration 必填且无默认值，取最小值 5（不支持 4）
    defaultDuration: 5,
    promptExpansion: true,
    r2vConflict: true,
    price: { output: { '480P': 0.05, '768P': 0.08 }, freeImages: 2, extraImage: 0.074, refVideo: { '480P': 0.0553, '768P': 0.143 } },
  },
};

export const profileOf = (modelId: string): H3Profile | undefined => Object.values(PROFILES).find((p) => p.id === modelId);
