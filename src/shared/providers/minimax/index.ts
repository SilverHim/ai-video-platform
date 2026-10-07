import type { ProviderDef } from '../../catalog/types.js';
import { T } from '../../catalog/helpers.js';
import { normalizeMiniMaxError } from './errors.js';
import { IMAGE01_MODELS } from './image01/index.js';
import { H3_MODELS } from './h3/index.js';

export const MINIMAX_BASE_URL = 'https://api.minimax.io';

export const minimax: ProviderDef = {
  id: 'minimax',
  label: T('MiniMax 国际站', 'MiniMax (global)'),
  baseUrls: [{ id: 'global', label: T('国际站', 'Global'), url: MINIMAX_BASE_URL, default: true }],
  auth: {
    scheme: 'bearer',
    keyHelpUrl: 'https://platform.minimax.io/docs/guides/quickstart-preparation',
    keyHints: [
      { prefix: 'sk-cp-', level: 'warn', message: T('这是订阅（M Plan）Key：与按量付费 Key 不可互换，H3 视频官方要求按量付费 Key', 'This is a subscription (M Plan) key; H3 video officially requires a pay-as-you-go key') },
    ],
  },
  endpoints: {
    'image.generate': { id: 'image.generate', method: 'POST', path: '/v1/image_generation', timeoutMs: 5 * 60_000, retry: 'none' },
    'video.create': { id: 'video.create', method: 'POST', path: '/v2/video_generation', timeoutMs: 60_000, retry: 'none' },
    'video.get': { id: 'video.get', method: 'GET', path: '/v2/query/video_generation/{id}', timeoutMs: 20_000, retry: 'idempotent', rps: 5 },
    'video.list': { id: 'video.list', method: 'GET', path: '/v2/query/video_generation', timeoutMs: 20_000, retry: 'idempotent', rps: 1 },
    'video.delete': { id: 'video.delete', method: 'DELETE', path: '/v2/video_generation/{id}', timeoutMs: 20_000, retry: 'none', rps: 5 },
    'file.upload': { id: 'file.upload', method: 'POST', path: '/v1/files/upload', timeoutMs: 10 * 60_000, retry: 'none' },
  },
  keyTest: { endpointId: 'video.list', query: { page_num: '1', page_size: '1' } },
  limits: { maxRequestBytes: 64_000_000 },
  // 官方建议每 10 秒查询一次；只能查最近 7 天
  polling: {
    firstDelayMs: 10_000,
    schedule: [{ untilAgeMs: 10 * 60_000, intervalMs: 10_000 }],
    defaultIntervalMs: 15_000,
    queryWindowMs: 7 * 24 * 3600_000,
  },
  models: [...IMAGE01_MODELS, ...H3_MODELS],
  normalizeError: normalizeMiniMaxError,
};
