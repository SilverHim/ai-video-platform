/**
 * MiniMax 国际站图像生成：image-01、image-01-live（POST /v1/image_generation）。
 * 未核实：按同步返回实现属推断——200 响应直接含 data.image_urls / image_base64、无任务查询端点，但 API Overview 用了 "image generation task" 的说法。
 * 未核实：T2I 与 I2I 两份 OpenAPI 的 path、operationId 相同，「同一端点、靠 subject_reference 区分模式」属推断。
 */
import type { ModelDef } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { image01Adapter } from './adapter.js';
import {
  COMMON_CONSTRAINTS,
  DOCS,
  IMAGE01_WIRE_GUARDS,
  LIVE_PRICE_UNKNOWN,
  LIVE_SUBJECT_CONFLICT,
  LIVE_T2I_CONFLICT,
  image01Cost,
  image01Fields,
  subjectMode,
  t2iMode,
} from './spec.js';

export const IMAGE01_ID = 'minimax/image-01';
export const IMAGE01_LIVE_ID = 'minimax/image-01-live';

const image01: ModelDef = {
  id: IMAGE01_ID,
  providerId: 'minimax',
  apiModel: 'image-01',
  family: 'image01',
  label: T('image-01', 'image-01'),
  description: T(
    '文生图与人像主体参考；8 种预设比例或自定义宽高，每次 1–9 张；限流 10 次/分钟',
    'Text-to-image and portrait subject reference; 8 aspect presets or custom size, 1–9 images per request; rate limit 10 RPM',
  ),
  output: 'image',
  kind: 'sync',
  lifecycle: { status: 'active' },
  docs: [DOCS.t2i, DOCS.i2i, DOCS.guide, DOCS.overview, DOCS.pricing, DOCS.rateLimits],
  endpoints: { submit: 'image.generate' },
  modes: [t2iMode({ experimental: false }), subjectMode({ experimental: false })],
  fields: image01Fields({ customSize: true }),
  constraints: COMMON_CONSTRAINTS,
  wireGuards: IMAGE01_WIRE_GUARDS,
  adapter: image01Adapter,
  estimateCost: image01Cost,
};

/**
 * 文档冲突：I2I OpenAPI 的 model 枚举含 image-01-live，但同字段描述仍写 "Options: image-01"，API Overview、定价、限流表都没列它
 * → 两个模式都标实验：主体参考按 I2I 枚举开放并给 warn（C-MM-IMG-5）；文生图只在 MCP 工具表里允许，另默认隐藏（C-MM-IMG-1）。
 */
const image01Live: ModelDef = {
  id: IMAGE01_LIVE_ID,
  providerId: 'minimax',
  apiModel: 'image-01-live',
  family: 'image01',
  label: T('image-01-live', 'image-01-live'),
  badges: [T('实验', 'Experimental')],
  description: T(
    '人像主体参考；文档对该模型说法冲突，两个模式都列为实验。用途、价格与限流文档未说明，不支持自定义宽高',
    'Portrait subject reference; docs conflict on this model, so both modes are experimental. Purpose, pricing and rate limits are undocumented; no custom size',
  ),
  output: 'image',
  kind: 'sync',
  lifecycle: { status: 'active' },
  docs: [DOCS.i2i, DOCS.mcp, DOCS.guide],
  endpoints: { submit: 'image.generate' },
  // 默认模式放主体参考（文生图默认隐藏）
  modes: [subjectMode({ experimental: true }), t2iMode({ experimental: true })],
  // 未核实：width/height 原文 "Only effective for image-01"，对 image-01-live 是忽略还是报错未说明 → 不提供自定义宽高，请求体里出现时由 wireGuard 拦截
  fields: image01Fields({ customSize: false }),
  constraints: [LIVE_T2I_CONFLICT, LIVE_SUBJECT_CONFLICT, LIVE_PRICE_UNKNOWN, ...COMMON_CONSTRAINTS],
  wireGuards: IMAGE01_WIRE_GUARDS,
  adapter: image01Adapter,
  // 未核实：image-01-live 的价格文档未说明，不给估算
};

export const IMAGE01_MODELS: ModelDef[] = [image01, image01Live];
