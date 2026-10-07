import { Hono } from 'hono';
import { isProviderId } from '../../shared/api-contract.js';
import { KeyValidationError } from '../keystore.js';
import type { AppDeps } from '../app.js';

export function keyRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/', (c) => c.json({ keys: deps.keystore.list() }));

  app.put('/:provider', async (c) => {
    const provider = c.req.param('provider');
    if (!isProviderId(provider)) return c.json({ error: { code: 'unknown_provider', message: `未知服务商：${provider}` } }, 404);
    const body = await c.req.json().catch(() => null) as { apiKey?: unknown } | null;
    try {
      return c.json({ key: deps.keystore.set(provider, body?.apiKey) });
    } catch (err) {
      if (err instanceof KeyValidationError) return c.json({ error: { code: 'invalid_key', message: err.message } }, 400);
      throw err;
    }
  });

  app.delete('/:provider', (c) => {
    const provider = c.req.param('provider');
    if (!isProviderId(provider)) return c.json({ error: { code: 'unknown_provider', message: `未知服务商：${provider}` } }, 404);
    return c.json({ key: deps.keystore.clear(provider) });
  });

  return app;
}
