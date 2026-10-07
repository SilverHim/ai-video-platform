import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { FormInput } from '../../shared/catalog/types.js';
import type { TaskListQuery } from '../../shared/task/records.js';
import { TaskInputError } from '../tasks/task-service.js';
import type { AppDeps } from '../app.js';

function inputError(err: unknown) {
  if (err instanceof TaskInputError) {
    return Response.json({ error: { code: err.code, message: err.i18n.zh, i18n: err.i18n, issues: err.issues } }, { status: err.status });
  }
  throw err;
}

async function readForm(req: Request): Promise<FormInput> {
  const body = (await req.json().catch(() => null)) as { form?: FormInput } | null;
  if (!body?.form || typeof body.form !== 'object') throw new TaskInputError('bad_request', { zh: '请求体需要 {form: {...}}', en: 'Body must be {form: {...}}' });
  return body.form;
}

export function taskRoutes(deps: AppDeps) {
  const app = new Hono();
  const svc = deps.services.tasks;

  app.post('/preview', async (c) => {
    try {
      return c.json(svc.preview(await readForm(c.req.raw)));
    } catch (err) {
      return inputError(err);
    }
  });

  app.post('/tasks', async (c) => {
    try {
      const task = await svc.submit(await readForm(c.req.raw), 'web');
      return c.json({ task });
    } catch (err) {
      return inputError(err);
    }
  });

  app.post('/tasks/stream', async (c) => {
    let form: FormInput;
    try {
      form = await readForm(c.req.raw);
    } catch (err) {
      return inputError(err);
    }
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => {
        closed = true;
      });
      const queue: Promise<unknown>[] = [];
      const send = (ev: { event: string; data: string }) => {
        if (!closed) queue.push(stream.writeSSE(ev).catch(() => (closed = true)));
      };
      try {
        await svc.submitStream(form, 'web', send);
      } catch (err) {
        const e = err instanceof TaskInputError ? { code: err.code, message: err.i18n.zh, i18n: err.i18n, issues: err.issues } : { code: 'internal_error', message: '服务内部错误' };
        send({ event: 'ark.error', data: JSON.stringify(e) });
      }
      await Promise.allSettled(queue);
    });
  });

  app.get('/tasks', (c) => {
    const q: TaskListQuery = {};
    const limit = Number(c.req.query('limit'));
    const before = Number(c.req.query('before'));
    if (Number.isFinite(limit) && limit > 0) q.limit = limit;
    if (Number.isFinite(before) && before > 0) q.before = before;
    for (const k of ['status', 'providerId', 'modelId', 'origin'] as const) {
      const v = c.req.query(k);
      if (v) (q as Record<string, string>)[k] = v;
    }
    return c.json({ tasks: deps.store.listTasks(q) });
  });

  app.get('/tasks/:id', (c) => {
    const task = deps.store.getTask(c.req.param('id'));
    if (!task) return c.json({ error: { code: 'not_found', message: '任务不存在' } }, 404);
    return c.json({ task, exchanges: deps.store.listExchanges(task.id) });
  });

  app.delete('/tasks/:id', (c) => {
    const id = c.req.param('id');
    if (!deps.store.deleteTask(id)) return c.json({ error: { code: 'not_found', message: '任务不存在' } }, 404);
    deps.services.events.emit({ type: 'task.deleted', taskId: id });
    return c.json({ ok: true });
  });

  app.post('/keys/:provider/test', async (c) => {
    try {
      return c.json(await svc.testKey(c.req.param('provider')));
    } catch (err) {
      return inputError(err);
    }
  });

  return app;
}
