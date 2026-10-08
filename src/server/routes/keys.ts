import { Hono } from 'hono';
import { isKeyId } from '../../shared/api-contract.js';
import { KeyValidationError } from '../keystore.js';
import type { AppDeps } from '../app.js';

export function keyRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/', (c) => c.json({ keys: deps.keystore.list() }));

  app.put('/:keyId', async (c) => {
    const keyId = c.req.param('keyId');
    if (!isKeyId(keyId)) return c.json({ error: { code: 'unknown_key', message: `未知的 Key 槽位：${keyId}` } }, 404);
    const body = await c.req.json().catch(() => null) as { apiKey?: unknown } | null;
    try {
      return c.json({ key: deps.keystore.set(keyId, body?.apiKey) });
    } catch (err) {
      if (err instanceof KeyValidationError) return c.json({ error: { code: 'invalid_key', message: err.message } }, 400);
      throw err;
    }
  });

  app.delete('/:keyId', (c) => {
    const keyId = c.req.param('keyId');
    if (!isKeyId(keyId)) return c.json({ error: { code: 'unknown_key', message: `未知的 Key 槽位：${keyId}` } }, 404);
    return c.json({ key: deps.keystore.clear(keyId) });
  });

  return app;
}
