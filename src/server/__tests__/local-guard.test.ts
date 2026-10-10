import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_SECURITY_POLICY } from '../middleware/security-headers.js';
import { makePng } from '../mock/png.js';
import { BASE, makeApp, PORT, WEB_HEADERS, json, tempDir } from './helpers.js';

let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  await cleanup();
});

function setup(opts = {}) {
  const made = makeApp(opts);
  cleanup = made.cleanup;
  return made.app;
}

describe('本机守卫 local-guard', () => {
  it('合法请求可以访问 /api/health', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: WEB_HEADERS });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, version: 'test' });
  });

  it('错误的 Host（DNS 重绑定）返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, host: `evil.example.com:${PORT}` } });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: { code: 'forbidden_host' } });
  });

  it('localhost 作为 Host 也允许', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, host: `localhost:${PORT}` } });
    expect(res.status).toBe(200);
  });

  it('跨源 Origin 返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, origin: 'https://evil.example.com' } });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: { code: 'forbidden_origin' } });
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
    expect(await json(res)).toMatchObject({ error: { code: 'missing_client_header' } });
  });

  it('Sec-Fetch-Site: cross-site 返回 403', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: { ...WEB_HEADERS, 'sec-fetch-site': 'cross-site' } });
    expect(res.status).toBe(403);
  });

  it('开发模式允许 Vite 端口的 Host 与 Origin，非开发模式不允许', async () => {
    const devHeaders = { ...WEB_HEADERS, host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' };
    expect((await setup({ dev: true }).request(`${BASE}/api/health`, { headers: devHeaders })).status).toBe(200);
    await cleanup();
    expect((await setup({ dev: false }).request(`${BASE}/api/health`, { headers: devHeaders })).status).toBe(403);
  });

  it('未知 /api 路径返回 JSON 404', async () => {
    const res = await setup().request(`${BASE}/api/nope`, { headers: WEB_HEADERS });
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: { code: 'not_found' } });
  });

  it('响应带安全头', async () => {
    const res = await setup().request(`${BASE}/api/health`, { headers: WEB_HEADERS });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });
});

