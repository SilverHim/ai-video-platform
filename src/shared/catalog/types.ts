/**
 * 声明式模型目录的类型。所有服务商 / 模型知识都写成这些声明，
 * 表单渲染、提交拦截、请求构建、MCP 校验与测试共用同一份。
 */
import type { ProviderId } from '../api-contract.js';
import type { I18nText } from '../i18n.js';
import type { NormalizedError } from '../task/errors.js';
import type { NormalizedResult, StreamUpdate, TaskSnapshot } from '../task/results.js';

export type OutputKind = 'image' | 'video';
export type MediaKind = 'image' | 'video' | 'audio';

export interface DocRef {
  url: string;
  /** 核对文档的日期 YYYY-MM-DD */
  checkedAt: string;
  note?: string;
}

export interface Lifecycle {
  status: 'active' | 'retiring' | 'retired';
  note?: I18nText;
  /** 默认在模型列表中隐藏（"显示已弃用模型"打开后才出现） */
  hiddenByDefault?: boolean;
}

/* ------------------------------------------------------------------ */
/* 表单输入（网页与 MCP 提交的统一快照）                                  */
/* ------------------------------------------------------------------ */

export type FormValues = Record<string, unknown>;

export type AssetSourceType = 'local' | 'url' | 'provider-asset' | 'provider-file' | 'task-output';

export type AssetSource =
  /** 已上传到本机服务的本地文件（AssetStore 中的 id） */
  | { type: 'local'; assetId: string; filename?: string; mime: string; bytes: number; sha256?: string }
  /** 公网 URL（用户手填或托管直链） */
  | { type: 'url'; url: string }
  /** 服务商素材库引用，如 asset://xxx */
  | { type: 'provider-asset'; uri: string }
  /** 服务商文件引用，如 mm_file://<file_id> */
  | { type: 'provider-file'; uri: string; expiresAt?: number }
  /** 复用历史任务的输出 */
  | { type: 'task-output'; taskId: string; index: number; remoteUrl?: string; remoteExpiresAt?: number; localPath?: string; mime?: string };

export interface MediaMeta {
  kind: MediaKind;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
  fps?: number;
  hasAlpha?: boolean;
  codec?: string;
}

export interface AssetRef {
  /** 表单内稳定 id，提示词里用 {{ref:<id>}} 引用 */
  id: string;
  source: AssetSource;
  meta?: MediaMeta;
}

export interface FormInput {
  providerId: string;
  modelId: string;
  modeId: string;
  values: FormValues;
  /** 槽位 id → 素材列表（顺序即编号顺序） */
  slots: Record<string, AssetRef[]>;
  /** 提示词，素材引用写成 {{ref:<assetRefId>}} */
  prompt: string;
  /** 高级：直接深合并进最终请求体（用于未文档化字段），界面醒目警告 */
  rawOverrides?: Record<string, unknown>;
  /** 用 Endpoint ID 等覆盖 model 字段（BytePlus ep-xxx） */
  modelOverride?: string;
  /** 派生自哪个已有任务（样片转正片、编辑 / 延长时使用） */
  derivedFrom?: DerivedFrom;
  /** 用哪种 Key（MiniMax 有按量 / 订阅两种）；不填时有订阅 Key 用订阅，否则用按量。提交后记录实际用的那种 */
  credential?: CredentialKind;
}

/** Key 类型：paygo 按量（扣账户余额）；subscription 订阅（MiniMax sk-cp-，从 M Plan / Token Plan 额度扣） */
export type CredentialKind = 'paygo' | 'subscription';

export interface DerivedFrom {
  /** 本地任务 id */
  taskId: string;
  /** 服务商任务 id（例如 Seedance 的 cgt-…，正片请求里的 draft_task.id） */
  upstreamTaskId: string;
  modelId: string;
  /** 源任务创建时间（毫秒），用于判断样片 7 天有效期等 */
  createdAt: number;
  relation: 'draft-final' | 'edit' | 'extend' | 'reuse';
}

/* ------------------------------------------------------------------ */
/* 字段                                                                */
/* ------------------------------------------------------------------ */

/** 条件函数拿到的上下文：values 已套用默认值与锁定值 */
export interface PredCtx {
  provider: ProviderDef;
  model: ModelDef;
  mode: ModeDef;
  values: FormValues;
  slots: Record<string, AssetRef[]>;
  input: FormInput;
}
export type Pred = (c: PredCtx) => boolean;

