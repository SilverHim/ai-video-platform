import type { I18nText } from '../i18n.js';

export type ErrorCategory =
  | 'auth'
  | 'permission'
  | 'not_open'
  | 'balance'
  | 'rate_limit'
  | 'quota'
  | 'content_policy'
  | 'invalid_param'
  | 'task_type'
  | 'not_found'
  | 'upstream_5xx'
  | 'network'
  | 'timeout'
  | 'local_validation'
  | 'too_large'
  | 'upload'
  | 'unknown';

export interface NormalizedError {
  providerId: string;
  category: ErrorCategory;
  /** 服务商原始错误码（字符串） */
  code: string;
  httpStatus?: number;
  message: string;
  requestId?: string;
  retryable: boolean;
  retryAfterMs?: number;
  hint?: I18nText;
}

const RETRYABLE = new Set<ErrorCategory>(['rate_limit', 'upstream_5xx', 'network', 'timeout']);

export function makeError(e: Omit<NormalizedError, 'retryable'> & { retryable?: boolean }): NormalizedError {
  return { ...e, retryable: e.retryable ?? RETRYABLE.has(e.category) };
}

/** 从错误文本里提取 BytePlus 风格的 "request id: xxx" */
export function extractRequestId(text: string): string | undefined {
  const m = /request id:?\s*([A-Za-z0-9-]{8,})/i.exec(text);
  return m?.[1];
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
