import { createHash } from 'node:crypto';
import type { EndpointInfo } from '../../shared/api-contract.js';
import type { ModelDef } from '../../shared/catalog/types.js';
import { listModels } from '../../shared/providers/registry.js';
import type { Keystore } from '../keystore.js';
import { endpointOf, toEndpointInfo, type ArkControlClient, type ControlCredentials } from './ark-control.js';

const LIST_PAGE_SIZE = 100;
const LIST_MAX_PAGES = 10;
const CACHE_MS = 15_000;
/** 列表接口文档里没有 Moderation；缺失时逐个 GetEndpoint 补齐，最多这么多个（实测列表本身会带） */
const DETAIL_FILL_LIMIT = 30;

type Json = Record<string, unknown>;

export class ControlNotConfiguredError extends Error {
  constructor() {
    super('还没有配置 AK/SK：请在「设置 → Endpoint」里填写');
  }
}

/**
 * 账号下的推理接入点列表（网页与 MCP 共用）。
 * 缓存按凭据指纹区分；generation 在凭据变化 / 写操作时递增，进行中的旧请求返回后不再写缓存。
 */
export class EndpointDirectory {
  private cache: { at: number; key: string; items: EndpointInfo[] } | null = null;
  private generation = 0;

  constructor(
    private readonly control: ArkControlClient,
    private readonly keystore: Keystore,
  ) {}

  invalidate(): void {
    this.cache = null;
    this.generation++;
  }

  credentials(): ControlCredentials {
    const cr = this.keystore.getControl();
    if (!cr) throw new ControlNotConfiguredError();
    return cr;
  }

  /** 全部 Endpoint；refresh 绕过缓存 */
  async list(opts: { refresh?: boolean } = {}): Promise<EndpointInfo[]> {
    const cr = this.credentials();
    const key = credKey(cr);
    if (this.cache && this.cache.key === key && !opts.refresh && Date.now() - this.cache.at <= CACHE_MS) return this.cache.items;
    const gen = this.generation;
    const at = Date.now();
    const items = await this.fetchAll(cr);
    if (gen === this.generation) this.cache = { at, key, items };
    return items;
  }

  private async fetchAll(cr: ControlCredentials): Promise<EndpointInfo[]> {
    const models = byteplusModels();
    const raws: Json[] = [];
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const res = await this.control.call(cr, 'ListEndpoints', { PageNumber: page, PageSize: LIST_PAGE_SIZE, SortBy: 'CreateTime', SortOrder: 'Desc' });
      const items = Array.isArray(res.Items) ? (res.Items as Json[]) : [];
      raws.push(...items);
      const total = typeof res.TotalCount === 'number' ? res.TotalCount : raws.length;
      if (items.length < LIST_PAGE_SIZE || raws.length >= total) break;
    }
    const infos = raws.map((r) => toEndpointInfo(r, models));
    const missing = infos.filter((e) => e.contentFilter === 'unknown').slice(0, DETAIL_FILL_LIMIT);
    await Promise.all(
      missing.map(async (e) => {
        try {
          const full = toEndpointInfo(endpointOf(await this.control.call(cr, 'GetEndpoint', { Id: e.id })), models);
          Object.assign(e, { contentFilter: full.contentFilter, moderationStrategy: full.moderationStrategy });
        } catch {
          // 补不到就保持 unknown
        }
      }),
    );
    return infos;
  }
}

export const byteplusModels = (): ModelDef[] =>
  listModels({ includeHidden: true })
    .filter((x) => x.provider.id === 'byteplus')
    .map((x) => x.model);

function credKey(cr: ControlCredentials): string {
  return createHash('sha256').update(`${cr.accessKeyId}\0${cr.secretAccessKey}`).digest('hex').slice(0, 16);
}
