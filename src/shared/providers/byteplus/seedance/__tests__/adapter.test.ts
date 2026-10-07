import { describe, expect, it } from 'vitest';
import type { UpstreamResponse } from '../../../../catalog/types.js';
import { normalizeSeedanceSubmit, normalizeSeedanceTask, taskError } from '../adapter.js';
import {
  CREATED_AT,
  OFFICIAL_401,
  OFFICIAL_CREATE,
  OFFICIAL_VIDEO_URL,
  QUOTA_429,
  TASK_FAILED_SENSITIVE,
  TASK_FAILED_TYPE,
  TASK_NOT_FOUND,
  TASK_SUCCEEDED_25,
  TASK_SUCCEEDED_FRAMES,
  UNSUPPORTED_FLEX_400,
  UPDATED_AT,
  taskInState,
} from '../__fixtures__/responses.js';
import { OFFICIAL_GET_SUCCEEDED_20 } from '../__fixtures__/official.js';
import { ALL, model } from './helpers.js';

const res = (status: number, bodyText: string, headers: Record<string, string> = {}): UpstreamResponse => ({ status, headers, bodyText });
const DAY = 24 * 3600_000;

describe('normalizeSubmit（创建任务）', () => {
  it('官方 {"id":"cgt-..."} → task-created', () => {
    expect(normalizeSeedanceSubmit(res(200, OFFICIAL_CREATE))).toEqual({ kind: 'task-created', taskId: 'cgt-...' });
    expect(normalizeSeedanceSubmit(res(200, '{"id":"cgt-20261008-abc"}'))).toEqual({ kind: 'task-created', taskId: 'cgt-20261008-abc' });
  });

  it('所有模型共用同一个适配器', () => {
    for (const id of ALL) expect(model(id).adapter.normalizeSubmit(res(200, OFFICIAL_CREATE))).toEqual({ kind: 'task-created', taskId: 'cgt-...' });
  });

  it('实测 401 → auth 错误，带 request id', () => {
    const r = normalizeSeedanceSubmit(res(401, OFFICIAL_401, { 'x-request-id': 'req-1' }));
    expect(r).toMatchObject({ kind: 'error', error: { providerId: 'byteplus', category: 'auth', code: 'AuthenticationError', httpStatus: 401, requestId: 'req-1', retryable: false } });
  });

  it('429 QuotaExceeded → quota，不自动重试', () => {
    expect(normalizeSeedanceSubmit(res(429, QUOTA_429))).toMatchObject({ kind: 'error', error: { category: 'quota', code: 'QuotaExceeded', retryable: false, requestId: '0217abc123def4567' } });
  });

  it('400 UnsupportedParameter → invalid_param', () => {
    expect(normalizeSeedanceSubmit(res(400, UNSUPPORTED_FLEX_400))).toMatchObject({ kind: 'error', error: { category: 'invalid_param', code: 'InvalidParameter.UnsupportedParameter' } });
  });

  it('200 但没有 id / 不是 JSON → BAD_RESPONSE', () => {
    expect(normalizeSeedanceSubmit(res(200, '{}'))).toMatchObject({ kind: 'error', error: { code: 'BAD_RESPONSE', category: 'unknown' } });
    expect(normalizeSeedanceSubmit(res(200, 'oops'))).toMatchObject({ kind: 'error', error: { code: 'BAD_RESPONSE' } });
  });
});

