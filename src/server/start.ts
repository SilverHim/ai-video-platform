import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureDataDirs, resolveConfig, type ResolvedConfig, type ServerOptions } from './config.js';
import { createContainer } from './container.js';
import { acquireInstanceLock } from './platform/instance-lock.js';

export interface RunningServer {
  url: string;
  port: number;
  config: ResolvedConfig;
  close: () => Promise<void>;
}

/** 启动本机服务：只监听 127.0.0.1；端口被占用时（非开发模式）依次尝试后续端口 */
export async function startServer(opts: ServerOptions & { version?: string }): Promise<RunningServer> {
  const config = resolveConfig(opts);
  ensureDataDirs(config.paths);
  // 同一个数据目录同时只能有一个服务实例（两个实例会重复轮询、重复下载，启动恢复也会误伤对方的任务）
  const lock = acquireInstanceLock(config.paths.root);
  let container: ReturnType<typeof createContainer>;
  try {
    container = createContainer(config);
  } catch (err) {
    lock.release();
    throw err;
  }
  let boundPort = config.port;
  const app = createApp({ config, keystore: container.keystore, store: container.store, services: container.services, version: opts.version ?? '0.0.0', getPort: () => boundPort });

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
  if (lastErr) {
    await container.close();
    lock.release();
    throw lastErr;
  }

  // 已独占数据目录：上次关闭时被打断的任务都属于已经不在的实例，可以安全恢复
  container.services.tasks.recoverInterrupted();
  container.services.scheduler.start();
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    config,
    close: async () => {
      // 先关监听（SSE 长连接需要强制断开），再关存储
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
      await container.close();
      lock.release();
    },
  };
}
