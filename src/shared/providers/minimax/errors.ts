import type { UpstreamResponse } from '../../catalog/types.js';
import { T } from '../../catalog/helpers.js';
import { makeError, safeJson, type ErrorCategory, type NormalizedError } from '../../task/errors.js';

interface BaseResp {
  base_resp?: { status_code?: number | string; status_msg?: string };
}
interface V2Error {
  type?: string;
  error?: { type?: string; message?: string; http_code?: string | number };
  request_id?: string;
}

const CODE_CATEGORY: Record<string, ErrorCategory> = {
  '1000': 'upstream_5xx',
  '1001': 'timeout',
  '1002': 'rate_limit',
  '1004': 'auth',
  '1008': 'balance',
  '1013': 'upstream_5xx',
  '1024': 'upstream_5xx',
  '1033': 'upstream_5xx',
  '1041': 'rate_limit',
  '1042': 'invalid_param',
  '2045': 'rate_limit',
  '1026': 'content_policy',
  '1027': 'content_policy',
  '1039': 'rate_limit',
  '2013': 'invalid_param',
  '2049': 'auth',
  '2056': 'quota',
};

const V2_TYPE_CATEGORY: Record<string, ErrorCategory> = {
  bad_request_error: 'invalid_param',
  authorized_error: 'auth',
  insufficient_balance_error: 'balance',
  unprocessable_entity_error: 'content_policy',
  rate_limit_error: 'rate_limit',
  server_error: 'upstream_5xx',
  overloaded_error: 'upstream_5xx',
};

const HINTS: Partial<Record<ErrorCategory, ReturnType<typeof T>>> = {
  auth: T('API Key 无效：请确认是国际站（platform.minimax.io）的按量付费 Key（sk-api- 开头）', 'Invalid API key: use a pay-as-you-go key (sk-api-…) from platform.minimax.io'),
  balance: T('余额不足，请到 MiniMax 控制台充值', 'Insufficient balance; top up in the MiniMax console'),
  content_policy: T('内容触发了安全审核', 'Content was flagged by safety checks'),
  rate_limit: T('请求过于频繁，已触发限流', 'Rate limited; slow down'),
  quota: T('额度窗口已用完，请等待下一个窗口', 'Usage window exhausted; wait for the next window'),
};

function fromCode(code: string, httpStatus: number | undefined, message: string, requestId?: string): NormalizedError {
  const category = CODE_CATEGORY[code] ?? (httpStatus && httpStatus >= 500 ? 'upstream_5xx' : 'unknown');
  return makeError({
    providerId: 'minimax',
    category,
    code,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    message,
    ...(requestId ? { requestId } : {}),
    ...(HINTS[category] ? { hint: HINTS[category] } : {}),
  });
}

/**
 * MiniMax 两种错误形态：
 * - V1 / 图像：HTTP 200 + base_resp.status_code ≠ 0
 * - V2 视频：HTTP 状态码 + {type:'error', error:{type, message, http_code}}，内部码在 message 末尾括号里
 */
export function normalizeMiniMaxError(res: UpstreamResponse): NormalizedError | null {
  const parsed = safeJson(res.bodyText) as (BaseResp & V2Error) | undefined;
  const requestId = res.headers['trace-id'] ?? res.headers['x-request-id'] ?? parsed?.request_id;
  if (parsed?.type === 'error' && parsed.error) {
    const message = parsed.error.message ?? `HTTP ${res.status}`;
    const inner = /\((\d{3,6})\)\s*$/.exec(message)?.[1];
    const category: ErrorCategory =
      (inner ? CODE_CATEGORY[inner] : undefined) ?? V2_TYPE_CATEGORY[parsed.error.type ?? ''] ?? (res.status >= 500 ? 'upstream_5xx' : 'unknown');
    return makeError({
      providerId: 'minimax',
      category,
      code: inner ?? parsed.error.type ?? `HTTP_${res.status}`,
      httpStatus: res.status,
      message,
      ...(requestId ? { requestId } : {}),
      ...(HINTS[category] ? { hint: HINTS[category] } : {}),
    });
  }
  const sc = parsed?.base_resp?.status_code;
  if (sc !== undefined && String(sc) !== '0') {
    return fromCode(String(sc), res.status, parsed?.base_resp?.status_msg ?? '', requestId);
  }
  if (res.status >= 400) return fromCode(`HTTP_${res.status}`, res.status, res.bodyText.slice(0, 500) || `HTTP ${res.status}`, requestId);
  return null;
}
