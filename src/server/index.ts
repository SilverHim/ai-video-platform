import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureDataDirs, resolveConfig, type ResolvedConfig, type ServerOptions } from './config.js';
import { Keystore } from './keystore.js';
import { projectRootFrom } from './platform/paths.js';

export interface RunningServer {
  url: string;
  port: number;
  config: ResolvedConfig;
  close: () => Promise<void>;
}

function readVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 启动本机服务：只监听 127.0.0.1；端口被占用时（非开发模式）依次尝试后续端口 */
export async function startServer(opts: ServerOptions & { version?: string }): Promise<RunningServer> {
  const config = resolveConfig(opts);
  ensureDataDirs(config.paths);
  const keystore = new Keystore(config.paths.keys);
  let boundPort = config.port;
  const app = createApp({ config, keystore, version: opts.version ?? '0.0.0', getPort: () => boundPort });

  const server = createAdaptorServer({ fetch: app.fetch });
  // 大文件上传与长时间生成：关闭整体请求超时，保留请求头超时
  if ('requestTimeout' in server) server.requestTimeout = 0;
  if ('headersTimeout' in server) server.headersTimeout = 60_000;

  const tryListen = (port: number) =>
    new Promise<number>((resolveListen, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolveListen((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });

  let lastErr: unknown;
  for (let i = 0; i <= config.portRetries; i++) {
    const candidate = config.port === 0 ? 0 : config.port + i;
    try {
      boundPort = await tryListen(candidate);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break;
    }
  }
  if (lastErr) throw lastErr;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    config,
    close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
  };
}

function parseArgs(argv: string[]) {
  const args = { dev: false, open: false, port: undefined as number | undefined, dataDir: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') args.dev = true;
    else if (a === '--open') args.open = true;
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--data-dir') args.dataDir = argv[++i];
  }
  return args;
}

async function main() {
  const root = projectRootFrom(import.meta.url);
  const args = parseArgs(process.argv.slice(2));
  const port = args.port ?? (process.env.ARK_API_PORT ? Number(process.env.ARK_API_PORT) : undefined);
  const dataDir = resolve(args.dataDir ?? process.env.ARK_DATA_DIR ?? join(root, 'data'));
  const staticDir = join(root, 'dist', 'web');
  const running = await startServer({
    ...(port !== undefined ? { port } : {}),
    dataDir,
    dev: args.dev,
    mock: process.env.ARK_MOCK_UPSTREAM === '1',
    ...(!args.dev && existsSync(staticDir) ? { staticDir } : {}),
    version: readVersion(root),
  });
  console.log(`[server] 已启动：${running.url}（数据目录：${running.config.dataDir}${running.config.mock ? '，mock 模式' : ''}）`);
  if (args.dev) console.log('[server] 开发模式：请打开 Vite 页面 http://127.0.0.1:5173');
  if (args.open && !args.dev) {
    const { default: open } = await import('open');
    await open(running.url);
  }
  const shutdown = () => {
    running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[server] 启动失败：', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
