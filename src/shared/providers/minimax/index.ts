import type { ProviderDef } from '../../catalog/types.js';
import { T } from '../../catalog/helpers.js';
import { normalizeMiniMaxError } from './errors.js';
import { IMAGE01_MODELS } from './image01/index.js';
import { H3_MODELS } from './h3/index.js';

export const MINIMAX_BASE_URL = 'https://api.minimax.io';
/** 订阅额度查询接口在 www 域名下（M Plan / Token Plan FAQ 的示例） */
export const MINIMAX_WWW_URL = 'https://www.minimax.io';

export const minimax: ProviderDef = {
  id: 'minimax',
  label: T('MiniMax 国际站', 'MiniMax (global)'),
  baseUrls: [
    { id: 'global', label: T('国际站', 'Global'), url: MINIMAX_BASE_URL, default: true },
    { id: 'www', label: T('国际站（订阅额度查询）', 'Global (plan quota)'), url: MINIMAX_WWW_URL },
  ],
  auth: {
    scheme: 'bearer',
    keyHelpUrl: 'https://platform.minimax.io/docs/guides/quickstart-preparation',
    keyHints: [
      // 官方：两种 Key 不可互换；M Plan Explore / Build 含 H3，旧 Token Plan 不含（docs/research/minimax/subscription-key.md）
      { prefix: 'sk-cp-', level: 'warn', message: T('这是订阅 Key（M Plan / Token Plan）：请填到「订阅 Key」一栏', 'This is a subscription key (M Plan / Token Plan); put it in the subscription key slot') },
    ],
  },
  endpoints: {
    // 官方限流 image-01 10 RPM：令牌桶 10 次突发、每 6 秒补 1 次
    'image.generate': { id: 'image.generate', method: 'POST', path: '/v1/image_generation', timeoutMs: 5 * 60_000, retry: 'none', rps: 10 / 60, burst: 10 },
    'video.create': { id: 'video.create', method: 'POST', path: '/v2/video_generation', timeoutMs: 60_000, retry: 'none' },
    'video.get': { id: 'video.get', method: 'GET', path: '/v2/query/video_generation/{id}', timeoutMs: 20_000, retry: 'idempotent', rps: 5 },
    'video.list': { id: 'video.list', method: 'GET', path: '/v2/query/video_generation', timeoutMs: 20_000, retry: 'idempotent', rps: 1 },
    'video.delete': { id: 'video.delete', method: 'DELETE', path: '/v2/video_generation/{id}', timeoutMs: 20_000, retry: 'none', rps: 5 },
    'file.upload': { id: 'file.upload', method: 'POST', path: '/v1/files/upload', timeoutMs: 10 * 60_000, retry: 'none' },
    // 订阅 Key 的剩余额度（免费只读；返回格式文档未写，按实测解析）
    'plan.remains': { id: 'plan.remains', method: 'GET', path: '/v1/token_plan/remains', timeoutMs: 20_000, retry: 'idempotent', rps: 1 },
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
