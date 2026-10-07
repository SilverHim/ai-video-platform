import { describe, expect, it } from 'vitest';
import { normalizeBytePlusError } from '../providers/byteplus/errors.js';
import { normalizeMiniMaxError } from '../providers/minimax/errors.js';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });

describe('BytePlus 错误归一化', () => {
  it('401（文档实测样例）', () => {
    const e = normalizeBytePlusError(res(401, { error: { code: 'AuthenticationError', message: 'the API key or AK/SK in the request is missing or invalid. request id: 0217abc123def456', param: '', type: 'Unauthorized' } }))!;
    expect(e).toMatchObject({ category: 'auth', code: 'AuthenticationError', httpStatus: 401, requestId: '0217abc123def456', retryable: false });
    expect(e.hint).toBeDefined();
  });
  it.each([
    [400, 'InputImageSensitiveContentDetected', 'content_policy'],
    [400, 'InvalidParameter.TaskTypeConstraint', 'task_type'],
    [400, 'InvalidParameter', 'invalid_param'],
    [403, 'OperationDenied.ServiceNotOpen', 'not_open'],
    [404, 'ModelNotOpen', 'not_open'],
    [403, 'AccountOverdueError', 'balance'],
    [429, 'QuotaExceeded', 'quota'],
    [429, 'ModelAccountIpmRateLimitExceeded', 'rate_limit'],
    [500, 'InternalServiceError', 'upstream_5xx'],
  ])('%i %s → %s', (status, code, category) => {
    expect(normalizeBytePlusError(res(status, { error: { code, message: 'm' } }))?.category).toBe(category);
  });
  it('额度类不可重试，限流可重试', () => {
    expect(normalizeBytePlusError(res(429, { error: { code: 'QuotaExceeded' } }))!.retryable).toBe(false);
    expect(normalizeBytePlusError(res(429, { error: { code: 'RateLimitExceeded.EndpointRPMExceeded' } }))!.retryable).toBe(true);
  });
  it('成功响应返回 null', () => {
    expect(normalizeBytePlusError(res(200, { data: [] }))).toBeNull();
  });
});

describe('MiniMax 错误归一化', () => {
  it('HTTP 200 + base_resp 错误', () => {
    expect(normalizeMiniMaxError(res(200, { base_resp: { status_code: 2013, status_msg: 'invalid params' } }))).toMatchObject({ category: 'invalid_param', code: '2013' });
    expect(normalizeMiniMaxError(res(200, { base_resp: { status_code: 1026, status_msg: 'sensitive' } }))!.category).toBe('content_policy');
  });
  it('base_resp 成功返回 null', () => {
    expect(normalizeMiniMaxError(res(200, { data: {}, base_resp: { status_code: 0, status_msg: 'success' } }))).toBeNull();
  });
  it('V2 错误信封：从 message 末尾括号取内部码', () => {
    const e = normalizeMiniMaxError(res(400, { type: 'error', error: { type: 'bad_request_error', message: 'invalid params, content must include a non-empty text item (prompt is required) (2013)', http_code: '400' }, request_id: 'r1' }))!;
    expect(e).toMatchObject({ category: 'invalid_param', code: '2013', httpStatus: 400, requestId: 'r1' });
    expect(normalizeMiniMaxError(res(402, { type: 'error', error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)' } }))!.category).toBe('balance');
    expect(normalizeMiniMaxError(res(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }))!.category).toBe('upstream_5xx');
  });
});
