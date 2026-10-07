/**
 * MiniMax image-01 / image-01-live 的字段、模式、约束、wireGuard 与计价。
 * 事实来源：docs/research/minimax/minimax-image.md（国际站 T2I / I2I OpenAPI 与图像指南）。
 */
import type { AssetSource, Constraint, CostEstimate, EvalCtx, FieldDef, ModeDef, PromptSpec, SizeSpec, SizeValue, SlotDef, WireGuard } from '../../../catalog/types.js';
import { T, doc } from '../../../catalog/helpers.js';
import { base64Size, formatOf } from '../../../engine/media.js';
import { promptRefIds } from '../../../engine/refs.js';
import { utf8Bytes } from '../../../request/wire.js';

export const DOCS = {
  t2i: doc('https://platform.minimax.io/docs/api-reference/image-generation-t2i.md'),
  i2i: doc('https://platform.minimax.io/docs/api-reference/image-generation-i2i.md'),
  guide: doc('https://platform.minimax.io/docs/guides/image-generation.md'),
  overview: doc('https://platform.minimax.io/docs/api-reference/api-overview.md'),
  mcp: doc('https://platform.minimax.io/docs/guides/mcp-guide.md', 'text_to_image 工具允许 image-01-live'),
  pricing: doc('https://platform.minimax.io/docs/guides/pricing-paygo.md', 'image-01 $0.0035/张'),
  rateLimits: doc('https://platform.minimax.io/docs/guides/rate-limits.md', 'image-01 10 RPM'),
  releaseApis: doc('https://platform.minimax.io/docs/release-notes/apis.md', '2025-04-25 为 image-01 新增 width/height'),
};

export const MODE_T2I = 't2i';
export const MODE_SUBJECT = 'subject';
export const SLOT_SUBJECT = 'subject';

/** 原文 "max length 1500 characters" */
export const PROMPT_MAX_CHARS = 1500;
/** 原文 "less than 10MB"；未核实：MB 按 10^6 还是 2^20 计文档未说明，取较小的 10^6 */
export const SUBJECT_LIMIT_BYTES = 10_000_000;
/** seed 的常见范围（自拟，非文档）：超出只给 warn */
export const SEED_COMMON_MAX = 2147483647;
/** 与 src/server/assets/resolver.ts 的 REMOTE_URL_MIN_REMAINING_MS 一致：历史结果原始链接剩余超过 3 小时才直接用 */
const REMOTE_URL_MIN_REMAINING_MS = 3 * 60 * 60 * 1000;
/** 按量付费标价（只覆盖 image-01） */
export const IMAGE01_USD_PER_IMAGE = 0.0035;

/* ---------------- 尺寸 ---------------- */

/** 8 种 aspect_ratio，像素为文档括号内给出的对应值 */
const ASPECT_PRESETS: SizeSpec['presets'] = [
  { value: '1:1', px: [1024, 1024] },
  { value: '16:9', px: [1280, 720] },
  { value: '4:3', px: [1152, 864] },
  { value: '3:2', px: [1248, 832] },
  { value: '2:3', px: [832, 1248] },
  { value: '3:4', px: [864, 1152] },
  { value: '9:16', px: [720, 1280] },
  { value: '21:9', px: [1344, 576] },
];

/** 预设 → {aspect_ratio}；自定义 → {width,height}，不发 aspect_ratio（两者并存时官方以 aspect_ratio 为准） */
export function sizeToWire(v: SizeValue): Record<string, unknown> {
  return v.mode === 'preset' ? { aspect_ratio: v.value } : { width: v.width, height: v.height };
}

function sizeSpec(customSize: boolean): SizeSpec {
  return {
    presets: ASPECT_PRESETS,
    // 原文：width/height "Only effective for image-01"，成对设置，[512, 2048] 且能被 8 整除
    ...(customSize ? { custom: { side: [512, 2048] as [number, number], multipleOf: 8 } } : {}),
    toWire: sizeToWire,
  };
}

/* ---------------- 字段 ---------------- */

const FIELD_DOCS = [DOCS.t2i, DOCS.i2i];

