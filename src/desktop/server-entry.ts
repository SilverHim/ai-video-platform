/**
 * 桌面版：在 Electron utilityProcess 里运行本机服务（与界面线程隔离），通过 parentPort 与主进程通信。
 * 参数：--data-dir <目录> --static-dir <dist/web> [--port <端口>] [--version <版本>]
 */
import { startServer } from '../server/start.js';
import type { ServerMessage } from './policy.js';

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
const send = (msg: ServerMessage) => parentPort?.postMessage(msg);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function run() {
  const dataDir = arg('data-dir');
  const staticDir = arg('static-dir');
  if (!dataDir || !staticDir) throw new Error('缺少 --data-dir 或 --static-dir');
  const port = arg('port');
  const running = await startServer({
    dataDir,
    staticDir,
    ...(port !== undefined ? { port: Number(port) } : {}),
    mock: process.env.ARK_MOCK_UPSTREAM === '1',
    version: arg('version') ?? '0.0.0',
  });
  console.log(`[server] 已启动：${running.url}（数据目录：${running.config.dataDir}）`);
  send({ type: 'ready', url: running.url, port: running.port, dataDir: running.config.dataDir });

  let closing = false;
  parentPort?.on('message', (e) => {
    if (closing || (e.data as { type?: unknown } | null)?.type !== 'shutdown') return;
    closing = true;
    running
      .close()
      .catch((err: unknown) => console.error('[server] 关闭出错：', err))
      .finally(() => process.exit(0));
  });
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[server] 启动失败：', message);
  send({ type: 'error', message });
  // 给消息一点时间送达主进程
  setTimeout(() => process.exit(1), 200);
});
