import { Hono } from 'hono';
import type { ResolvedConfig } from './config.js';
import type { Keystore } from './keystore.js';
import { localGuard, localHostSet, localOriginSet } from './middleware/local-guard.js';
import { securityHeaders } from './middleware/security-headers.js';
import { healthRoutes } from './routes/health.js';
import { keyRoutes } from './routes/keys.js';
import { staticSite } from './static.js';

export interface AppDeps {
  config: ResolvedConfig;
  keystore: Keystore;
  version: string;
  /** 实际监听端口（listen 之后才知道，所以用函数） */
  getPort: () => number;
}

export function createApp(deps: AppDeps) {
  const ports = () => {
    const list = [deps.getPort()];
    if (deps.config.dev) list.push(deps.config.devWebPort);
    return list;
  };

  const app = new Hono();
  app.use('*', securityHeaders());
  app.use('*', localGuard({ allowedHosts: () => localHostSet(ports()), allowedOrigins: () => localOriginSet(ports()) }));

  app.route('/api/health', healthRoutes(deps));
  app.route('/api/keys', keyRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: '接口不存在' } }, 404));

  if (deps.config.staticDir) app.use('*', staticSite(deps.config.staticDir));

  app.onError((err, c) => {
    console.error('[server] 未处理的错误：', err instanceof Error ? err.message : err);
    return c.json({ error: { code: 'internal_error', message: '服务内部错误' } }, 500);
  });
  return app;
}