export function image01Fields(opts: { customSize: boolean }): FieldDef[] {
  const spec = sizeSpec(opts.customSize);
  return [
    {
      key: 'size',
      type: 'size',
      label: T('尺寸', 'Size'),
      help: opts.customSize
        ? T('8 种预设比例；也可自定义宽高（512–2048 且为 8 的倍数），自定义时不发送 aspect_ratio', '8 aspect-ratio presets, or custom width/height (512–2048, multiples of 8); custom size omits aspect_ratio')
        : T('8 种预设比例；文档写明自定义宽高只对 image-01 生效', '8 aspect-ratio presets; docs say custom width/height only applies to image-01'),
      group: 'basic',
      wire: null,
      default: { mode: 'preset', value: '1:1' },
      spec: () => spec,
      fragment: (v) => sizeToWire(v),
      docs: opts.customSize ? [...FIELD_DOCS, DOCS.releaseApis] : FIELD_DOCS,
    },
    { key: 'n', type: 'int', label: T('张数', 'Images'), group: 'basic', wire: 'n', default: 1, min: 1, max: 9, docs: FIELD_DOCS },
    {
      key: 'response_format',
      type: 'enum',
      label: T('返回格式', 'Response format'),
      help: T('url 链接 24 小时后过期，本机服务会在生成后立即下载', 'URLs expire in 24 hours; the local service downloads results right away'),
      group: 'output',
      wire: 'response_format',
      default: 'url',
      control: 'segmented',
      options: [
        { value: 'url', label: T('链接', 'URL') },
        { value: 'base64', label: T('Base64', 'Base64') },
      ],
      docs: FIELD_DOCS,
    },
    {
      key: 'prompt_optimizer',
      type: 'bool',
      label: T('提示词自动优化', 'Prompt optimizer'),
      help: T('由 MiniMax 自动优化提示词', 'Let MiniMax optimize the prompt automatically'),
      group: 'advanced',
      wire: 'prompt_optimizer',
      default: false,
      docs: FIELD_DOCS,
    },
    {
      key: 'seed',
      type: 'seed',
      label: T('随机种子', 'Seed'),
      help: T('留空则每张图随机；相同 seed 与参数可复现结果', 'Leave empty for a random seed per image; the same seed and parameters reproduce results'),
      group: 'advanced',
      wire: 'seed',
      default: null,
      // 未核实：文档只标 integer / int64，未给取值范围与是否允许负数；硬范围取 int64 与 JS 安全整数的交集，[0, 2^31-1] 之外由 C-MM-IMG-7 提示
      min: Number.MIN_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
      docs: FIELD_DOCS,
    },
  ];
}

/* ---------------- 模式 ---------------- */

// 未核实：多字节字符如何计数文档未说明，引擎按 Unicode 码点计（另见 C-MM-IMG-3）
const PROMPT: PromptSpec = { required: true, maxChars: PROMPT_MAX_CHARS };

const SUBJECT_SLOT: SlotDef = {
  id: SLOT_SUBJECT,
  kind: 'image',
  label: T('人像主体', 'Subject (portrait)'),
  min: 1,
  max: 1,
  sources: ['local', 'url', 'task-output'],
  // 原文 "less than 10MB"：上限取 10^7 - 1 字节（见 SUBJECT_LIMIT_BYTES）
  // 未核实：PNG 的 Data URL MIME 写法文档未给出（示例只有 data:image/jpeg;base64,...），见 C-MM-IMG-6
  spec: { formats: ['jpeg', 'png'], maxBytes: SUBJECT_LIMIT_BYTES - 1 },
  help: T(
    '每次只支持 1 张人像（主体类型固定为 character），建议正面照；JPG/PNG，小于 10MB（按 10,000,000 字节计）',
    'Exactly one portrait per request (subject type is always character); a front-facing photo works best; JPG/PNG under 10MB (counted as 10,000,000 bytes)',
  ),
};

export function t2iMode(opts: { experimental: boolean }): ModeDef {
  return {
    id: MODE_T2I,
    label: T('文生图', 'Text to image'),
    slots: [],
    prompt: PROMPT,
    ...(opts.experimental
      ? {
          // 文档冲突：T2I OpenAPI 的 model 枚举只有 image-01，MCP Guide 的 text_to_image 工具却允许 image-01-live
          experimental: true,
          hiddenByDefault: true,
          hint: T('文档冲突：文生图接口的模型枚举不含 image-01-live，可能被拒绝', 'Docs conflict: the text-to-image model enum does not list image-01-live; it may be rejected'),
        }
      : { hint: T('只用文字描述生成图像', 'Generate images from a text description') }),
  };
}

export function subjectMode(opts: { experimental: boolean }): ModeDef {
  return {
    id: MODE_SUBJECT,
    label: T('主体参考', 'Subject reference'),
    slots: [SUBJECT_SLOT],
    prompt: PROMPT,
    ...(opts.experimental
      ? {
          // 文档冲突：I2I OpenAPI 的 model 枚举含 image-01-live，同字段描述却写 "Options: image-01"；API Overview、定价、限流表都没列它
          // 不默认隐藏：image-01-live 只剩这一个按 I2I 枚举开放的模式
          experimental: true,
          hint: T(
            '上传 1 张人像生成新图。文档冲突：接口说明只列 image-01，image-01-live 可能被拒绝',
            'Upload one portrait to generate new images. Docs conflict: the API description only lists image-01, so image-01-live may be rejected',
          ),
        }
      : { hint: T('上传 1 张人像，生成保留其主体特征的新图', 'Upload one portrait; new images keep the subject’s key features') }),
  };
}

