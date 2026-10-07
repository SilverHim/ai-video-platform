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
