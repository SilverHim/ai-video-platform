import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureDataDirs, resolveConfig, type ResolvedConfig, type ServerOptions } from './config.js';
import { createContainer, type Container } from './container.js';
import { acquireInstanceLock } from './platform/instance-lock.js';

export interface RunningServer {
  url: string;
  port: number;
  config: ResolvedConfig;
  close: () => Promise<void>;
}

type HttpServer = ReturnType<typeof createAdaptorServer>;

/** 关掉监听（SSE 长连接需要强制断开）；没在监听时直接返回 */
function closeHttp(server: HttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  if ('closeAllConnections' in server) server.closeAllConnections();
  return new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
}

/** 启动本机服务：只监听 127.0.0.1；端口被占用时（非开发模式）依次尝试后续端口 */
export async function startServer(opts: ServerOptions & { version?: string }): Promise<RunningServer> {
  const config = resolveConfig(opts);
  ensureDataDirs(config.paths);
  // 同一个数据目录同时只能有一个服务实例（两个实例会重复轮询、重复下载，启动恢复也会误伤对方的任务）
  const lock = acquireInstanceLock(config.paths.root);
  let container: Container | undefined;
  let server: HttpServer | undefined;
  try {
    container = createContainer(config);
    const c = container;
    let boundPort = config.port;
    const app = createApp({ config, keystore: c.keystore, store: c.store, services: c.services, version: opts.version ?? '0.0.0', getPort: () => boundPort });

    const http = createAdaptorServer({ fetch: app.fetch });
    server = http;
    // 大文件上传与长时间生成：关闭整体请求超时，保留请求头超时
    if ('requestTimeout' in http) http.requestTimeout = 0;
    if ('headersTimeout' in http) http.headersTimeout = 60_000;

    const tryListen = (port: number) =>
      new Promise<number>((resolveListen, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          http.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          http.off('error', onError);
          resolveListen((http.address() as AddressInfo).port);
        };
        http.once('error', onError);
        http.once('listening', onListening);
        http.listen(port, '127.0.0.1');
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

    // 已独占数据目录：上次关闭时被打断的任务都属于已经不在的实例，可以安全恢复
    c.services.tasks.recoverInterrupted();
    c.services.scheduler.start();
    return {
      url: `http://127.0.0.1:${boundPort}`,
      port: boundPort,
      config,
      close: async () => {
        // 先关监听，再关存储；无论哪一步出错都释放数据目录锁
        try {
          await closeHttp(http);
          await c.close();
        } finally {
          lock.release();
        }
      },
    };
  } catch (err) {
    // 启动中途失败：尽力收拾已经打开的资源，保留原始错误
    if (server) await closeHttp(server).catch(() => undefined);
    if (container) await container.close().catch(() => undefined);
    lock.release();
    throw err;
  }
}
