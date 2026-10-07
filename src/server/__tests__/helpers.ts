import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig, type ServerOptions } from '../config.js';
import { createContainer } from '../container.js';
import type { Downloader } from '../capture/downloader.js';
import type { FetchLike } from '../upstream/http.js';
import type { Catalog } from '../tasks/task-service.js';

export const PORT = 8787;
export const BASE = `http://127.0.0.1:${PORT}`;
export const WEB_HEADERS = { host: `127.0.0.1:${PORT}`, 'x-ark-client': 'web' } as const;

export function tempDir(prefix = 'ark-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface MakeAppOptions extends Partial<ServerOptions> {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  downloader?: Downloader;
  catalog?: Catalog;
}

/** 测试用应用：默认 mock 上游，环境变量隔离 */
export function makeApp(opts: MakeAppOptions = {}, env: NodeJS.ProcessEnv = {}) {
  const tmp = tempDir();
  const { env: optEnv, fetchImpl, downloader, catalog, ...serverOpts } = opts;
  const config = resolveConfig({ dataDir: tmp.dir, port: PORT, mock: true, ...serverOpts });
  ensureDataDirs(config.paths);
  const container = createContainer(config, { env: optEnv ?? env, ...(fetchImpl ? { fetchImpl } : {}), ...(downloader ? { downloader } : {}), ...(catalog ? { catalog } : {}) });
  const app = createApp({ config, keystore: container.keystore, store: container.store, services: container.services, version: 'test', getPort: () => PORT, quiet: true });
  return {
    app,
    config,
    keystore: container.keystore,
    store: container.store,
    services: container.services,
    cleanup: () => {
      void container.close();
      tmp.cleanup();
    },
  };
}
