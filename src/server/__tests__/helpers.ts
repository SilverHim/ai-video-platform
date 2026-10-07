import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { ensureDataDirs, resolveConfig, type ServerOptions } from '../config.js';
import { Keystore } from '../keystore.js';

export const PORT = 8787;
export const BASE = `http://127.0.0.1:${PORT}`;
export const WEB_HEADERS = { host: `127.0.0.1:${PORT}`, 'x-ark-client': 'web' } as const;

export function tempDir(prefix = 'ark-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function makeApp(opts: Partial<ServerOptions> = {}, env: NodeJS.ProcessEnv = {}) {
  const tmp = tempDir();
  const config = resolveConfig({ dataDir: tmp.dir, port: PORT, ...opts });
  ensureDataDirs(config.paths);
  const keystore = new Keystore(config.paths.keys, env);
  const app = createApp({ config, keystore, version: 'test', getPort: () => PORT });
  return { app, config, keystore, cleanup: tmp.cleanup };
}