/* ---------------- 约束 ---------------- */

/** 与内核素材解析器一致：本地素材、没有原始链接或链接剩余不足 3 小时的历史输出，会被编码成 Data URL 发送 */
function willInline(s: AssetSource, now: number): boolean {
  if (s.type === 'local') return true;
  if (s.type === 'task-output') return !(s.remoteUrl && (s.remoteExpiresAt ?? 0) - now > REMOTE_URL_MIN_REMAINING_MS);
  return false;
}

/** 会内联发送的主体参考图：原始字节数（可能未知）与解析器编码时用的格式 */
function inlineSubjects(c: EvalCtx): { bytes: number | undefined; format: string }[] {
  const now = Date.now();
  return (c.slots[SLOT_SUBJECT] ?? []).flatMap((a) => {
    const s = a.source;
    if (!willInline(s, now)) return [];
    const mime = a.meta?.mime ?? (s.type === 'local' || s.type === 'task-output' ? s.mime : undefined);
    const bytes = a.meta?.bytes ?? (s.type === 'local' ? s.bytes : undefined);
    // 解析器在格式未知时按 png 编码
    return [{ bytes, format: formatOf(mime) ?? 'png' }];
  });
}

const promptForCount = (c: EvalCtx) => (c.input.prompt ?? '').replace(/\{\{ref:[^}]+\}\}/g, ' Image 1 ');

export const COMMON_CONSTRAINTS: Constraint[] = [
  {
    id: 'C-MM-IMG-2',
    severity: 'warn',
    docs: [DOCS.i2i],
    check: (c) => {
      if (c.mode.id !== MODE_SUBJECT) return null;
      // 未核实：10MB 针对原始文件还是 Base64 字符串，文档未说明；阈值同样按 10^7 字节
      const over = inlineSubjects(c).some((x) => x.bytes !== undefined && base64Size(x.bytes) >= SUBJECT_LIMIT_BYTES);
      return over
        ? {
            slots: [SLOT_SUBJECT],
            message: T(
              '参考图会以 Base64 Data URL 发送，编码后达到 10MB（按 10,000,000 字节计）；文档未说明 10MB 是否按 Base64 计，可能被拒。可改用公网 URL 或压缩图片',
              'The reference image is sent as a Base64 data URL that reaches 10MB (10,000,000 bytes) once encoded; docs do not say whether the 10MB limit applies to Base64. Use a public URL or compress the image',
            ),
          }
        : null;
    },
  },
  {
    id: 'C-MM-IMG-3',
    severity: 'warn',
    docs: [DOCS.t2i],
    check: (c) => {
      const text = promptForCount(c);
      const chars = [...text].length;
      // 超过 1500 字符时引擎已报错，这里只提示"按字符不超、按字节会超"
      return chars <= PROMPT_MAX_CHARS && utf8Bytes(text) > PROMPT_MAX_CHARS
        ? {
            fields: ['prompt'],
            message: T(
              `提示词 ${chars} 个字符未超过 1500，但含多字节字符；文档未说明计数方式，若按字节计会超限`,
              `Prompt has ${chars} characters (within 1500) but contains multi-byte characters; docs do not say how they are counted and it would exceed the limit if counted in bytes`,
            ),
          }
        : null;
    },
  },
  {
    id: 'C-MM-IMG-4',
    severity: 'warn',
    docs: [DOCS.i2i, DOCS.guide],
    check: (c) =>
      c.mode.id === MODE_SUBJECT && promptRefIds(c.input.prompt ?? '').length > 0
        ? {
            fields: ['prompt'],
            message: T(
              '文档没有定义在提示词里引用参考图的写法，引用会按纯文本「Image 1」发送；直接描述人物即可',
              'Docs define no syntax for referencing the image in the prompt; the reference is sent as plain text "Image 1". Describe the person directly instead',
            ),
          }
        : null,
  },
  {
    id: 'C-MM-IMG-6',
    severity: 'info',
    docs: [DOCS.i2i],
    check: (c) =>
      c.mode.id === MODE_SUBJECT && inlineSubjects(c).some((x) => x.format === 'png')
        ? {
            slots: [SLOT_SUBJECT],
            message: T(
              'PNG 参考图会以 data:image/png;base64 发送；文档只给了 JPEG 的 Data URL 示例，PNG 写法未说明。若被拒，可改用 JPG 或公网 URL',
              'The PNG reference is sent as data:image/png;base64; docs only show a JPEG data URL example and do not specify PNG. If rejected, use a JPG or a public URL',
            ),
          }
        : null,
  },
  {
    id: 'C-MM-IMG-7',
    severity: 'warn',
    docs: FIELD_DOCS,
    check: (c) => {
      const v = c.effective.seed;
      return typeof v === 'number' && Number.isInteger(v) && (v < 0 || v > SEED_COMMON_MAX)
        ? {
            fields: ['seed'],
            message: T(
              `seed ${v} 不在 0–${SEED_COMMON_MAX} 内；文档只写了 int64，未给取值范围与是否允许负数，可能被拒`,
              `seed ${v} is outside 0–${SEED_COMMON_MAX}; docs only say int64 with no range or sign rules, so it may be rejected`,
            ),
          }
        : null;
    },
  },
];

