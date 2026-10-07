import type { ProviderDef } from '../../catalog/types.js';
import { T } from '../../catalog/helpers.js';
import { normalizeBytePlusError } from './errors.js';
import { SEEDREAM_MODELS } from './seedream/index.js';

export const BYTEPLUS_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

export const byteplus: ProviderDef = {
  id: 'byteplus',
  label: T('BytePlus ModelArk', 'BytePlus ModelArk'),
  baseUrls: [
    { id: 'ap-southeast-1', label: T('亚太（柔佛）', 'Asia Pacific (Johor)'), url: BYTEPLUS_BASE_URL, default: true },
    {
      id: 'eu-west-1',
      label: T('欧洲（都柏林）', 'Europe (Dublin)'),
      url: 'https://ark.eu-west.bytepluses.com/api/v3',
      note: T('文档未确认 EU 区提供 Seedream/Seedance；Key 与模型开通按区域隔离', 'Docs do not confirm Seedream/Seedance in EU; keys and activation are per region'),
    },
  ],
  auth: { scheme: 'bearer', keyHelpUrl: 'https://ai.byteplus.com/ark/region:ap-southeast-1/docs/api-key' },
  endpoints: {
    'image.generate': { id: 'image.generate', method: 'POST', path: '/images/generations', timeoutMs: 15 * 60_000, retry: 'none' },
    'image.stream': { id: 'image.stream', method: 'POST', path: '/images/generations', timeoutMs: 180_000, retry: 'none', stream: true },
    'video.create': { id: 'video.create', method: 'POST', path: '/contents/generations/tasks', timeoutMs: 60_000, retry: 'none' },
    'video.get': { id: 'video.get', method: 'GET', path: '/contents/generations/tasks/{id}', timeoutMs: 20_000, retry: 'idempotent', rps: 10 },
    'video.list': { id: 'video.list', method: 'GET', path: '/contents/generations/tasks', timeoutMs: 20_000, retry: 'idempotent', rps: 1 },
    'video.delete': { id: 'video.delete', method: 'DELETE', path: '/contents/generations/tasks/{id}', timeoutMs: 20_000, retry: 'none', rps: 10 },
  },
  keyTest: { endpointId: 'video.list', query: { page_num: '1', page_size: '1' } },
  limits: { maxRequestBytes: 64_000_000 },
  models: [...SEEDREAM_MODELS],
  normalizeError: normalizeBytePlusError,
};
