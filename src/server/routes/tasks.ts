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

/** 网页通过请求头传递"同意公开上传"与托管站选择 */
function submitOptions(req: Request) {
  const consent = req.headers.get('x-upload-consent') === '1';
  const host = req.headers.get('x-upload-target') ?? undefined;
  return { ...(consent ? { publicUploadConsent: true } : {}), ...(host ? { tempHost: host } : {}) };
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
      return c.json(svc.preview(await readForm(c.req.raw), submitOptions(c.req.raw)));
    } catch (err) {
      return inputError(err);
    }
  });

  app.post('/tasks', async (c) => {
    try {
      const task = await svc.submit(await readForm(c.req.raw), 'web', submitOptions(c.req.raw));
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
        await svc.submitStream(form, 'web', send, submitOptions(c.req.raw));
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

  /** 删除本地记录；?remote=1 时先删除云端记录（仅已结束的任务） */
  app.delete('/tasks/:id', async (c) => {
    const id = c.req.param('id');
    if (c.req.query('remote') === '1') {
      try {
        const r = await svc.cancelOrDeleteRemote(id);
        if (!r.ok) return c.json({ ok: false, error: r.error }, 502);
      } catch (err) {
        return inputError(err);
      }
    }
    if (!deps.store.deleteTask(id)) return c.json({ error: { code: 'not_found', message: '任务不存在' } }, 404);
    deps.services.events.emit({ type: 'task.deleted', taskId: id });
    return c.json({ ok: true });
  });

  /** 取消排队中的异步任务 */
  app.post('/tasks/:id/cancel', async (c) => {
    try {
      const r = await svc.cancelOrDeleteRemote(c.req.param('id'));
      return c.json(r, r.ok ? 200 : 502);
    } catch (err) {
      return inputError(err);
    }
  });

  /** 立即重查（也用于恢复因缺 Key / 连续出错而暂停的轮询） */
  app.post('/tasks/:id/refresh', async (c) => {
    const task = await deps.services.scheduler.refresh(c.req.param('id'));
    if (!task) return c.json({ error: { code: 'not_found', message: '任务不存在' } }, 404);
    return c.json({ task });
  });

  /** 云端任务列表（原样返回，手动刷新） */
  app.get('/cloud/:provider/tasks', async (c) => {
    try {
      const q: Record<string, string> = { page_num: c.req.query('page_num') ?? '1', page_size: c.req.query('page_size') ?? '20' };
      return c.json(await svc.listRemote(c.req.param('provider'), q));
    } catch (err) {
      return inputError(err);
    }
  });

  app.post('/keys/:keyId/test', async (c) => {
    try {
      return c.json(await svc.testKey(c.req.param('keyId')));
    } catch (err) {
      return inputError(err);
    }
  });

  app.get('/keys/:keyId/quota', async (c) => {
    try {
      return c.json(await svc.quota(c.req.param('keyId')));
    } catch (err) {
      return inputError(err);
    }
  });

  return app;
}
