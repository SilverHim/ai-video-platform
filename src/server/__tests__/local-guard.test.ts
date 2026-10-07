import { afterEach, describe, expect, it } from 'vitest';
import { BASE, makeApp, PORT, WEB_HEADERS } from './helpers.js';

let cleanup = () => {};
afterEach(() => cleanup());

function setup(opts = {}) {
  const made = makeApp(opts);
  cleanup = made.cleanup;
  return made.app;
}

describe('本机守卫 local-guard', () => {
  it('合法请求可以访问 /api/health', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: WEB_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 'test' });
  });

  it('错误的 Host（DNS 重绑定）返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, host: `evil.example.com:${PORT}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_host' } });
  });

  it('localhost 作为 Host 也允许', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, host: `localhost:${PORT}` } });
    expect(res.status).toBe(200);
  });

  it('跨源 Origin 返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, origin: 'https://evil.example.com' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_origin' } });
  });

  it('Origin: null（file:// 页面）返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, origin: 'null' } });
    expect(res.status).toBe(403);
  });

  it('同源 Origin 允许', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, origin: BASE } });
    expect(res.status).toBe(200);
  });

  it('缺少 X-Ark-Client 返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { host: `127.0.0.1:${PORT}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'missing_client_header' } });
  });

  it('Sec-Fetch-Site: cross-site 返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(403);
  });

  it('开发模式允许 Vite 端口的 Host 与 Origin，非开发模式不允许', async () => {
    const devHeaders = { ...WEB_HEADERS, host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' };
    expect((await setup({ dev: true }).request(`${BASE}/api/health`, { headers: devHeaders })).status).toBe(200);
    cleanup();
    expect((await setup({ dev: false }).request(`${BASE}/api/health`, { headers: devHeaders })).status).toBe(403);
  });

  it('未知 /api 路径返回 JSON 404', async () => {
    const res = await setup().request(`${BASE}/api/nope`, { headers: WEB_HEADERS });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('响应带安全头', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: WEB_HEADERS });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });
});
