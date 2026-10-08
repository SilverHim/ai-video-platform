import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRootFrom } from './platform/paths.js';
import { startServer } from './start.js';

export { startServer, type RunningServer } from './start.js';

function readVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
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