export interface EnumOption {
  value: string;
  label?: I18nText;
  badge?: I18nText;
  /** 返回原因表示当前上下文下不可选 */
  unavailable?: (c: PredCtx) => I18nText | null;
}

export type SizeValue = { mode: 'preset'; value: string } | { mode: 'custom'; width: number; height: number };

export interface SizeSpec {
  presets: { value: string; label?: I18nText; px?: [number, number] }[];
  /** 允许自定义宽高时的约束；不传表示只能选预设 */
  custom?: {
    minPixels?: number;
    maxPixels?: number;
    /** 宽高比 w/h 的闭区间 */
    aspect?: [number, number];
    side?: [number, number];
    multipleOf?: number;
  };
  /** 把尺寸值写成请求体片段，例如 {size:'2K'} 或 {width, height} */
  toWire: (v: SizeValue) => Record<string, unknown>;
}

interface FieldBase<T> {
  key: string;
  label: I18nText;
  help?: I18nText;
  group: 'basic' | 'advanced' | 'output';
  /** 只在这些模式下出现 */
  modes?: string[];
  visible?: Pred;
  /** 返回原因表示禁用（禁用字段不发送） */
  disabled?: (c: PredCtx) => I18nText | null;
  /** 返回值表示锁定为该值（锁定字段照常发送） */
  locked?: (c: PredCtx) => { value: T; reason: I18nText } | null;
  default: T | ((c: PredCtx) => T);
  /** 写入请求体的路径（点分隔，如 optimize_prompt_options.mode）；null 表示由 fragment 或 compose 处理 */
  wire: string | null;
  /** 把值写成请求体片段（深合并）；优先于 wire */
  fragment?: (v: T, c: PredCtx) => Record<string, unknown> | null;
  /** 'always'：可见即发送；'if-set'：值非空才发送；'never'：只用于界面 */
  send?: 'always' | 'if-set' | 'never';
  docs?: DocRef[];
  /** 文档有冲突、未验证的字段 */
  experimental?: boolean;
}

export type FieldDef =
  | (FieldBase<string> & { type: 'enum'; options: EnumOption[]; control?: 'select' | 'segmented' })
  | (FieldBase<number | null> & {
      type: 'int';
      min: number;
      max: number;
      step?: number;
      /** 特殊值，例如 -1 = 自动 */
      specials?: { value: number; label: I18nText }[];
      /** 必须满足 value = base + step*n（n 为非负整数） */
      pattern?: { base: number; step: number };
    })
  | (FieldBase<boolean> & { type: 'bool' })
  | (FieldBase<string> & { type: 'text'; maxLength?: number; multiline?: boolean })
  /** null 表示随机（不发送） */
  | (FieldBase<number | null> & { type: 'seed'; min: number; max: number })
  | (FieldBase<SizeValue> & { type: 'size'; spec: (c: PredCtx) => SizeSpec });

export type FieldType = FieldDef['type'];

/* ------------------------------------------------------------------ */
/* 模式与素材槽                                                         */
/* ------------------------------------------------------------------ */

export interface MediaSpec {
  /** 小写格式名：jpeg png webp bmp tiff gif heic heif mp4 mov wav mp3 */
  formats: string[];
  maxBytes: number;
  /** 宽、高都必须 > 该值 */
  minSideExclusive?: number;
  /** 宽、高的闭区间 */
  side?: [number, number];
  /** 总像素闭区间 */
  pixels?: [number, number];
  /** 宽高比 w/h 闭区间 */
  aspect?: [number, number];
  durationSec?: [number, number];
  fps?: [number, number];
  requireAlpha?: boolean;
}

export interface SlotDef {
  id: string;
  kind: MediaKind;
  label: I18nText;
  /** 请求里的 role 值（如 first_frame / reference_image） */
  role?: string;
  min: number;
  max: number;
  sources: AssetSourceType[];
  spec: MediaSpec;
  help?: I18nText;
}

export interface PromptSpec {
  required: boolean | Pred;
  /** false：该模型不支持在提示词里引用素材，界面隐藏"插入引用" */
  refs?: false;
  /** 硬上限（字符数），超过报错 */
  maxChars?: number;
  /** 软上限：中文字数 / 英文单词数，超过只提示 */
  softMax?: { zhChars: number; enWords: number };
  /** 素材在提示词里的引用写法，如 n => `Image ${n}` */
  refLabel?: (kind: MediaKind, n: number) => string;
  hint?: I18nText;
}

