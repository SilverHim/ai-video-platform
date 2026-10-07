import { describe, expect, it } from 'vitest';
import type { UpstreamResponse } from '../../../../catalog/types.js';
import { normalizeH3Submit, normalizeH3Task } from '../adapter.js';
// 官方 V2 OpenAPI（v2-video-generation.json）components.schemas.*.example、components.responses.Err*、查询接口 examples 原样摘录
import createResponse from '../__fixtures__/create.response.json';
import errors from '../__fixtures__/errors.json';
import listResponse from '../__fixtures__/list.response.json';
import queryFailed from '../__fixtures__/query.failed.json';
import querySucceeded from '../__fixtures__/query.succeeded.json';
import { ALL, model } from './helpers.js';

const res = (status: number, body: unknown, headers: Record<string, string> = {}): UpstreamResponse => ({ status, headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) });
const task = (t: Record<string, unknown>) => normalizeH3Task(res(200, { task: t }));
const listItem = (status: string) => listResponse.items.find((i) => i.status === status)!;

describe('normalizeSubmit', () => {
  it('官方创建响应 → task-created', () => {
    expect(normalizeH3Submit(res(200, createResponse))).toEqual({ kind: 'task-created', taskId: '424010985738629' });
  });

  it('数字形态的大整数 task_id 不丢精度', () => {
    expect(normalizeH3Submit(res(200, '{"task_id": 424010985738629123}'))).toEqual({ kind: 'task-created', taskId: '424010985738629123' });
  });

  it.each([
    ['Err400', 400, 'invalid_param', '2013', false],
    ['Err401', 401, 'auth', '1004', false],
    ['Err402', 402, 'balance', '1008', false],
    ['Err422', 422, 'content_policy', '1026', false],
    ['Err429', 429, 'rate_limit', '1002', true],
    ['Err500', 500, 'upstream_5xx', '1000', true],
  ] as const)('官方错误 %s', (key, status, category, code, retryable) => {
    const r = normalizeH3Submit(res(status, errors[key]));
    expect(r.kind).toBe('error');
    if (r.kind !== 'error') return;
    expect(r.error).toMatchObject({ providerId: 'minimax', category, code, httpStatus: status, retryable, requestId: '021785229015510a2c883cf675b9804d' });
    expect(r.error.message).toBe(errors[key].error.message);
  });

  it('HTTP 200 但没有 task_id / 不是 JSON → BAD_RESPONSE', () => {
    for (const body of [{}, { task_id: '' }, 'not json']) {
      const r = normalizeH3Submit(res(200, body));
      expect(r).toMatchObject({ kind: 'error', error: { code: 'BAD_RESPONSE', category: 'unknown' } });
    }
  });

  it('两个模型共用同一个适配器', () => {
    for (const id of ALL) expect(model(id).adapter.normalizeSubmit).toBe(normalizeH3Submit);
  });
});

