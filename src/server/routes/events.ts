import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerEvent } from '../../shared/task/records.js';
import type { AppDeps } from '../app.js';

/** 任务变化实时推送（网页订阅）；每 20 秒发一次 ping 保活 */
export function eventRoutes(deps: AppDeps) {
  const app = new Hono();
  app.get('/', (c) =>
    streamSSE(c, async (stream) => {
      const pending: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = deps.services.events.subscribe((ev) => {
        pending.push(ev);
        wake?.();
      });
      let open = true;
      stream.onAbort(() => {
        open = false;
        wake?.();
      });
      try {
        await stream.writeSSE({ event: 'ready', data: '{}' });
        while (open) {
          if (pending.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              setTimeout(resolve, 20_000);
            });
            wake = null;
            if (pending.length === 0 && open) await stream.writeSSE({ event: 'ping', data: JSON.stringify({ type: 'ping', at: Date.now() }) });
          }
          while (pending.length && open) {
            const ev = pending.shift()!;
            await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
          }
        }
      } finally {
        unsubscribe();
      }
    }),
  );
  return app;
}