export interface ModeDef {
  id: string;
  label: I18nText;
  hint?: I18nText;
  /** derived：只能从已有任务进入（如样片转正片），不出现在模式 Tab 上 */
  entry?: 'user' | 'derived';
  slots: SlotDef[];
  prompt: PromptSpec;
  /** 本模式下锁定的字段值 */
  locked?: Record<string, { value: unknown; reason: I18nText }>;
  /** 本模式固定写入请求体的片段 */
  wire?: Record<string, unknown>;
  experimental?: boolean;
  hiddenByDefault?: boolean;
}

/* ------------------------------------------------------------------ */
/* 约束                                                                */
/* ------------------------------------------------------------------ */

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  message: I18nText;
  fields?: string[];
  slots?: string[];
  /** 一键修复：把这些值合并进表单 */
  fix?: { label: I18nText; patch: FormValues };
}

export interface Constraint {
  id: string;
  severity: Severity;
  check: (c: EvalCtx) => Omit<Issue, 'id' | 'severity'> | null;
  docs?: DocRef[];
}

/** 对最终请求体的最后一道检查（服务端转发前必跑）；返回原因表示不合法 */
export interface WireGuard {
  id: string;
  check: (body: Record<string, unknown>, c: EvalCtx) => I18nText | null;
}

/* ------------------------------------------------------------------ */
/* 求值结果                                                             */
/* ------------------------------------------------------------------ */

export interface FieldState {
  key: string;
  visible: boolean;
  disabledReason?: I18nText;
  locked?: { value: unknown; reason: I18nText };
  value: unknown;
  /** 枚举字段：带可用性标记的选项 */
  options?: (EnumOption & { disabledReason?: I18nText })[];
  /** 值被自动调整时的说明 */
  adjusted?: I18nText;
  /** 是否会写进请求体 */
  sent: boolean;
}

export interface SlotState {
  id: string;
  min: number;
  max: number;
  count: number;
}

export interface EvalCtx extends PredCtx {
  /** 最终会发送的字段值（可见、未禁用、send≠never） */
  effective: FormValues;
  fields: Record<string, FieldState>;
}

export interface EvaluatedForm {
  ctx: EvalCtx;
  fields: Record<string, FieldState>;
  slots: Record<string, SlotState>;
  effective: FormValues;
  issues: Issue[];
  canSubmit: boolean;
}

/* ------------------------------------------------------------------ */
/* 请求构建与解析                                                       */
/* ------------------------------------------------------------------ */

export interface ResolvedAsset {
  /** 写进请求体的值：URL / data URI / asset:// / mm_file:// */
  wire: string;
  /** 预览中显示的值（data URI 截断、占位等） */
  preview: string;
  /** 对请求体大小的贡献估计（字节） */
  bytes: number;
  /** 经上传目标得到的链接的过期时间（毫秒） */
  expiresAt?: number;
  /** 经哪个上传目标得到（uguu / tmpfiles / minimax-files …） */
  uploadedVia?: string;
  /** 本地素材与这条历史结果是同一个文件，改用了它的原始链接 */
  reusedFrom?: { taskId: string; index: number };
}
export type ResolvedAssets = Record<string, ResolvedAsset>;

export interface BuildCtx extends EvalCtx {
  evaluated: EvaluatedForm;
  resolved: ResolvedAssets;
  purpose: 'preview' | 'send';
  /** 已按引用顺序渲染好的提示词 */
  renderedPrompt: string;
  /** assetRefId → 编号信息 */
  refOrder: RefOrder;
}

export interface RefInfo {
  kind: MediaKind;
  /** 同类素材内的序号，从 1 开始 */
  n: number;
  slotId: string;
  /** 该素材在槽位内的下标 */
  index: number;
}
export type RefOrder = Record<string, RefInfo>;

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

/** 服务商的响应适配（按模型家族实现） */
export interface FamilyAdapter {
  /** 组装模型家族特有部分（model、prompt、素材数组等），返回要深合并进请求体的片段 */
  compose: (c: BuildCtx) => Record<string, unknown>;
  /** 解析同步结果或任务创建响应 */
  normalizeSubmit: (res: UpstreamResponse) => NormalizedResult;
  /** 解析任务查询响应（异步模型） */
  normalizeTask?: (res: UpstreamResponse) => TaskSnapshot;
  /** 解析一条 SSE 事件（流式模型） */
  parseStreamEvent?: (ev: { event: string | null; data: string }) => StreamUpdate | null;
}