describe('normalizeTask', () => {
  it('成功（官方示例）：取 content.url 为唯一视频，不写 expiresAt，V2 没有尾帧', () => {
    const s = normalizeH3Task(res(200, querySucceeded));
    expect(s).toEqual({
      taskId: '424010985738629',
      status: 'succeeded',
      rawStatus: 'succeeded',
      createdAt: 1785125529000,
      updatedAt: 1785125946000,
      assets: [{ index: 0, role: 'video', kind: 'video', source: { type: 'url', url: querySucceeded.task.content.url } }],
      usage: querySucceeded.task.usage,
      actual: { model: 'MiniMax-H3', resolution: '2K', duration: 5, ratio: '16:9', task_type: 'generation' },
    });
    expect(s.assets.some((a) => a.role === 'last_frame')).toBe(false);
  });

  it('失败（官方示例）：error.code 按字符串归类，usage 为 {} 时不写', () => {
    const s = normalizeH3Task(res(200, queryFailed));
    expect(s).toMatchObject({ taskId: '424010985738630', status: 'failed', rawStatus: 'failed', assets: [] });
    expect(s.error).toMatchObject({ providerId: 'minimax', category: 'content_policy', code: '1026', message: 'video description contains sensitive content', retryable: false });
    expect(s.error).not.toHaveProperty('httpStatus');
    expect(s).not.toHaveProperty('usage');
    expect(s.actual).toEqual({ model: 'MiniMax-H3', resolution: '2K', duration: 5, ratio: '16:9', task_type: 'generation', modality: 'video' });
  });

  it('列表示例里的 queued / running / failed / succeeded 逐条映射', () => {
    expect(task(listItem('queued'))).toMatchObject({ taskId: '424635601932587', status: 'queued', assets: [] });
    expect(task(listItem('running'))).toMatchObject({ taskId: '424635601932588', status: 'running', assets: [] });
    expect(task(listItem('running'))).not.toHaveProperty('usage');
    expect(task(listItem('failed')).error).toMatchObject({ code: '1026', category: 'content_policy' });
    const ok = task(listItem('succeeded'));
    expect(ok.assets).toHaveLength(1);
    expect(ok.actual?.ratio).toBe('adaptive');
  });

  it('cancelled → cancelled，无错误', () => {
    const s = task({ id: '1', status: 'cancelled', usage: {} });
    expect(s).toEqual({ taskId: '1', status: 'cancelled', rawStatus: 'cancelled', assets: [] });
  });

  it('未知状态 → unknown，保留原始值', () => {
    expect(task({ id: '1', status: 'processing' })).toMatchObject({ status: 'unknown', rawStatus: 'processing' });
    expect(task({ id: '1' })).toMatchObject({ status: 'unknown', rawStatus: '' });
  });

  it('succeeded 但缺 content.url → failed + EMPTY_RESULT（与 Seedance 一致，不无限轮询）', () => {
    for (const t of [{ id: '1', status: 'succeeded', content: {} }, { id: '1', status: 'succeeded' }, { id: '1', status: 'succeeded', content: { url: '' } }]) {
      const s = task(t);
      expect(s).toMatchObject({ taskId: '1', status: 'failed', rawStatus: 'succeeded', assets: [], error: { providerId: 'minimax', category: 'unknown', code: 'EMPTY_RESULT' } });
    }
  });

  it('失败但没有 error / 数字形态的错误码', () => {
    expect(task({ id: '1', status: 'failed' }).error).toMatchObject({ category: 'unknown', code: 'TASK_FAILED' });
    expect(task({ id: '1', status: 'failed', error: { code: 1000, message: 'internal error' } }).error).toMatchObject({ category: 'upstream_5xx', code: '1000', retryable: true });
    expect(task({ id: '1', status: 'failed', error: { code: '99999', message: 'x' } }).error).toMatchObject({ category: 'unknown', code: '99999' });
  });

  it('ratio 为空字符串时不写进 actual', () => {
    expect(task({ id: '1', status: 'running', ratio: '', resolution: '768P' }).actual).toEqual({ resolution: '768P' });
  });

  it('数字形态的大整数 id 不丢精度', () => {
    expect(normalizeH3Task(res(200, '{"task":{"id":424635601932588123,"status":"queued"}}')).taskId).toBe('424635601932588123');
  });

  it('错误信封 / 非 JSON / 缺 task → unknown + 错误', () => {
    const env = normalizeH3Task(res(400, { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id (2013)', http_code: '400' } }));
    expect(env).toMatchObject({ status: 'unknown', error: { category: 'invalid_param', code: '2013' } });
    expect(normalizeH3Task(res(200, 'oops'))).toMatchObject({ status: 'unknown', error: { code: 'BAD_RESPONSE' } });
    expect(normalizeH3Task(res(200, { items: [] }))).toMatchObject({ status: 'unknown', error: { code: 'BAD_RESPONSE' } });
  });
});