describe('normalizeTask（查询任务）', () => {
  it('官方 GET 成功示例（2.0）：视频、usage、实际参数（含 seed 与 draft:false）', () => {
    const created = 1743414619 * 1000;
    expect(normalizeSeedanceTask(res(200, OFFICIAL_GET_SUCCEEDED_20))).toEqual({
      taskId: 'cgt-2025******-****',
      status: 'succeeded',
      rawStatus: 'succeeded',
      createdAt: created,
      updatedAt: 1743414673 * 1000,
      assets: [{ index: 0, role: 'video', kind: 'video', source: { type: 'url', url: OFFICIAL_VIDEO_URL, expiresAt: created + DAY }, mime: 'video/mp4' }],
      usage: { completion_tokens: 108900, total_tokens: 108900 },
      actual: {
        model: 'dreamina-seedance-2-0-260128',
        resolution: '720p',
        ratio: '16:9',
        duration: 5,
        framespersecond: 24,
        seed: 10,
        generate_audio: true,
        draft: false,
        service_tier: 'default',
        priority: 0,
        execution_expires_after: 172800,
      },
    });
  });

  it('2.5 成功：视频（mov）+ 尾帧，过期时间按较早的 created_at + 24h 保守估计，实际参数原样', () => {
    const snap = normalizeSeedanceTask(res(200, TASK_SUCCEEDED_25));
    const expiresAt = CREATED_AT * 1000 + DAY;
    expect(snap).toEqual({
      taskId: 'cgt-20261008-abc',
      status: 'succeeded',
      rawStatus: 'succeeded',
      createdAt: CREATED_AT * 1000,
      updatedAt: UPDATED_AT * 1000,
      assets: [
        { index: 0, role: 'video', kind: 'video', source: { type: 'url', url: OFFICIAL_VIDEO_URL, expiresAt }, mime: 'video/quicktime' },
        { index: 1, role: 'last_frame', kind: 'image', source: { type: 'url', url: 'https://example.invalid/last.jpeg', expiresAt }, mime: 'image/jpeg' },
      ],
      usage: { completion_tokens: 108900, total_tokens: 108900 },
      actual: {
        model: 'dreamina-seedance-2-5-260628',
        resolution: '720p',
        ratio: '5:4',
        duration: 5,
        framespersecond: 24,
        seed: 12345,
        generate_audio: true,
        output_format: 'mov',
        draft: false,
        service_tier: 'default',
        priority: 0,
        execution_expires_after: 172800,
      },
    });
  });

  it('1.0 按帧数：只返回 frames，输出 mp4，无尾帧', () => {
    const snap = normalizeSeedanceTask(res(200, TASK_SUCCEEDED_FRAMES));
    expect(snap.status).toBe('succeeded');
    expect(snap.assets).toEqual([{ index: 0, role: 'video', kind: 'video', source: { type: 'url', url: 'https://example.invalid/v.mp4', expiresAt: CREATED_AT * 1000 + DAY }, mime: 'video/mp4' }]);
    expect(snap.actual).toMatchObject({ frames: 121, framespersecond: 24, service_tier: 'flex' });
    expect(snap.actual).not.toHaveProperty('duration');
  });

  it('过期起算点取 created_at / updated_at 中较早且存在的一个；已是毫秒的时间戳不再换算', () => {
    const noUpdated = JSON.stringify({ id: 't', status: 'succeeded', content: { video_url: 'https://v' }, created_at: CREATED_AT });
    expect(normalizeSeedanceTask(res(200, noUpdated)).assets[0]!.source).toEqual({ type: 'url', url: 'https://v', expiresAt: CREATED_AT * 1000 + DAY });
    const noCreated = JSON.stringify({ id: 't', status: 'succeeded', content: { video_url: 'https://v' }, updated_at: UPDATED_AT });
    expect(normalizeSeedanceTask(res(200, noCreated)).assets[0]!.source).toEqual({ type: 'url', url: 'https://v', expiresAt: UPDATED_AT * 1000 + DAY });
    const swapped = JSON.stringify({ id: 't', status: 'succeeded', content: { video_url: 'https://v' }, created_at: UPDATED_AT, updated_at: CREATED_AT });
    expect(normalizeSeedanceTask(res(200, swapped)).assets[0]!.source).toEqual({ type: 'url', url: 'https://v', expiresAt: CREATED_AT * 1000 + DAY });
    const ms = JSON.stringify({ id: 't', status: 'queued', created_at: CREATED_AT * 1000 });
    expect(normalizeSeedanceTask(res(200, ms)).createdAt).toBe(CREATED_AT * 1000);
    const noTime = JSON.stringify({ id: 't', status: 'succeeded', content: { video_url: 'https://v' } });
    expect(normalizeSeedanceTask(res(200, noTime)).assets[0]!.source).toEqual({ type: 'url', url: 'https://v' });
  });

  it.each([
    ['queued', 'queued'],
    ['running', 'running'],
    ['cancelled', 'cancelled'],
    ['expired', 'expired'],
  ] as const)('状态 %s → %s，无结果', (raw, status) => {
    const snap = normalizeSeedanceTask(res(200, taskInState(raw)));
    expect(snap).toMatchObject({ taskId: 'cgt-20261008-q', status, rawStatus: raw, assets: [] });
    expect(snap.error).toBeUndefined();
  });

  it.each(['paused', 'SUCCEEDED', 'constructor', ''])('未知状态 %j → unknown，保留原始值', (raw) => {
    expect(normalizeSeedanceTask(res(200, taskInState(raw)))).toMatchObject({ status: 'unknown', rawStatus: raw });
  });

  it('失败：TaskTypeConstraint → task_type，提取 request id，不带推断的 HTTP 状态', () => {
    const snap = normalizeSeedanceTask(res(200, TASK_FAILED_TYPE));
    expect(snap).toMatchObject({ status: 'failed', assets: [], error: { providerId: 'byteplus', category: 'task_type', code: 'InvalidParameter.TaskTypeConstraint', requestId: '0217abc123def4567' } });
    expect(snap.error).not.toHaveProperty('httpStatus');
    expect(snap.error?.hint).toBeDefined();
  });

  it('失败：输出审核拦截 → content_policy', () => {
    expect(normalizeSeedanceTask(res(200, TASK_FAILED_SENSITIVE)).error).toMatchObject({ category: 'content_policy', code: 'OutputVideoSensitiveContentDetected' });
  });

  it('失败但没有 error → TASK_FAILED；成功但没有视频 → failed + EMPTY_RESULT', () => {
    expect(normalizeSeedanceTask(res(200, taskInState('failed'))).error).toMatchObject({ code: 'TASK_FAILED', category: 'unknown' });
    const empty = normalizeSeedanceTask(res(200, JSON.stringify({ id: 't', status: 'succeeded', content: {} })));
    expect(empty).toMatchObject({ status: 'failed', rawStatus: 'succeeded', error: { code: 'EMPTY_RESULT' } });
  });

  it('HTTP 404 / 非 JSON → unknown 并带错误', () => {
    expect(normalizeSeedanceTask(res(404, TASK_NOT_FOUND))).toMatchObject({ status: 'unknown', assets: [], error: { category: 'not_found', code: 'NotFound.TaskId' } });
    expect(normalizeSeedanceTask(res(200, '<html>'))).toMatchObject({ status: 'unknown', error: { code: 'BAD_RESPONSE' } });
  });

  it('taskError：错误码归类（推断 HTTP 列，只用于归类）', () => {
    expect(taskError({ code: 'InternalServiceError', message: 'x' })).toMatchObject({ category: 'upstream_5xx', retryable: true });
    expect(taskError({ code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'x' })).toMatchObject({ category: 'content_policy' });
    expect(taskError({ code: 'InvalidParameter.TaskTypeMismatch', message: 'x' })).toMatchObject({ category: 'task_type' });
    expect(taskError({ code: 'SomethingNew', message: 'x' })).toMatchObject({ category: 'unknown', code: 'SomethingNew' });
    expect(taskError({})).toMatchObject({ code: 'TASK_FAILED', message: 'TASK_FAILED' });
  });
});
