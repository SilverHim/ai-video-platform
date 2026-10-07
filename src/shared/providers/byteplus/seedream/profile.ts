import type { DocRef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T, doc } from '../../../catalog/helpers.js';
import { SIZE_LITE, SIZE_PRO_FLASH, SIZE_V40, SIZE_V45, type SizeRule } from './sizes.js';

const BASE = 'https://ai.byteplus.com/ark/region:ap-southeast-1/docs';

/** 调研报告引用的官方文档 */
export const DOC_URLS = {
  api: `${BASE}/image-generation-api`,
  stream: `${BASE}/image-generation-streaming-responses`,
  tutorial: `${BASE}/seedream-4-0-5-0`,
  pro: `${BASE}/seedream-5-0-pro`,
  editing: `${BASE}/seedream-5-0-pro-editing-guide`,
  models: `${BASE}/model-list#9df4d9fd`,
  pricing: `${BASE}/model-pricing#c02be6ee`,
  errors: `${BASE}/error-codes`,
} as const;

export type SeedreamKey = 'pro' | 'flash' | 'lite' | 'v45' | 'v40';
export type SeedreamModeId = 'generate' | 'group' | 'layer' | 'transparent';

/** 一个 Seedream 模型的能力画像；字段、模式、约束、计价都从这里派生 */
export interface SeedreamProfile {
  key: SeedreamKey;
  id: string;
  apiModel: string;
  aliases?: string[];
  label: I18nText;
  description: I18nText;
  size: SizeRule;
  /** 参考图上限 */
  maxRefs: number;
  outputFormat: boolean;
  /** optimize_prompt_options.mode=fast */
  fast: boolean;
  /** 组图 sequential_image_generation */
  group: boolean;
  stream: boolean;
  /** 图层分解与透明背景（两者支持范围相同：pro / flash） */
  layer: boolean;
  transparent: boolean;
  /** 提示词支持 <point>/<bbox> 交互式编辑 */
  interactiveEdit: boolean;
  /** 模型目录元数据（arkcli models get 的 supported_params）列出、API 文档与 OpenAPI 合约没有的参数：negative_prompt / seed / optimize_prompt */
  catalogParams: boolean;
  docs: DocRef[];
}

const COMMON_DOCS = [doc(DOC_URLS.api), doc(DOC_URLS.tutorial), doc(DOC_URLS.models), doc(DOC_URLS.pricing)];
const PRO_DOCS = [...COMMON_DOCS, doc(DOC_URLS.pro), doc(DOC_URLS.editing)];

export const PROFILES: SeedreamProfile[] = [
  {
    key: 'pro',
    id: 'byteplus/seedream-5-0-pro',
    apiModel: 'dola-seedream-5-0-pro-260628',
    label: T('Seedream 5.0 pro', 'Seedream 5.0 pro'),
    description: T('支持交互式编辑、图层分解、透明背景与 fast 提示词优化；不支持组图与流式', 'Interactive editing, layer decomposition, transparent background and fast prompt optimization; no group generation or streaming'),
    size: SIZE_PRO_FLASH,
    maxRefs: 10,
    outputFormat: true,
    fast: true,
    group: false,
    stream: false,
    layer: true,
    transparent: true,
    catalogParams: true,
    interactiveEdit: true,
    docs: PRO_DOCS,
  },
  {
    key: 'flash',
    id: 'byteplus/seedream-5-0-flash',
    apiModel: 'dola-seedream-5-0-flash-260915',
    label: T('Seedream 5.0 flash', 'Seedream 5.0 flash'),
    description: T('官方推荐的低延迟选择；支持交互式编辑、图层分解、透明背景；不支持组图与流式', 'Officially suggested for latency-sensitive use; interactive editing, layer decomposition, transparent background; no group generation or streaming'),
    size: SIZE_PRO_FLASH,
    maxRefs: 10,
    outputFormat: true,
    fast: false,
    group: false,
    stream: false,
    layer: true,
    transparent: true,
    catalogParams: true,
    interactiveEdit: true,
    docs: PRO_DOCS,
  },
  {
    key: 'lite',
    id: 'byteplus/seedream-5-0-lite',
    apiModel: 'seedream-5-0-260128',
    aliases: ['seedream-5-0-lite-260128'],
    label: T('Seedream 5.0 lite', 'Seedream 5.0 lite'),
    description: T('支持组图与流式输出；2K / 3K / 4K', 'Group generation and streaming; 2K / 3K / 4K'),
    size: SIZE_LITE,
    maxRefs: 14,
    outputFormat: true,
    fast: false,
    group: true,
    stream: true,
    layer: false,
    transparent: false,
    catalogParams: false,
    interactiveEdit: false,
    docs: [...COMMON_DOCS, doc(DOC_URLS.stream)],
  },
  {
    key: 'v45',
    id: 'byteplus/seedream-4-5',
    apiModel: 'seedream-4-5-251128',
    label: T('Seedream 4.5', 'Seedream 4.5'),
    description: T('支持组图与流式输出；2K / 4K；输出固定 JPEG', 'Group generation and streaming; 2K / 4K; JPEG output only'),
    size: SIZE_V45,
    maxRefs: 14,
    outputFormat: false,
    fast: false,
    group: true,
    stream: true,
    layer: false,
    transparent: false,
    catalogParams: false,
    interactiveEdit: false,
    docs: [...COMMON_DOCS, doc(DOC_URLS.stream)],
  },
  {
    key: 'v40',
    id: 'byteplus/seedream-4-0',
    apiModel: 'seedream-4-0-250828',
    label: T('Seedream 4.0', 'Seedream 4.0'),
    description: T('支持组图、流式输出与 fast 提示词优化；1K / 2K / 4K；输出固定 JPEG', 'Group generation, streaming and fast prompt optimization; 1K / 2K / 4K; JPEG output only'),
    size: SIZE_V40,
    maxRefs: 14,
    // 文档冲突：教程写 4.x 输出固定 jpeg、不支持自定义，但同页 fast 示例给 4.0 传了 output_format=png；保守不暴露
    outputFormat: false,
    fast: true,
    group: true,
    stream: true,
    layer: false,
    transparent: false,
    catalogParams: false,
    interactiveEdit: false,
    docs: [...COMMON_DOCS, doc(DOC_URLS.stream)],
  },
];

export function modeIdsOf(p: SeedreamProfile): SeedreamModeId[] {
  return ['generate', ...(p.group ? (['group'] as const) : []), ...(p.layer ? (['layer'] as const) : []), ...(p.transparent ? (['transparent'] as const) : [])];
}

/** 组图：参考图数 + 生成图数 ≤ 15 */
export const GROUP_TOTAL_LIMIT = 15;
