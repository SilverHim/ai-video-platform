import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mcpConnectCommand } from '../app.js';
import { acquireInstanceLock, DataDirInUseError } from '../platform/instance-lock.js';
import { startServer } from '../start.js';
import { tempDir } from './helpers.js';

let cleanup = () => {};
afterEach(() => cleanup());

describe('数据目录实例锁', () => {
  it('同一进程第二次拿锁被拒；释放后可以再拿', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const lock = acquireInstanceLock(tmp.dir);
    expect(() => acquireInstanceLock(tmp.dir)).toThrow(DataDirInUseError);
    lock.release();
    lock.release();
    acquireInstanceLock(tmp.dir).release();
  });

  it('另一个进程占着锁时拿不到；那个进程被强行结束后锁自动释放', async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const file = join(tmp.dir, 'instance.lock');
    const child = spawn(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(file)});d.exec('BEGIN EXCLUSIVE');console.log('locked');setInterval(()=>{},1000)`], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve) => child.stdout!.on('data', (d: Buffer) => d.toString().includes('locked') && resolve()));
    expect(() => acquireInstanceLock(tmp.dir)).toThrow(DataDirInUseError);
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    acquireInstanceLock(tmp.dir).release();
  });

  it('两个服务实例共用数据目录：第二个启动失败，不动数据', async () => {
    const tmp = tempDir();
    const first = await startServer({ dataDir: tmp.dir, port: 0, version: 't' });
    cleanup = () => tmp.cleanup();
    try {
      await expect(startServer({ dataDir: tmp.dir, port: 0, version: 't' })).rejects.toMatchObject({ code: 'DATA_DIR_IN_USE' });
    } finally {
      await first.close();
    }
    // 第一个关掉后可以再启动
    const again = await startServer({ dataDir: tmp.dir, port: 0, version: 't' });
    await again.close();
  });

  it('启动中途失败（端口被占用）也会释放锁，同一目录可以马上重新启动', async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const busy = (blocker.address() as AddressInfo).port;
    try {
      await expect(startServer({ dataDir: tmp.dir, port: busy, dev: true, version: 't' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
    const ok = await startServer({ dataDir: tmp.dir, port: 0, version: 't' });
    await ok.close();
  });
});

describe('设置页接入命令', () => {
  const url = 'http://127.0.0.1:8787/mcp';
  const token = 'a'.repeat(64);
  it('macOS / Linux：sh 写法，单引号包 JSON，带 10 分钟超时', () => {
    const cmd = mcpConnectCommand(url, token, 'darwin');
    expect(cmd.startsWith('claude mcp remove ai-video --scope user 2>/dev/null; ')).toBe(true);
    const entry = JSON.parse(/'(\{.*\})'/.exec(cmd)![1]!) as Record<string, unknown>;
    expect(entry).toEqual({ type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
  });
  it('Windows：PowerShell 写法，按参数传递方式转义双引号', () => {
    const cmd = mcpConnectCommand(url, token, 'win32');
    expect(cmd.startsWith("& { $PSNativeCommandArgumentPassing = 'Legacy'; ")).toBe(true);
    expect(cmd).toContain('claude mcp remove ai-video --scope user 2>$null | Out-Null');
    expect(cmd).toContain(`claude mcp add-json --scope user ai-video ('{"type":"http","url":"${url}"`);
    // 参数里不能有空格（Legacy 传参会切开）：Bearer 后的空格写成 JSON 转义
    expect(cmd).toContain(`"Authorization":"Bearer\\u0020${token}"`);
    expect(cmd.endsWith(`' -replace '"', '\\"') }`)).toBe(true);
    const json = /\('(\{.*\})' -replace/.exec(cmd)![1]!;
    expect(json).not.toContain(' ');
    expect(JSON.parse(json)).toEqual({ type: 'http', url, headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
  });
});
