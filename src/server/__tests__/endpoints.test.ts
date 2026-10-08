import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EndpointCreatePlan, EndpointInfo } from '../../shared/api-contract.js';
import { listModels } from '../../shared/providers/registry.js';
import { createBody, endpointOf, EndpointInputError, matchModel, splitApiModel, updateBody } from '../controlplane/ark-control.js';
import { MOCK_SCHEDULING_MS, mockControlFetch, resetMockControl } from '../controlplane/mock.js';
import type { FetchLike } from '../upstream/http.js';
import { canonicalQuery, signRequest, xDate } from '../controlplane/sign.js';
import { Keystore } from '../keystore.js';
import { BASE, json, makeApp, tempDir, WEB_HEADERS } from './helpers.js';

/** 读响应并按测试里期望的结构使用 */
const read = async <T,>(r: Response): Promise<T> => (await r.json()) as T;

const SK = 'TestSecretKey/With+Chars==';

describe('BytePlus OpenAPI 签名', () => {
  it('与独立实现（Python hmac / hashlib）算出的签名一致', () => {
    const h = signRequest({
      method: 'POST',
      host: 'ark.ap-southeast-1.byteplusapi.com',
      path: '/',
      query: { Version: '2024-01-01', Action: 'ListEndpoints' },
      body: '{"PageNumber":1,"PageSize":1}',
      accessKeyId: 'AKLTtestaccesskey',
      secretAccessKey: SK,
      region: 'ap-southeast-1',
      service: 'ark',
      now: new Date('2024-05-14T13:27:43.000Z'),
    });
    expect(h['X-Date']).toBe('20240514T132743Z');
    expect(h['X-Content-Sha256']).toBe('33631505cff747187aa3c449298d5acc16fd9c620f0f5ab5bc186b25e8ecc335');
    expect(h.Authorization).toBe(
      'HMAC-SHA256 Credential=AKLTtestaccesskey/20240514/ap-southeast-1/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=e11e949fa27b788d81eb2e02bd6ba10cc3793e29ebfa38185825f5f3dc643b0e',
    );
    expect(h).not.toHaveProperty('Host');
  });

  it('查询串按 RFC 3986 编码并按键排序', () => {
    expect(canonicalQuery({ b: 'x y', a: "it's*" })).toBe('a=it%27s%2A&b=x%20y');
    expect(xDate(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});

describe('控制面 AK/SK 存储', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('只返回打码的 AccessKey ID，清除后不影响 API Key', () => {
    const file = `${tmp.dir}/keys.json`;
    const ks = new Keystore(file, {});
    ks.set('byteplus', 'ark-api-key-1234567890');
    const st = ks.setControl(' AKLTabcdefghijklmnop ', SK);
    expect(st).toEqual({ configured: true, source: 'file', maskedAccessKeyId: 'AKLT…mnop', updatedAt: expect.any(Number) });
    expect(JSON.stringify(st)).not.toContain(SK);
    expect(ks.getControl()).toEqual({ accessKeyId: 'AKLTabcdefghijklmnop', secretAccessKey: SK });
    expect(ks.clearControl().configured).toBe(false);
    expect(ks.get('byteplus')).toBe('ark-api-key-1234567890');
    expect(readFileSync(file, 'utf8')).not.toContain(SK);
    expect(() => ks.setControl('AK with space', SK)).toThrow();
    expect(() => ks.setControl('AKLT1', '')).toThrow();
  });

  it('环境变量两项都设置时优先', () => {
    const ks = new Keystore(`${tmp.dir}/keys.json`, { BYTEPLUS_ACCESS_KEY_ID: 'AKLTenvenvenvenv1234', BYTEPLUS_SECRET_ACCESS_KEY: 'env-secret' });
    expect(ks.controlStatus()).toMatchObject({ configured: true, source: 'env' });
    expect(ks.getControl()?.secretAccessKey).toBe('env-secret');
    expect(new Keystore(`${tmp.dir}/k2.json`, { BYTEPLUS_ACCESS_KEY_ID: 'only-id' }).controlStatus().configured).toBe(false);
  });
});

describe('请求体与模型匹配', () => {
  const byteplus = listModels({ includeHidden: true }).filter((x) => x.provider.id === 'byteplus').map((x) => x.model);

  it('每个 BytePlus 模型都能拆出基础模型名和版本，并能反查回来', () => {
    for (const m of byteplus) {
      const fm = splitApiModel(m.apiModel);
      expect(fm, m.apiModel).not.toBeNull();
      expect(matchModel(byteplus, fm)).toBe(m.id);
    }
    expect(matchModel(byteplus, { name: 'seedream-5-0', version: '260128' })).toBe('byteplus/seedream-5-0-lite');
    expect(matchModel(byteplus, { name: 'unknown', version: '000000' })).toBeNull();
  });

  it('关闭内容过滤才写 Moderation=Skip；只允许 BytePlus 模型', () => {
    const flash = byteplus.find((m) => m.id === 'byteplus/seedream-5-0-flash')!;
    expect(createBody({ modelId: flash.id, name: ' nofilter ', contentFilter: false }, flash, false)).toEqual({
      Name: 'nofilter',
      ModelReference: { FoundationModel: { Name: 'dola-seedream-5-0-flash', ModelVersion: '260915' } },
      Moderation: { Strategy: 'Skip' },
    });
    expect(createBody({ modelId: flash.id, name: 'x', contentFilter: true, rateLimit: { rpm: 10, tpm: 100 } }, flash, true)).toEqual({
      Name: 'x',
      ModelReference: { FoundationModel: { Name: 'dola-seedream-5-0-flash', ModelVersion: '260915' } },
      RateLimit: { Rpm: 10, Tpm: 100 },
      DryRun: true,
    });
    expect(() => createBody({ modelId: 'minimax/h3', name: 'x', contentFilter: true }, listModels({ includeHidden: true }).find((x) => x.model.id === 'minimax/h3')!.model, false)).toThrow(EndpointInputError);
    expect(() => createBody({ modelId: flash.id, name: ' ', contentFilter: true }, flash, false)).toThrow('名称不能为空');
    expect(() => createBody({ modelId: flash.id, name: 'x', contentFilter: true, rateLimit: { rpm: 0, tpm: 1 } }, flash, false)).toThrow('限流');
  });

  it('更新：文档字段 + 按实测的内容过滤；详情结构平铺或包一层都能读', () => {
    expect(updateBody('ep-123456', { name: 'n', rateLimit: { rpm: 1, tpm: 2 } })).toEqual({ Id: 'ep-123456', Name: 'n', RateLimit: { Rpm: 1, Tpm: 2 } });
    expect(updateBody('ep-123456', { contentFilter: false })).toEqual({ Id: 'ep-123456', Moderation: { Strategy: 'Skip' } });
    expect(updateBody('ep-123456', { contentFilter: true })).toEqual({ Id: 'ep-123456', Moderation: { Strategy: 'Default' } });
    expect(endpointOf({ Id: 'ep-1', Status: 'Running' })).toEqual({ Id: 'ep-1', Status: 'Running' });
    expect(endpointOf({ Endpoint: { Id: 'ep-2' } })).toEqual({ Id: 'ep-2' });
    expect(() => updateBody('ep-123456', {})).toThrow('没有要修改的内容');
  });
});

describe('Endpoint 管理路由（mock 控制面）', () => {
  let t: ReturnType<typeof makeApp>;
  const H = { ...WEB_HEADERS, 'content-type': 'application/json' };
  const req = (path: string, init: RequestInit = {}) => t.app.request(`${BASE}/api${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> | undefined) } });
  const setCreds = (ak = 'AKLTmockmockmockmock') => req('/control/credentials', { method: 'PUT', body: JSON.stringify({ accessKeyId: ak, secretAccessKey: SK }) });
  const list = async (q = '') => (await read<{ items: EndpointInfo[] }>(await req(`/endpoints?refresh=1${q}`))).items;

  beforeEach(() => {
    resetMockControl();
    t = makeApp();
  });
  afterEach(() => t.cleanup());

  it('没配 AK/SK 时提示去设置；凭据接口从不返回 Secret', async () => {
    expect((await req('/endpoints')).status).toBe(409);
    const res = await setCreds();
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SK);
    expect(JSON.parse(text).credentials).toMatchObject({ configured: true, maskedAccessKeyId: 'AKLT…mock' });
    expect(await json(await req('/control/credentials/test', { method: 'POST' }))).toEqual({ ok: true, total: 0 });
  });

  it('AK 无效时返回上游错误码', async () => {
    await setCreds('invalid');
    const res = await req('/control/credentials/test', { method: 'POST' });
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ error: { code: 'InvalidAccessKey', upstreamStatus: 401 } });
  });

  it('预检不创建；新建后回读到过滤已关，按模型筛选列表', async () => {
    await setCreds();
    const plan = await read<EndpointCreatePlan>(await req('/endpoints/plan', { method: 'POST', body: JSON.stringify({ modelId: 'byteplus/seedream-5-0-flash', name: 'flash-nofilter', contentFilter: false }) }));
    expect(plan.dryRun).toEqual({ ok: true });
    expect(plan.request).toMatchObject({ Name: 'flash-nofilter', Moderation: { Strategy: 'Skip' } });
    expect(plan.request).not.toHaveProperty('DryRun');
    expect(plan.notes.map((n) => n.zh).join()).toContain('Skip');
    expect(await list()).toEqual([]);

    const created = await read<{ id: string; endpoint: EndpointInfo; warnings: unknown[] }>(
      await req('/endpoints', { method: 'POST', body: JSON.stringify({ modelId: 'byteplus/seedream-5-0-flash', name: 'flash-nofilter', contentFilter: false }) }),
    );
    expect(created.warnings).toEqual([]);
    expect(created.endpoint).toMatchObject({ id: created.id, modelId: 'byteplus/seedream-5-0-flash', contentFilter: 'off', moderationStrategy: 'Skip', status: 'Scheduling' });
    await json(await req('/endpoints', { method: 'POST', body: JSON.stringify({ modelId: 'byteplus/seedream-5-0-pro', name: 'pro-default', contentFilter: true }) }));

    expect((await list('&modelId=byteplus/seedream-5-0-flash')).map((e) => e.name)).toEqual(['flash-nofilter']);
    expect((await list('&modelId=byteplus/seedream-5-0-pro'))[0]).toMatchObject({ name: 'pro-default', contentFilter: 'on' });
    expect(await list('&modelId=byteplus/seedream-4-0')).toEqual([]);
  });

  it('非 BytePlus 模型、名称为空时拒绝', async () => {
    await setCreds();
    expect((await req('/endpoints/plan', { method: 'POST', body: JSON.stringify({ modelId: 'minimax/h3', name: 'x', contentFilter: true }) })).status).toBe(400);
    expect((await req('/endpoints', { method: 'POST', body: JSON.stringify({ modelId: 'byteplus/seedream-5-0-flash', name: '', contentFilter: true }) })).status).toBe(400);
  });

  it('修改、停止 / 启动、删除需要确认头', async () => {
    await setCreds();
    const { id } = await read<{ id: string }>(await req('/endpoints', { method: 'POST', body: JSON.stringify({ modelId: 'byteplus/seedance-2-5', name: 'v25', contentFilter: true }) }));
    expect((await req(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'v25-renamed', rateLimit: { rpm: 30, tpm: 1000 } }) })).status).toBe(200);
    expect((await list())[0]).toMatchObject({ name: 'v25-renamed', rateLimit: { rpm: 30, tpm: 1000 } });
    expect((await req(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(400);

    await req(`/endpoints/${id}/stop`, { method: 'POST' });
    expect((await list())[0]!.status).toBe('Stopped');
    await req(`/endpoints/${id}/start`, { method: 'POST' });
    expect((await list())[0]!.status).toBe('Scheduling');
    await new Promise((r) => setTimeout(r, MOCK_SCHEDULING_MS + 50));
    expect((await list())[0]!.status).toBe('Running');

    // 已有 Endpoint 的内容过滤可以改（Moderation.Strategy Default / Skip，按实测），改完回读
    const off = await read<{ ok: true; warnings: unknown[] }>(await req(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify({ contentFilter: false }) }));
    expect(off.warnings).toEqual([]);
    expect((await list())[0]).toMatchObject({ contentFilter: 'off', moderationStrategy: 'Skip' });
    await req(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify({ contentFilter: true }) });
    expect((await list())[0]).toMatchObject({ contentFilter: 'on', moderationStrategy: 'Default' });
    expect((await req(`/endpoints/${id}`, { method: 'PATCH', body: JSON.stringify({ contentFilter: 'off' }) })).status).toBe(400);

    expect((await req(`/endpoints/${id}`, { method: 'DELETE' })).status).toBe(428);
    expect((await req(`/endpoints/${id}`, { method: 'DELETE', headers: { 'x-confirm-delete': 'ep-other' } })).status).toBe(428);
    // 运行中也能删：服务端先停止、等到 Stopped 再删（实测运行中直接删会被拒）
    expect((await list())[0]!.status).toBe('Running');
    expect((await req(`/endpoints/${id}`, { method: 'DELETE', headers: { 'x-confirm-delete': id } })).status).toBe(200);
    expect(await list()).toEqual([]);
    expect((await req('/endpoints/not-an-id/stop', { method: 'POST' })).status).toBe(400);
  });
});

describe('Endpoint 列表缓存', () => {
  let t: ReturnType<typeof makeApp>;
  const calls: string[] = [];
  let delayList = 0;
  // 包一层 mock：记录 ListEndpoints 次数，可让它延迟返回
  const spyFetch: FetchLike = async (url, init) => {
    const action = new URL(url).searchParams.get('Action') ?? '';
    if (action === 'ListEndpoints') {
      calls.push(String(init.headers.Authorization).match(/Credential=([^/]+)/)?.[1] ?? '');
      if (delayList) await new Promise((r) => setTimeout(r, delayList));
    }
    return mockControlFetch(url, init);
  };
  const H = { ...WEB_HEADERS, 'content-type': 'application/json' };
  const req = (path: string, init: RequestInit = {}) => t.app.request(`${BASE}/api${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> | undefined) } });
  const setCreds = (ak: string) => req('/control/credentials', { method: 'PUT', body: JSON.stringify({ accessKeyId: ak, secretAccessKey: SK }) });

  beforeEach(() => {
    resetMockControl();
    calls.length = 0;
    delayList = 0;
    t = makeApp({ controlFetch: spyFetch });
  });
  afterEach(() => t.cleanup());

  it('缓存按凭据区分：换了 AK/SK 不会读到旧账号的缓存', async () => {
    await setCreds('AKLTaccountAAAAAAAAA');
    await req('/endpoints');
    await req('/endpoints');
    expect(calls).toEqual(['AKLTaccountAAAAAAAAA']);
    await setCreds('AKLTaccountBBBBBBBBB');
    await req('/endpoints');
    expect(calls).toEqual(['AKLTaccountAAAAAAAAA', 'AKLTaccountBBBBBBBBB']);
  });

  it('换凭据时还在进行的旧请求返回后不写缓存', async () => {
    await setCreds('AKLTaccountAAAAAAAAA');
    delayList = 150;
    const inflight = req('/endpoints');
    await new Promise((r) => setTimeout(r, 30));
    await setCreds('AKLTaccountAAAAAAAAA');
    await inflight;
    delayList = 0;
    await req('/endpoints');
    // 第二次没有命中旧请求写回的缓存，重新调用了上游
    expect(calls).toHaveLength(2);
  });
});
