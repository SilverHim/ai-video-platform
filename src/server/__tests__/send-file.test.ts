import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mimeFor, safeJoin, sendFile } from '../http/send-file.js';
import { tempDir } from './helpers.js';

let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  await cleanup();
});

describe('safeJoin 防路径穿越', () => {
  const root = resolve('/srv/outputs');
  it('正常路径', () => {
    expect(safeJoin(root, '/2026-10-08/a.mp4')).toBe(join(root, '2026-10-08', 'a.mp4'));
  });
  it.each(['/../etc/passwd', '/a/../../b', '/%2e%2e/x', '/..%2fx', '/a\\..\\..\\b', '/a%00.png', '/%E0%A4%A'])('拒绝 %s', (p) => {
    expect(safeJoin(root, p)).toBeNull();
  });
});

describe('sendFile', () => {
  function fixture() {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    mkdirSync(join(tmp.dir, 'd'));
    const file = join(tmp.dir, 'd', 'clip.mp4');
    writeFileSync(file, Buffer.from('0123456789'));
    return file;
  }

  it('完整读取返回 200 与正确类型', async () => {
    const res = await sendFile(new Request('http://x/clip.mp4'), fixture());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(await res.text()).toBe('0123456789');
  });

  it('Range 返回 206', async () => {
    const res = await sendFile(new Request('http://x/clip.mp4', { headers: { range: 'bytes=2-5' } }), fixture());
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await res.text()).toBe('2345');
  });

  it('后缀 Range 与开放 Range', async () => {
    const file = fixture();
    expect(await (await sendFile(new Request('http://x', { headers: { range: 'bytes=-3' } }), file)).text()).toBe('789');
    expect(await (await sendFile(new Request('http://x', { headers: { range: 'bytes=7-' } }), file)).text()).toBe('789');
  });

  it('越界 Range 返回 416', async () => {
    const res = await sendFile(new Request('http://x', { headers: { range: 'bytes=20-30' } }), fixture());
    expect(res.status).toBe(416);
  });

  it('不存在的文件和目录返回 404', async () => {
    const file = fixture();
    expect((await sendFile(new Request('http://x'), `${file}.nope`)).status).toBe(404);
    expect((await sendFile(new Request('http://x'), resolve(file, '..'))).status).toBe(404);
  });

  it('mimeFor', () => {
    expect(mimeFor('a.MOV')).toBe('video/quicktime');
    expect(mimeFor('a.bin')).toBe('application/octet-stream');
  });
});
