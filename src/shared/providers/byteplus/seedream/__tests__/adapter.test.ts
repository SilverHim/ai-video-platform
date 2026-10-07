import { describe, expect, it } from 'vitest';
import { SseParser } from '../../../../sse/parse.js';
import {
  B64,
  GROUP_ALL_FAILED,
  GROUP_PARTIAL,
  OFFICIAL_401,
  OFFICIAL_EVENT_COMPLETED,
  OFFICIAL_EVENT_PARTIAL_FAILED,
  OFFICIAL_GROUP_LITE,
  OFFICIAL_LAYER_PRO,
  OFFICIAL_STREAM_DOC,
  OFFICIAL_STREAM_ERROR,
  OFFICIAL_STREAM_SSE,
  OFFICIAL_SYNC_PRO,
  OFFICIAL_T2I_PRO,
  TOP_LEVEL_ERROR,
} from '../__fixtures__/responses.js';
import { URL_TTL_MS, normalizeSeedreamSubmit, parseSeedreamStreamEvent } from '../adapter.js';
import { V45, model } from './helpers.js';

const res = (status: number, bodyText: string) => ({ status, headers: {}, bodyText });
const CREATED_MS = 1757323224 * 1000;

describe('normalizeSubmit：同步响应', () => {
  it('官方样例：单张成功，尺寸与过期时间', () => {
    expect(normalizeSeedreamSubmit(res(200, OFFICIAL_SYNC_PRO))).toEqual({
      kind: 'sync',
      status: 'succeeded',
      assets: [{ index: 0, role: 'image', kind: 'image', source: { type: 'url', url: 'https://...', expiresAt: CREATED_MS + URL_TTL_MS }, width: 2048, height: 2048 }],
      failures: [],
      usage: { generated_images: 1, output_tokens: 18000, total_tokens: 18000 },
    });
  });

  it('官方样例：pro size=2K 实际返回 1760x2368（尺寸以响应为准）', () => {
    const r = normalizeSeedreamSubmit(res(200, OFFICIAL_T2I_PRO));
    expect(r.kind === 'sync' && r.assets.map((a) => [a.width, a.height])).toEqual([[1760, 2368]]);
  });

  it('官方样例：lite 组图 3 张全部成功，没有 output_format 时不给 MIME', () => {
    const exp = 1757388756 * 1000 + URL_TTL_MS;
    expect(normalizeSeedreamSubmit(res(200, OFFICIAL_GROUP_LITE))).toEqual({
      kind: 'sync',
      status: 'succeeded',
      assets: [0, 1, 2].map((index) => ({ index, role: 'image', kind: 'image', source: { type: 'url', url: 'https://...', expiresAt: exp }, width: 2720, height: 1536 })),
      failures: [],
      usage: { generated_images: 3, output_tokens: 48960, total_tokens: 48960 },
    });
  });

  it('b64_json：带 output_format 时给出 MIME', () => {
    const r = normalizeSeedreamSubmit(res(200, B64));
    expect(r.kind === 'sync' && r.assets[0]).toEqual({ index: 0, role: 'image', kind: 'image', source: { type: 'b64', data: 'iVBORw0KGgo=', mime: 'image/png' }, width: 1024, height: 1024, mime: 'image/png' });
  });

  it('组图部分失败：失败项进 failures，下标保持原位', () => {
    const r = normalizeSeedreamSubmit(res(200, GROUP_PARTIAL));
    if (r.kind !== 'sync') throw new Error('应为 sync');
    expect(r.status).toBe('partial');
    expect(r.assets.map((a) => a.index)).toEqual([0, 2]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ index: 1, error: { providerId: 'byteplus', category: 'content_policy', code: 'OutputImageSensitiveContentDetected', retryable: false } });
    expect(r.failures[0]!.error.httpStatus).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it('组图全部失败：status=failed，error 取第一条失败；内部错误归为 5xx 可重试', () => {
    const r = normalizeSeedreamSubmit(res(200, GROUP_ALL_FAILED));
    if (r.kind !== 'sync') throw new Error('应为 sync');
    expect(r.status).toBe('failed');
    expect(r.error).toMatchObject({ category: 'upstream_5xx', code: 'InternalServiceError', retryable: true });
  });

  it('官方样例：图层分解底图 + 图层，z_index / name / description / bounding_box（normalized 换算成 0–1）', () => {
    const r = normalizeSeedreamSubmit(res(200, OFFICIAL_LAYER_PRO));
    const exp = 1784696685 * 1000 + URL_TTL_MS;
    expect(r).toEqual({
      kind: 'sync',
      status: 'succeeded',
      assets: [
        { index: 0, role: 'base', kind: 'image', source: { type: 'url', url: 'https://...', expiresAt: exp }, width: 2048, height: 2048, mime: 'image/jpeg', layer: { zIndex: 0 } },
        {
          index: 1,
          role: 'layer',
          kind: 'image',
          source: { type: 'url', url: 'https://...', expiresAt: exp },
          width: 1273,
          height: 265,
          mime: 'image/png',
          layer: { zIndex: 1, name: 'Seedream title text', description: 'Large yellow Seedream title text in a serif font', bboxAbs: [383, 120, 1655, 384], bboxNorm: [0.187, 0.059, 0.808, 0.188] },
        },
      ],
      failures: [],
      usage: { input_images: 1, generated_images: 8, output_tokens: 23107, total_tokens: 23107 },
    });
  });

  it('错误：实测 401、HTTP 400 顶层 error、HTTP 200 顶层 error', () => {
    expect(normalizeSeedreamSubmit(res(401, OFFICIAL_401))).toMatchObject({ kind: 'error', error: { category: 'auth', code: 'AuthenticationError', httpStatus: 401 } });
    expect(normalizeSeedreamSubmit(res(400, TOP_LEVEL_ERROR))).toMatchObject({ kind: 'error', error: { category: 'invalid_param', code: 'InvalidParameter', requestId: '0217abc123def4567' } });
    expect(normalizeSeedreamSubmit(res(200, TOP_LEVEL_ERROR))).toMatchObject({ kind: 'error', error: { code: 'InvalidParameter' } });
  });

  it('响应不是 JSON 或没有 data', () => {
    expect(normalizeSeedreamSubmit(res(200, '<html>'))).toMatchObject({ kind: 'error', error: { code: 'BAD_RESPONSE' } });
    expect(normalizeSeedreamSubmit(res(200, '{"data":[]}'))).toMatchObject({ kind: 'sync', status: 'failed', error: { code: 'EMPTY_RESULT' } });
    expect(normalizeSeedreamSubmit(res(200, '{"data":[{"size":"1x1"}]}'))).toMatchObject({ kind: 'sync', status: 'failed', failures: [{ index: 0, error: { code: 'EMPTY_ITEM' } }] });
  });
});

describe('parseStreamEvent：流式事件', () => {
  it('官方样例完整流：按 SSE 规范拼接多行 data，逐条转成 StreamUpdate，过期时间按各事件 created', () => {
    const p = new SseParser();
    const events = [...p.feed(OFFICIAL_STREAM_SSE.slice(0, 77)), ...p.feed(OFFICIAL_STREAM_SSE.slice(77)), ...p.flush()];
    expect(events.map((e) => e.event)).toEqual([...Array(3).fill('image_generation.partial_succeeded'), 'image_generation.completed', null]);
    const ups = events.map((e) => parseSeedreamStreamEvent(e));
    const asset = (index: number, created: number) => ({ type: 'asset', asset: { index, role: 'image', kind: 'image', source: { type: 'url', url: 'https://...', expiresAt: created * 1000 + URL_TTL_MS }, width: 2496, height: 1664 } });
    expect(ups).toEqual([asset(0, 1757396757), asset(1, 1757396785), asset(2, 1757396825), { type: 'completed', usage: { generated_images: 3, output_tokens: 48672, total_tokens: 48672 } }, null]);
  });

  it('未核实：文档展示格式（JSON 续行无 data: 前缀）按规范解析只剩 "{"，适配器忽略而不抛错', () => {
    const p = new SseParser();
    const events = [...p.feed(OFFICIAL_STREAM_DOC), ...p.flush()];
    expect(events.slice(0, 4).map((e) => e.data)).toEqual(['{', '{', '{', '{']);
    expect(events.map((e) => parseSeedreamStreamEvent(e))).toEqual([null, null, null, null, null]);
  });

  it('官方事件样例：partial_failed 记为该下标失败（审核类），completed 透传 usage', () => {
    expect(parseSeedreamStreamEvent({ event: 'image_generation.partial_failed', data: OFFICIAL_EVENT_PARTIAL_FAILED })).toMatchObject({
      type: 'failure',
      failure: { index: 2, error: { providerId: 'byteplus', category: 'content_policy', code: 'OutputImageSensitiveContentDetected', message: 'The request failed because the output image may contain sensitive information.', retryable: false } },
    });
    expect(parseSeedreamStreamEvent({ event: null, data: OFFICIAL_EVENT_COMPLETED })).toEqual({ type: 'completed', usage: { generated_images: 2, output_tokens: 16280, total_tokens: 16280 } });
  });

  it('官方 error 样例：data 里的 error.error（BadRequest 归为参数错误），有无 event 行都能识别；占位 Request ID 不提取', () => {
    for (const event of [null, 'error']) {
      const up = parseSeedreamStreamEvent({ event, data: OFFICIAL_STREAM_ERROR });
      expect(up).toMatchObject({ type: 'error', error: { providerId: 'byteplus', category: 'invalid_param', code: 'BadRequest' } });
      expect(up?.type === 'error' && up.error.requestId).toBeUndefined();
    }
  });

  it('没有 event 行时按 data.type 识别；b64_json 事件', () => {
    const up = parseSeedreamStreamEvent({ event: null, data: JSON.stringify({ type: 'image_generation.partial_succeeded', image_index: 2, b64_json: 'AAAA', size: '2048x2048' }) });
    expect(up).toEqual({ type: 'asset', asset: { index: 2, role: 'image', kind: 'image', source: { type: 'b64', data: 'AAAA' }, width: 2048, height: 2048 } });
  });

  it('忽略：[DONE]、未定义的 partial_image、未知事件、非 JSON', () => {
    expect(parseSeedreamStreamEvent({ event: null, data: '[DONE]' })).toBeNull();
    expect(parseSeedreamStreamEvent({ event: 'image_generation.partial_image', data: '{"partial_image_index":0,"b64_json":"AA"}' })).toBeNull();
    expect(parseSeedreamStreamEvent({ event: 'whatever', data: '{}' })).toBeNull();
    expect(parseSeedreamStreamEvent({ event: null, data: 'not json' })).toBeNull();
  });

  it('partial_succeeded 缺图片数据时记为失败', () => {
    expect(parseSeedreamStreamEvent({ event: 'image_generation.partial_succeeded', data: '{"image_index":3}' })).toMatchObject({ type: 'failure', failure: { index: 3, error: { code: 'EMPTY_ITEM' } } });
  });

  it('流式模型的适配器挂着同一个解析函数', () => {
    expect(model(V45).adapter.parseStreamEvent).toBe(parseSeedreamStreamEvent);
  });
});
