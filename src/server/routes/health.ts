import { Hono } from 'hono';
import { APP_NAME, type HealthInfo } from '../../shared/api-contract.js';
import { findExecutable } from '../platform/tools.js';
import type { AppDeps } from '../app.js';

export function healthRoutes(deps: AppDeps) {
  let ffprobe: Promise<boolean> | null = null;
  const app = new Hono();
  app.get('/', async (c) => {
    ffprobe ??= findExecutable('ffprobe').then(Boolean);
    const body: HealthInfo = {
      ok: true,
      name: APP_NAME,
      version: deps.version,
      node: process.version,
      platform: process.platform,
      dataDir: deps.config.dataDir,
      mock: deps.config.mock,
      ffprobe: await ffprobe,
    };
    return c.json(body);
  });
  return app;
}
