import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../index.js';
import { tempDir, json } from './helpers.js';

const running: RunningServer[] = [];
let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  while (running.length) await running.pop()!.close();
  cleanup();
});

describe('startServer', () => {
  it('只监听 127.0.0.1，可通过真实 HTTP 访问 health', async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const s = await startServer({ dataDir: tmp.dir, port: 0, version: 't' });
    running.push(s);
    expect(s.url.startsWith('http://127.0.0.1:')).toBe(true);
    const res = await fetch(`${s.url}/api/health`, { headers: { 'x-ark-client': 'web' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, dataDir: s.config.dataDir });
    // 令牌文件在启动时就生成（agent 接入说明依赖它）
    expect(existsSync(s.config.paths.mcpToken)).toBe(true);
  });

  it('端口被占用时向后尝试', async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const busy = (blocker.address() as { port: number }).port;
    try {
      const s = await startServer({ dataDir: tmp.dir, port: busy, portRetries: 5, version: 't' });
      running.push(s);
      expect(s.port).toBeGreaterThan(busy);
    } finally {
      blocker.close();
    }
  });

  it('开发模式端口冲突直接报错', async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const busy = (blocker.address() as { port: number }).port;
    try {
      await expect(startServer({ dataDir: tmp.dir, port: busy, dev: true, version: 't' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      blocker.close();
    }
  });
});