/* ---------------- 只挂在 image-01-live 上的约束 ---------------- */

export const LIVE_T2I_CONFLICT: Constraint = {
  id: 'C-MM-IMG-1',
  severity: 'warn',
  docs: [DOCS.t2i, DOCS.mcp],
  check: (c) =>
    c.mode.id === MODE_T2I
      ? {
          message: T(
            '文档冲突：文生图 OpenAPI 的 model 枚举只有 image-01，MCP 文生图工具却允许 image-01-live；该组合可能被服务商拒绝',
            'Docs conflict: the text-to-image OpenAPI only lists image-01, while the MCP text_to_image tool allows image-01-live; this combination may be rejected',
          ),
        }
      : null,
};

export const LIVE_SUBJECT_CONFLICT: Constraint = {
  id: 'C-MM-IMG-5',
  severity: 'warn',
  docs: [DOCS.i2i, DOCS.overview],
  check: (c) =>
    c.mode.id === MODE_SUBJECT
      ? {
          message: T(
            '文档冲突：主体参考 OpenAPI 的 model 枚举含 image-01-live，但同字段说明只写 "Options: image-01"，API 总览、定价、限流表也未列出该模型；可能被服务商拒绝',
            'Docs conflict: the subject-reference OpenAPI enum lists image-01-live, but the same field says "Options: image-01" and the API overview, pricing and rate-limit tables omit it; it may be rejected',
          ),
        }
      : null,
};

export const LIVE_PRICE_UNKNOWN: Constraint = {
  id: 'C-MM-IMG-8',
  severity: 'info',
  docs: [DOCS.pricing],
  check: () => ({
    message: T(
      'image-01-live 的价格文档未说明，不显示预估费用；实际扣费以 MiniMax 账单为准',
      'image-01-live pricing is undocumented, so no estimate is shown; actual charges follow your MiniMax bill',
    ),
  }),
};

/* ---------------- wireGuard（主要拦截原始字段覆盖造成的非法组合） ---------------- */

const present = (b: Record<string, unknown>, k: string) => b[k] !== undefined && b[k] !== null;

export const IMAGE01_WIRE_GUARDS: WireGuard[] = [
  {
    id: 'mm-img-size-pair',
    check: (b) => (present(b, 'width') !== present(b, 'height') ? T('width 与 height 必须同时设置', 'width and height must be set together') : null),
  },
  {
    id: 'mm-img-size-exclusive',
    check: (b) =>
      present(b, 'aspect_ratio') && (present(b, 'width') || present(b, 'height'))
        ? T('aspect_ratio 与 width/height 同时出现时以 aspect_ratio 为准，自定义宽高会被忽略；请只保留一种', 'With both aspect_ratio and width/height, aspect_ratio wins and the custom size is ignored; keep only one')
        : null,
  },
  {
    // 原文 width/height "Only effective for image-01"；对其他模型是忽略还是报错未说明，与 aspect_ratio 并存一样按「不生效」拦截
    id: 'mm-img-custom-size-model',
    check: (b) =>
      (present(b, 'width') || present(b, 'height')) && b.model !== 'image-01'
        ? T(`width/height 只对 image-01 生效，当前 model 为 ${String(b.model)}，自定义宽高不会生效；请改用预设比例`, `width/height only apply to image-01; with model ${String(b.model)} the custom size has no effect. Use an aspect-ratio preset`)
        : null,
  },
  {
    id: 'mm-img-single-subject',
    check: (b) =>
      Array.isArray(b.subject_reference) && b.subject_reference.length > 1
        ? T('每次请求只支持 1 张主体参考图', 'Only one subject reference image is supported per request')
        : null,
  },
];

/* ---------------- 计价 ---------------- */

/** image-01 按量付费 $0.0035/张 × n；被审核拦截的图片是否计费文档未说明 */
export function image01Cost(c: EvalCtx): CostEstimate | null {
  const n = typeof c.effective.n === 'number' ? c.effective.n : 1;
  return {
    amount: Math.round(IMAGE01_USD_PER_IMAGE * n * 1e6) / 1e6,
    currency: 'USD',
    basis: T(`$${IMAGE01_USD_PER_IMAGE}/张 × ${n}`, `$${IMAGE01_USD_PER_IMAGE}/image × ${n}`),
    confidence: 'list-price',
  };
}
