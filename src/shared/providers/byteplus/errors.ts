import type { UpstreamResponse } from '../../catalog/types.js';
import { T } from '../../catalog/helpers.js';
import { extractRequestId, makeError, safeJson, type ErrorCategory, type NormalizedError } from '../../task/errors.js';

interface ArkErrorBody {
  error?: { code?: string; message?: string; type?: string; param?: string };
}

function categorize(status: number, code: string): ErrorCategory {
  if (status === 401 || /^Authentication|Unauthorized/i.test(code)) return 'auth';
  if (/SensitiveContentDetected/i.test(code)) return 'content_policy';
  if (/^InvalidParameter\.TaskType/i.test(code)) return 'task_type';
  if (/ModelNotOpen|ServiceNotOpen/i.test(code)) return 'not_open';
  if (/Overdue/i.test(code)) return 'balance';
  if (/QuotaExceeded|SetLimitExceeded/i.test(code)) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status === 403) return 'permission';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid_param';
  if (status >= 500) return 'upstream_5xx';
  // HTTP 200 里的错误（同步结果顶层 error、组图单张 error、SSE error 帧）只能按错误码归类
  if (/^(MissingParameter|InvalidParameter|InvalidImageURL|BadRequest)/i.test(code)) return 'invalid_param';
  if (/RateLimit|ServerOverloaded|RequestBurstTooFast|InflightBatchsizeExceeded/i.test(code)) return 'rate_limit';
  if (/^(InternalServiceError|InternalServerError)/i.test(code)) return 'upstream_5xx';
  if (/^(AccessDenied|OperationDenied)/i.test(code)) return 'permission';
  if (/NotFound/i.test(code)) return 'not_found';
  return 'unknown';
}

const HINTS: Partial<Record<ErrorCategory, ReturnType<typeof T>>> = {
  auth: T('API Key 无效或缺失：检查 Key 是否被禁用、是否属于 ap-southeast-1 区域与对应项目', 'Invalid or missing API key: check that it is enabled and belongs to ap-southeast-1 and the right project'),
  not_open: T('模型未开通：请到 ModelArk 控制台开通（Seedance 2.x 开通需余额 > 30 美元等条件）', 'Model not activated: activate it in the ModelArk console (Seedance 2.x requires balance > USD 30, etc.)'),
  balance: T('账号欠费，请充值', 'Account overdue; please top up'),
  quota: T('额度或排队任务数已达上限，请稍后再试或查看控制台额度', 'Quota or queued-task limit reached; retry later or check the console'),
  rate_limit: T('请求过于频繁，已触发限流', 'Rate limited; slow down'),
  content_policy: T('输入或输出触发了内容审核', 'Input or output was flagged by content moderation'),
  task_type: T('参数与模型识别出的任务类型不兼容（例如 Seedance 2.5 首帧任务必须 ratio=adaptive）', 'Parameters conflict with the detected task type (e.g. Seedance 2.5 first-frame tasks need ratio=adaptive)'),
};

export function normalizeBytePlusError(res: UpstreamResponse): NormalizedError | null {
  const parsed = safeJson(res.bodyText) as ArkErrorBody | undefined;
  const err = parsed?.error;
  if (res.status < 400 && !err) return null;
  const code = err?.code ?? `HTTP_${res.status}`;
  const message = err?.message ?? (res.bodyText.slice(0, 500) || `HTTP ${res.status}`);
  const category = categorize(res.status, code);
  const requestId = res.headers['x-request-id'] ?? extractRequestId(message);
  const retryAfter = Number(res.headers['retry-after']);
  return makeError({
    providerId: 'byteplus',
    category,
    code,
    httpStatus: res.status,
    message,
    ...(requestId ? { requestId } : {}),
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    ...(HINTS[category] ? { hint: HINTS[category] } : {}),
    // 额度类 429 不应自动重试
    ...(category === 'quota' ? { retryable: false } : {}),
  });
}