describe('素材内容可由 <img> 直接加载', () => {
  /** 浏览器给同源 <img> 发的请求：带 Sec-Fetch-*，带不了 X-Ark-Client */
  const IMG_HEADERS = { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' };
  /** 地址栏直接打开 */
  const OPEN_HEADERS = { ...IMG_HEADERS, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };

  async function upload(app: ReturnType<typeof setup>, body: Buffer, filename: string, type: string): Promise<string> {
    const res = await app.request(`${BASE}/api/assets`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': type, 'x-asset-filename': filename }, body });
    expect(res.status).toBe(200);
    return (await json(res)).asset.id as string;
  }

  /** 不照抄实现里的常量：逐条检查沙箱约束，CSP 被放宽（删掉 sandbox、加 allow-*）时测试会失败 */
  function expectSandboxed(res: Response) {
    const directives = (res.headers.get('content-security-policy') ?? '').split(';').map((d) => d.trim());
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain('sandbox');
    expect(directives.filter((d) => /^(script-src|sandbox\s)/.test(d) || d.includes('allow-'))).toEqual([]);
  }

  it('同源 <img> 请求不带 X-Ark-Client 也能读，响应是沙箱 CSP', async () => {
    const app = setup();
    const png = makePng(4, 4);
    const id = await upload(app, png, 'a.png', 'image/png');
    const res = await app.request(`${BASE}/api/assets/${id}/content`, { headers: IMG_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expectSandboxed(res);
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    // 地址栏直接打开（Sec-Fetch-Site: none）、不带 Sec-Fetch-* 的旧浏览器或命令行，与 /files/* 一样放行
    expect((await app.request(`${BASE}/api/assets/${id}/content`, { headers: OPEN_HEADERS })).status).toBe(200);
    expect((await app.request(`${BASE}/api/assets/${id}/content`, { headers: { host: `127.0.0.1:${PORT}` } })).status).toBe(200);
  });

  it('HEAD 也放行：空响应体，安全头齐全', async () => {
    const app = setup();
    const png = makePng(4, 4);
    const id = await upload(app, png, 'a.png', 'image/png');
    const res = await app.request(`${BASE}/api/assets/${id}/content`, { method: 'HEAD', headers: IMG_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(png.length));
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expectSandboxed(res);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('跨站或同站（本机其他端口）页面嵌入返回 403', async () => {
    const app = setup();
    const id = await upload(app, makePng(4, 4), 'a.png', 'image/png');
    for (const site of ['cross-site', 'same-site']) {
      const res = await app.request(`${BASE}/api/assets/${id}/content`, { headers: { ...IMG_HEADERS, 'sec-fetch-site': site } });
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ error: { code: 'forbidden_fetch_site' } });
    }
  });

  it('跨源 Origin、错误 Host 仍返回 403', async () => {
    const app = setup();
    const id = await upload(app, makePng(4, 4), 'a.png', 'image/png');
    const url = `${BASE}/api/assets/${id}/content`;
    const badOrigin = await app.request(url, { headers: { ...IMG_HEADERS, origin: 'https://evil.example.com' } });
    expect(badOrigin.status).toBe(403);
    expect(await json(badOrigin)).toMatchObject({ error: { code: 'forbidden_origin' } });
    const badHost = await app.request(url, { headers: { ...IMG_HEADERS, host: `evil.example.com:${PORT}` } });
    expect(badHost.status).toBe(403);
    expect(await json(badHost)).toMatchObject({ error: { code: 'forbidden_host' } });
  });

  it('其他 /api/*、其他方法和路径变体仍要求 X-Ark-Client', async () => {
    const app = setup();
    const id = await upload(app, makePng(4, 4), 'a.png', 'image/png');
    const cases: Array<[string, string]> = [
      ['GET', '/api/health'],
      ['GET', '/api/mcp'],
      ['GET', '/api/keys'],
      ['GET', '/api/tasks'],
      ['POST', '/api/assets'],
      ['GET', `/api/assets/${id}`],
      ['GET', `/api/assets/${id}/content/x`],
      ['GET', `/api/assets/${id}/content/`],
      ['GET', `/api/assets/${id}/Content`],
      ['GET', `/api/assets/${id}/content%2F`],
      ['GET', `/api/assets/${id}/content/..`],
      ['GET', '/api/assets/%2e%2e/content'],
      ['GET', '/api/assets/x/../../tasks/content'],
      ['POST', `/api/assets/${id}/content`],
      ['PUT', `/api/assets/${id}/content`],
      ['PATCH', `/api/assets/${id}/content`],
      ['DELETE', `/api/assets/${id}/content`],
      ['OPTIONS', `/api/assets/${id}/content`],
    ];
    for (const [method, path] of cases) {
      const res = await app.request(`${BASE}${path}`, { method, headers: IMG_HEADERS });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await json(res), `${method} ${path}`).toMatchObject({ error: { code: 'missing_client_header' } });
    }
  });

  it('编码斜杠、双重编码即使免头，也只会落到素材路由', async () => {
    const app = setup();
    for (const path of ['/api/assets/x%2F..%2F..%2Ftasks/content', '/api/assets/x%252F..%252Ftasks/content']) {
      const res = await app.request(`${BASE}${path}`, { headers: IMG_HEADERS });
      expect(res.status, path).toBe(404);
      expect(await json(res), path).toMatchObject({ error: { code: 'not_found', message: '素材不存在' } });
    }
  });

  it('上传的 HTML、SVG 素材直接打开时仍是沙箱 CSP，不被网页的 CSP 覆盖', async () => {
    const app = setup();
    const files: Array<[string, string, string]> = [
      ['x.html', 'text/html', '<script>alert(1)</script>'],
      ['x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ];
    for (const [name, type, body] of files) {
      const id = await upload(app, Buffer.from(body), name, type);
      const res = await app.request(`${BASE}/api/assets/${id}/content`, { headers: OPEN_HEADERS });
      expect(res.status, name).toBe(200);
      expect(res.headers.get('content-type'), name).toContain(type);
      expectSandboxed(res);
    }
  });

  it('网页本身仍是默认 CSP', async () => {
    const web = tempDir('ark-web-');
    writeFileSync(join(web.dir, 'index.html'), '<!doctype html><title>t</title>');
    const app = setup({ staticDir: web.dir });
    try {
      for (const path of ['/', '/history']) {
        const res = await app.request(`${BASE}${path}`, { headers: OPEN_HEADERS });
        expect(res.status, path).toBe(200);
        expect(res.headers.get('content-security-policy'), path).toBe(CONTENT_SECURITY_POLICY);
      }
    } finally {
      web.cleanup();
    }
  });
});
