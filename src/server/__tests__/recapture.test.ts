import { afterEach, describe, expect, it } from 'vitest';
import { upgradeToHttps } from '../capture/net-guard.js';
import type { Downloaded, Downloader } from '../capture/downloader.js';
import { MockDownloader } from '../mock/upstream.js';
import { BASE, json, makeApp, WEB_HEADERS } from './helpers.js';

describe('http 结果链接改用 https 下载', () => {
  it('只改协议，其余（含签名参数）原样保留', () => {
    const u = 'http://bucket.oss-us-east-1.aliyuncs.com/a%2Fb.jpeg?Expires=1&OSSAccessKeyId=x&Signature=y%3D';
    expect(upgradeToHttps(u)).toBe('https://bucket.oss-us-east-1.aliyuncs.com/a%2Fb.jpeg?Expires=1&OSSAccessKeyId=x&Signature=y%3D');
    expect(upgradeToHttps('HTTP://x.com/a')).toBe('https://x.com/a');
    expect(upgradeToHttps('https://x.com/a')).toBe('https://x.com/a');
  });
});

describe('重新下载未保存的结果', () => {
  let t: ReturnType<typeof makeApp>;
  afterEach(() => t.cleanup());

  it('第一次落盘失败记为 partial，重新下载补齐后改回 succeeded', async () => {
    const real = new MockDownloader();
    let fail = true;
    const flaky: Downloader = {
      download: async (url: string, dest: string): Promise<Downloaded> => {
        if (fail) throw new Error('只允许下载 https 链接');
        return real.download(url, dest);
      },
    };
    t = makeApp({ downloader: flaky });
    const post = (path: string, body: unknown) => t.app.request(`${BASE}${path}`, { method: 'POST', headers: { ...WEB_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const { task } = await json(await post('/api/tasks', { form: { providerId: 'minimax', modelId: 'minimax/image-01', modeId: 't2i', values: {}, slots: {}, prompt: 'a cat' } }));
    expect(task.status).toBe('partial');
    expect(task.error.code).toBe('CAPTURE_FAILED');
    expect(task.results.every((r: { path: string | null }) => r.path === null)).toBe(true);

    fail = false;
    const done = (await json(await post(`/api/tasks/${task.id}/recapture`, {}))).task;
    expect(done).toMatchObject({ status: 'succeeded', capture: 'done', error: null });
    expect(done.results.every((r: { path: string | null }) => typeof r.path === 'string')).toBe(true);
    // 都保存了以后再点会提示没有可重新下载的
    expect((await post(`/api/tasks/${task.id}/recapture`, {})).status).toBe(409);
  });
});
