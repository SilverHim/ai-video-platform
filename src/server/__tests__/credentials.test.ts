import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FormInput } from '../../shared/catalog/types.js';
import { MockDownloader, mockFetch } from '../mock/upstream.js';
import type { FetchLike } from '../upstream/http.js';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';

const SUB = 'sk-cp-0123456789abcdefSUBSCRIPTION';
const PAYGO = 'sk-api-0123456789abcdefPAYGO';

describe('MiniMax 按量 / 订阅 Key 的选择', () => {
  let t: ReturnType<typeof makeApp>;
  const auths: { path: string; auth: string; host: string }[] = [];
  const spy: FetchLike = async (url, init) => {
    const u = new URL(url);
    auths.push({ path: u.pathname, auth: String(init.headers.Authorization ?? ''), host: u.hostname });
    return mockFetch(url, init);
  };
  const post = (path: string, body: unknown) => t.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = (over: Partial<FormInput> = {}): FormInput => ({ providerId: 'minimax', modelId: 'minimax/image-01', modeId: 't2i', values: {}, slots: {}, prompt: 'a cat', ...over });

  beforeEach(() => {
    auths.length = 0;
    // 关掉 mock 模式（否则没配 Key 时会用假 Key 兜底），上游和下载仍注入 mock，不发真实请求
    t = makeApp({ mock: false, fetchImpl: spy, downloader: new MockDownloader() });
  });
  afterEach(() => t.cleanup());

  it('两种都配了：默认用订阅 Key 并记进任务；指定按量就用按量', async () => {
    t.keystore.set('minimax', PAYGO);
    t.keystore.set('minimax-subscription', SUB);
    const a = await json(await post('/api/tasks', { form: form() }));
    expect(a.task.form.credential).toBe('subscription');
    expect(auths.at(-1)).toMatchObject({ path: '/v1/image_generation', auth: `Bearer ${SUB}` });
    const b = await json(await post('/api/tasks', { form: form({ credential: 'paygo' }) }));
    expect(b.task.form.credential).toBe('paygo');
    expect(auths.at(-1)!.auth).toBe(`Bearer ${PAYGO}`);
  });

  it('指定订阅但没配置时报错，不会悄悄改用按量 Key', async () => {
    t.keystore.set('minimax', PAYGO);
    const res = await post('/api/tasks', { form: form({ credential: 'subscription' }) });
    expect(res.status).toBe(400);
    expect((await json(res)).error.message).toContain('订阅 Key');
    expect(auths.filter((a) => a.path === '/v1/image_generation')).toEqual([]);
  });

  it('预览标出这次用哪种 Key；BytePlus 只有一种时为 null', async () => {
    t.keystore.set('minimax-subscription', SUB);
    const p = await json(await post('/api/preview', { form: form() }));
    expect(p.credential).toEqual({ kind: 'subscription', configured: true });
    expect(p.curl).toContain('MINIMAX_SUBSCRIPTION_KEY');
    const q = await json(await post('/api/preview', { form: form({ credential: 'paygo' }) }));
    expect(q.credential).toEqual({ kind: 'paygo', configured: false });
    const bp = await json(await post('/api/preview', { form: { providerId: 'byteplus', modelId: 'byteplus/seedream-5-0-lite', modeId: 'generate', values: {}, slots: {}, prompt: 'x' } }));
    expect(bp.credential).toBeNull();
  });

  it('测试订阅 Key 走 www.minimax.io 的剩余额度接口；按量 Key 走视频任务列表', async () => {
    t.keystore.set('minimax', PAYGO);
    t.keystore.set('minimax-subscription', SUB);
    expect(await json(await post('/api/keys/minimax-subscription/test', {}))).toMatchObject({ ok: true });
    expect(auths.at(-1)).toEqual({ path: '/v1/token_plan/remains', auth: `Bearer ${SUB}`, host: 'www.minimax.io' });
    expect(await json(await post('/api/keys/minimax/test', {}))).toMatchObject({ ok: true });
    expect(auths.at(-1)).toMatchObject({ path: '/v2/query/video_generation', auth: `Bearer ${PAYGO}`, host: 'api.minimax.io' });
    const quota = await t.app.request(`${BASE}/api/keys/minimax-subscription/quota`, { headers: WEB_HEADERS });
    expect(quota.status).toBe(200);
    expect((await t.app.request(`${BASE}/api/keys/minimax/quota`, { headers: WEB_HEADERS })).status).toBe(400);
  });
});