export interface CostEstimate {
  amount: number;
  currency: 'USD';
  /** 计价说明，例如 "$0.03/张 × 4" */
  basis: I18nText;
  /** 估算可靠性：按文档标价 / 粗略估计 */
  confidence: 'list-price' | 'rough';
}

export interface ModelDef {
  /** 内部稳定 id，如 byteplus/seedream-5-0-pro */
  id: string;
  providerId: ProviderId;
  /** 请求里的 model 字段值 */
  apiModel: string;
  aliases?: string[];
  family: string;
  label: I18nText;
  description?: I18nText;
  output: OutputKind;
  /** sync：同步返回结果；async：创建任务后轮询 */
  kind: 'sync' | 'async';
  lifecycle: Lifecycle;
  badges?: I18nText[];
  docs: DocRef[];
  /** 官方提示词指南的要点（给 agent 写提示词用；MCP get_model_schema 返回） */
  promptGuides?: PromptGuide[];
  /** 提交用的 endpoint id（见 ProviderDef.endpoints）；cancel 用于取消排队中的任务 / 删除云端记录 */
  endpoints: { submit: string; stream?: string; get?: string; cancel?: string; list?: string };
  modes: ModeDef[];
  fields: FieldDef[];
  constraints: Constraint[];
  wireGuards?: WireGuard[];
  adapter: FamilyAdapter;
  /** 是否允许用 Endpoint ID 覆盖 model 字段 */
  allowModelOverride?: boolean;
  estimateCost?: (c: EvalCtx) => CostEstimate | null;
}

/** 官方提示词指南的提炼（不是原文）；source 记录原文链接与核对时的 revision */
export interface PromptGuide {
  id: string;
  title: I18nText;
  source: { url: string; revision: number; checkedAt: string };
  summary: I18nText;
  /** 这份指南适用的模式（挂到模型时按模型实际模式算出；不含派生模式，例如沿用样片提示词的「生成正片」） */
  modes?: string[];
  /** 规则的 modes 为空表示适用于指南的全部模式 */
  rules: { text: I18nText; modes?: string[] }[];
  /** 按规则写的示范提示词（英文） */
  examples?: { prompt: string; note: string; modes?: string[] }[];
}

export interface EndpointDef {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  /** 相对 baseUrl 的路径，{id} 为路径参数 */
  path: string;
  /** JSON 请求的总超时；流式请求为事件间空闲超时 */
  timeoutMs: number;
  /** 'none'：不自动重试（创建类请求）；'idempotent'：网络错误 / 5xx 可重试 */
  retry: 'none' | 'idempotent';
  /** 代理侧限速（每秒请求数，可以是小数，例如 10/60 表示每分钟 10 次） */
  rps?: number;
  /** 令牌桶容量（允许的突发请求数），默认 ceil(rps) */
  burst?: number;
  stream?: boolean;
}

/** 异步任务的轮询节奏 */
export interface PollingPolicy {
  firstDelayMs: number;
  /** 任务创建后 untilAgeMs 毫秒内用 intervalMs 间隔，按顺序匹配 */
  schedule: { untilAgeMs: number; intervalMs: number }[];
  /** schedule 之外的间隔 */
  defaultIntervalMs: number;
  /** 查询窗口（服务商只保留这么久的任务记录） */
  queryWindowMs: number;
}

export interface ProviderDef {
  id: ProviderId;
  label: I18nText;
  baseUrls: { id: string; label: I18nText; url: string; default?: boolean; note?: I18nText }[];
  auth: {
    scheme: 'bearer';
    keyHelpUrl: string;
    /** 按 Key 前缀给出提示（例如 MiniMax 订阅 Key） */
    keyHints?: { prefix: string; level: 'info' | 'warn'; message: I18nText }[];
  };
  endpoints: Record<string, EndpointDef>;
  /** 免费校验 Key 用的请求 */
  keyTest?: { endpointId: string; query?: Record<string, string> };
  limits: { maxRequestBytes: number };
  polling?: PollingPolicy;
  models: ModelDef[];
  normalizeError: (res: UpstreamResponse) => NormalizedError | null;
}
