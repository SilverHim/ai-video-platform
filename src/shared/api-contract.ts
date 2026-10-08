/** 浏览器 / MCP 与本机服务之间的契约：路由前缀、请求头名、通用响应类型 */

export const APP_NAME = 'ai-video-platform';
export const APP_DISPLAY_NAME = 'AI视频生成平台';
export const DEFAULT_PORT = 8787;

/** 浏览器调用 /api/* 必须带的自定义头：跨源页面无法在不触发预检的情况下伪造，而本服务从不应答 CORS */
export const CLIENT_HEADER = 'x-ark-client';
export const CLIENT_HEADER_VALUE = 'web';

export const PROVIDER_IDS = ['byteplus', 'minimax'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(v: string): v is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(v);
}

export interface HealthInfo {
  ok: true;
  name: string;
  version: string;
  node: string;
  platform: string;
  dataDir: string;
  mock: boolean;
  ffprobe: boolean;
}

export type KeySource = 'env' | 'file' | 'none';

export interface KeyStatus {
  provider: ProviderId;
  configured: boolean;
  source: KeySource;
  /** 打码后的 Key，例如 sk-a…9f3c；从不返回原文 */
  masked: string | null;
  updatedAt: number | null;
}

export interface ApiError {
  error: { code: string; message: string };
}

/* ---------------- 推理接入点（Endpoint）管理：BytePlus 控制面，AK/SK 签名 ---------------- */

/** 控制面凭据（AK/SK）的状态；从不返回 Secret */
export interface ControlCredentialStatus {
  configured: boolean;
  source: KeySource;
  /** 打码后的 AccessKey ID */
  maskedAccessKeyId: string | null;
  updatedAt: number | null;
}

/** 内容过滤状态：接口文档未列出 Moderation 字段，实测 GetEndpoint 会返回；没返回时为 unknown */
export type ContentFilterState = 'on' | 'off' | 'unknown';

export interface EndpointInfo {
  id: string;
  name: string;
  description: string;
  status: string;
  statusReason: string;
  /** 绑定的基础模型；自定义模型时为 null */
  foundationModel: { name: string; version: string } | null;
  customModelId: string | null;
  /** 按基础模型匹配到的本平台模型 id（如 byteplus/seedream-5-0-flash）；匹配不到为 null */
  modelId: string | null;
  contentFilter: ContentFilterState;
  /** 原始 Moderation.Strategy，便于排查 */
  moderationStrategy: string | null;
  rateLimit: { rpm: number; tpm: number } | null;
  projectName: string;
  createTime: string;
  updateTime: string;
}

export interface EndpointCreateInput {
  /** 本平台模型 id，例如 byteplus/seedream-5-0-flash */
  modelId: string;
  name: string;
  description?: string;
  /** false 表示关闭内容过滤（发送 Moderation.Strategy=Skip） */
  contentFilter: boolean;
  rateLimit?: { rpm: number; tpm: number };
}

export interface EndpointUpdateInput {
  name?: string;
  description?: string;
  rateLimit?: { rpm: number; tpm: number };
  /** 开关内容过滤（Moderation.Strategy Default / Skip，接口文档未列出，按实测） */
  contentFilter?: boolean;
}

/** 新建前的预检结果（CreateEndpoint DryRun=true） */
export interface EndpointCreatePlan {
  request: Record<string, unknown>;
  dryRun: { ok: true } | { ok: false; code: string; message: string };
  notes: { zh: string; en: string }[];
}

/** ModelArk 控制台「在线推理」页（官方文档 create-standard-inference-endpoint 给出的链接） */
export const ARK_CONSOLE_ENDPOINTS_URL = 'https://ai.byteplus.com/ark/region:ap-southeast-1/endpoint?config=%7B%7D';
