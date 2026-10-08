import { Hono, type Context } from 'hono';
import type { EndpointCreateInput, EndpointCreatePlan, EndpointInfo, EndpointUpdateInput } from '../../shared/api-contract.js';
import { T } from '../../shared/catalog/helpers.js';
import type { I18nText } from '../../shared/i18n.js';
import { getModel } from '../../shared/providers/registry.js';
import { byteplusModels } from '../controlplane/directory.js';
import type { AppDeps } from '../app.js';
import {
  checkEndpointId,
  ControlPlaneError,
  createBody,
  endpointOf,
  EndpointInputError,
  MODERATION_OFF,
  MODERATION_ON,
  toEndpointInfo,
  updateBody,
  type ArkControlClient,
  type ControlCredentials,
} from '../controlplane/ark-control.js';
import { KeyValidationError } from '../keystore.js';

/** 删除必须带这个头，值等于要删的 Endpoint ID（平台弹窗确认后才会带上） */
export const CONFIRM_DELETE_HEADER = 'x-confirm-delete';

/** 删除前要先停止（实测：运行中删除返回 OperationDenied.Running），停止是异步的，最多等这么久 */
export const STOP_WAIT_MS = 120_000;
export const STOP_POLL_MS = 3_000;



export function endpointRoutes(deps: AppDeps) {
  const app = new Hono();
  const control = deps.services.control;
  const directory = deps.services.endpoints;
  const invalidate = () => directory.invalidate();

  const creds = (c: Context): ControlCredentials | Response => {
    const cr = deps.keystore.getControl();
    return cr ?? c.json({ error: { code: 'control_not_configured', message: '还没有配置 AK/SK：请在「设置 → Endpoint」里填写' } }, 409);
  };

  const fail = (c: Context, err: unknown) => {
    if (err instanceof EndpointInputError || err instanceof KeyValidationError) return c.json({ error: { code: 'invalid_input', message: err.message } }, 400);
    if (err instanceof ControlPlaneError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.requestId ? { requestId: err.requestId } : {}), upstreamStatus: err.httpStatus } }, 502);
    }
    throw err;
  };

  /* ---------- 凭据 ---------- */

  app.get('/control/credentials', (c) => c.json({ credentials: deps.keystore.controlStatus() }));

  app.put('/control/credentials', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { accessKeyId?: unknown; secretAccessKey?: unknown } | null;
    try {
      invalidate();
      return c.json({ credentials: deps.keystore.setControl(body?.accessKeyId, body?.secretAccessKey) });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.delete('/control/credentials', (c) => {
    invalidate();
    return c.json({ credentials: deps.keystore.clearControl() });
  });

  /** 免费的只读校验：列 1 条 Endpoint */
  app.post('/control/credentials/test', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    try {
      const res = await control.call(cr, 'ListEndpoints', { PageNumber: 1, PageSize: 1 });
      return c.json({ ok: true, total: typeof res.TotalCount === 'number' ? res.TotalCount : null });
    } catch (err) {
      return fail(c, err);
    }
  });

  /* ---------- Endpoint ---------- */

  app.get('/endpoints', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    const modelId = c.req.query('modelId');
    try {
      const all = await directory.list({ refresh: c.req.query('refresh') === '1' });
      const items = modelId ? all.filter((e) => e.modelId === modelId) : all;
      return c.json({ items });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/endpoints/:id', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    try {
      const d = await control.call(cr, 'GetEndpoint', { Id: checkEndpointId(c.req.param('id')) });
      return c.json({ endpoint: toEndpointInfo(endpointOf(d), byteplusModels()) });
    } catch (err) {
      return fail(c, err);
    }
  });

  const readInput = async (c: Context) => (await c.req.json().catch(() => ({}))) as EndpointCreateInput;

  /** 预检：CreateEndpoint DryRun=true，不创建资源 */
  app.post('/endpoints/plan', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    const input = await readInput(c);
    try {
      const request = createBody(input, getModel(input.modelId)?.model, false);
      const notes = [T('标准 Endpoint 按用量后付费，不调用不收费。', 'Standard endpoints are billed by usage; no charge without calls.')];
      if (input.contentFilter === false) {
        notes.push(T('关闭内容过滤用 Moderation.Strategy=Skip：接口文档未列出，按官方 CLI 实测；创建后会回读核对。', 'Disabling the content filter sends Moderation.Strategy=Skip: not in the API docs, verified with the official CLI; it is read back after creation.'));
      }
      let dryRun: EndpointCreatePlan['dryRun'];
      try {
        await control.call(cr, 'CreateEndpoint', createBody(input, getModel(input.modelId)?.model, true));
        dryRun = { ok: true };
      } catch (err) {
        // 预检通过时部分 OpenAPI 用 DryRunOperation 一类错误码表示"本可成功"，返回格式文档未写，两种都接受
        if (err instanceof ControlPlaneError && /dryrun/i.test(err.code)) dryRun = { ok: true };
        else if (err instanceof ControlPlaneError) dryRun = { ok: false, code: err.code, message: err.message };
        else throw err;
      }
      return c.json({ request, dryRun, notes } satisfies EndpointCreatePlan);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/endpoints', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    const input = await readInput(c);
    try {
      const res = await control.call(cr, 'CreateEndpoint', createBody(input, getModel(input.modelId)?.model, false));
      invalidate();
      const id = typeof res.Id === 'string' ? res.Id : '';
      const warnings: I18nText[] = [];
      let endpoint: EndpointInfo | null = null;
      try {
        const d = await control.call(cr, 'GetEndpoint', { Id: id });
        endpoint = toEndpointInfo(endpointOf(d), byteplusModels());
        if (input.contentFilter === false && endpoint.moderationStrategy !== MODERATION_OFF) {
          warnings.push(T(`回读到的内容过滤策略是 ${endpoint.moderationStrategy ?? '（未返回）'}，不是 Skip：请到控制台确认`, `Read back moderation strategy ${endpoint.moderationStrategy ?? '(missing)'} instead of Skip; check in the console`));
        }
      } catch {
        warnings.push(T('已创建，但回读详情失败；稍后在列表里刷新', 'Created, but reading it back failed; refresh the list later'));
      }
      return c.json({ id, endpoint, warnings });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/endpoints/:id', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    const input = (await c.req.json().catch(() => ({}))) as EndpointUpdateInput;
    try {
      const id = checkEndpointId(c.req.param('id'));
      await control.call(cr, 'UpdateEndpoint', updateBody(id, input));
      invalidate();
      const warnings: I18nText[] = [];
      // 改了内容过滤就回读核对（Moderation 不在文档里，按实测）
      if (input.contentFilter !== undefined) {
        const want = input.contentFilter ? MODERATION_ON : MODERATION_OFF;
        try {
          const got = toEndpointInfo(endpointOf(await control.call(cr, 'GetEndpoint', { Id: id })), byteplusModels()).moderationStrategy;
          if (got !== want) warnings.push(T(`回读到的内容过滤策略是 ${got ?? '（未返回）'}，不是 ${want}：请到控制台确认`, `Read back moderation strategy ${got ?? '(missing)'} instead of ${want}; check in the console`));
        } catch {
          warnings.push(T('已提交修改，但回读失败；稍后刷新列表确认', 'Update sent, but reading it back failed; refresh later to confirm'));
        }
      }
      return c.json({ ok: true, warnings });
    } catch (err) {
      return fail(c, err);
    }
  });

  for (const op of ['start', 'stop'] as const) {
    app.post(`/endpoints/:id/${op}`, async (c) => {
      const cr = creds(c);
      if (cr instanceof Response) return cr;
      try {
        await control.call(cr, op === 'start' ? 'StartEndpoint' : 'StopEndpoint', { Id: checkEndpointId(c.req.param('id')) });
        invalidate();
        return c.json({ ok: true });
      } catch (err) {
        return fail(c, err);
      }
    });
  }

  app.delete('/endpoints/:id', async (c) => {
    const cr = creds(c);
    if (cr instanceof Response) return cr;
    const id = c.req.param('id');
    if (c.req.header(CONFIRM_DELETE_HEADER) !== id) {
      return c.json({ error: { code: 'confirmation_required', message: '删除前需要确认：请求头 X-Confirm-Delete 必须等于要删除的 Endpoint ID' } }, 428);
    }
    try {
      checkEndpointId(id);
      // 实测运行中不能删：先停止，等到 Stopped 再删
      const stopped = await stopAndWait(control, cr, id);
      if (!stopped) return c.json({ error: { code: 'stop_timeout', message: `等待停止超时（${STOP_WAIT_MS / 1000} 秒）：Endpoint 还没有停下，请稍后再删` } }, 504);
      await control.call(cr, 'DeleteEndpoint', { Id: id });
      invalidate();
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}

/** 不是 Stopped 就先停止并轮询，直到 Stopped；超时返回 false */
export async function stopAndWait(control: ArkControlClient, cr: ControlCredentials, id: string, waitMs = STOP_WAIT_MS, pollMs = STOP_POLL_MS): Promise<boolean> {
  const status = async () => String(endpointOf(await control.call(cr, 'GetEndpoint', { Id: id })).Status ?? '');
  if ((await status()) === 'Stopped') return true;
  await control.call(cr, 'StopEndpoint', { Id: id });
  const until = Date.now() + waitMs;
  for (;;) {
    if ((await status()) === 'Stopped') return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
