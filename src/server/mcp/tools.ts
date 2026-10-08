import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TaskRecord } from '../../shared/task/records.js';
import { isTerminal } from '../../shared/task/status.js';
import type { AppDeps } from '../app.js';
import type { Catalog } from '../tasks/task-service.js';
import { TaskInputError } from '../tasks/task-service.js';
import { describeField, McpInputError, summarizeTask, toForm, type McpGenerateInput } from './convert.js';
import { ControlPlaneError } from '../controlplane/ark-control.js';
import { ControlNotConfiguredError } from '../controlplane/directory.js';
import type { EndpointInfo } from '../../shared/api-contract.js';
import type { ModelDef } from '../../shared/catalog/types.js';
import { makeThumbnail } from '../media/thumbnail.js';

type ToolResult = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };

const ok = (data: unknown, extra: ToolResult['content'] = []): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }, ...extra] });
const fail = (message: string, details?: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: message, ...(details ? { details } : {}) }, null, 2) }], isError: true });

/** 内联缩略图上限：控制 MCP 输出的 token 消耗 */
const INLINE_IMAGE_MAX_BYTES = 200 * 1024;

const assetSpec = z
  .record(z.string(), z.array(z.string()))
  .optional()
  .describe('素材，按槽位 id 分组。每项可以是：本地绝对路径、https:// 链接、asset://<素材ID>、mm_file://<file_id>、task:<任务id>#<结果序号>（复用历史结果）。槽位 id 见 get_model_schema');

const generateShape = {
  model_id: z.string().describe('模型 id，例如 byteplus/seedream-5-0-pro（用 list_models 查）'),
  mode: z.string().optional().describe('模式 id；不填用模型的第一个模式'),
  prompt: z.string().optional().describe('提示词。引用素材时按 get_model_schema 给出的写法（如 "Image 1"、"@Video 1"）'),
  params: z.record(z.string(), z.unknown()).optional().describe('参数，键为 get_model_schema 返回的字段 key（不是 wire 名）'),
  assets: assetSpec,
  model_override: z
    .string()
    .optional()
    .describe('BytePlus：通过推理接入点（ep-…）调用，例如关闭了内容过滤的那个；用 list_endpoints 查可用的。配置了 AK/SK 时会校验它绑定的是不是同一个模型'),
  credential: z
    .enum(['subscription', 'paygo'])
    .optional()
    .describe('MiniMax：subscription 用订阅 Key（从 M Plan / Token Plan 额度扣），paygo 用按量 Key（扣余额）；不填时有订阅 Key 用订阅'),
  temp_host: z.enum(['uguu', 'tmpfiles']).optional().describe('本地视频上传用的公共临时托管站（默认 uguu）'),
  preset_id: z.string().optional().describe('先套用这个预设的模式与参数（list_presets 查），再用 params 覆盖'),
};

export function registerTools(server: McpServer, deps: AppDeps, catalog: Catalog): void {
  const svc = deps.services.tasks;
  const outputsRoot = deps.config.paths.outputs;
  const conv = { store: deps.store, assets: deps.services.assets };

  const resolveModel = (modelId: string) => {
    const found = catalog.getModel(modelId);
    if (!found) throw new McpInputError(`未知模型 ${modelId}；用 list_models 查看可用模型`);
    return found;
  };

  /**
   * 校验 model_override（ep-…）：配了 AK/SK 时确认账号下有这个 Endpoint、绑定的是同一个模型、没有停止。
   * 没配 AK/SK 或控制面暂时不可用时不拦（只是少了这层保护）
   */
  const checkEndpoint = async (model: ModelDef, override: string | undefined): Promise<EndpointInfo | null> => {
    if (!override) return null;
    if (!model.allowModelOverride) throw new McpInputError(`${model.id} 不支持 model_override`);
    if (!override.startsWith('ep-')) return null;
    let all: EndpointInfo[];
    try {
      all = await deps.services.endpoints.list();
    } catch {
      return null;
    }
    const ep = all.find((e) => e.id === override);
    if (!ep) throw new McpInputError(`账号下没有 Endpoint ${override}；用 list_endpoints 查看可用的`);
    if (ep.modelId && ep.modelId !== model.id) {
      throw new McpInputError(`Endpoint ${override}（${ep.name}）绑定的是 ${ep.modelId}，不是 ${model.id}：请把 model_id 改成 ${ep.modelId}，或换一个 Endpoint`);
    }
    if (/^stopped$/i.test(ep.status)) throw new McpInputError(`Endpoint ${override}（${ep.name}）已停止，先在平台设置页启动它`);
    return ep;
  };
  const endpointSummary = (e: EndpointInfo) => ({ endpoint_id: e.id, name: e.name, status: e.status, content_filter: e.contentFilter });

  /** 套用预设：预设的模式 / 参数 / 提示词作为默认，调用方传的值覆盖 */
  const applyPreset = <T extends { preset_id?: string | undefined; model_id: string; mode?: string | undefined; params?: Record<string, unknown> | undefined; prompt?: string | undefined }>(input: T): T => {
    if (!input.preset_id) return input;
    const p = deps.store.getPreset(input.preset_id);
    if (!p) throw new McpInputError(`预设不存在：${input.preset_id}`);
    if (p.modelId !== input.model_id) throw new McpInputError(`预设 ${p.name} 属于模型 ${p.modelId}，与 model_id 不一致`);
    return { ...input, mode: input.mode ?? p.modeId, params: { ...p.values, ...(input.params ?? {}) }, prompt: input.prompt ?? p.prompt ?? undefined };
  };

  const toolError = (err: unknown): ToolResult => {
    if (err instanceof TaskInputError) return fail(err.i18n.zh, { code: err.code, issues: err.issues.map((i) => ({ id: i.id, severity: i.severity, message: i.message.zh, ...(i.fix ? { fix: i.fix.patch } : {}) })) });
    if (err instanceof McpInputError) return fail(err.message);
    return fail(err instanceof Error ? err.message : String(err));
  };

  /** 内联缩略图：小图原样返回；大图有 ffmpeg 时缩成 512px JPEG，否则跳过（路径照样返回） */
  const imageBlocks = async (task: TaskRecord): Promise<ToolResult['content']> => {
    const out: ToolResult['content'] = [];
    let skipped = 0;
    for (const r of task.results) {
      if (r.kind !== 'image' || !r.path || !r.mime) continue;
      if (out.length >= 4) break;
      const abs = join(outputsRoot, r.path);
      if (/^image\/(png|jpeg|webp|gif)$/.test(r.mime) && (r.bytes ?? Infinity) <= INLINE_IMAGE_MAX_BYTES) {
        out.push({ type: 'image', data: (await readFile(abs)).toString('base64'), mimeType: r.mime });
        continue;
      }
      const thumb = await makeThumbnail(abs, 512).catch(() => null);
      if (thumb && thumb.length <= INLINE_IMAGE_MAX_BYTES) out.push({ type: 'image', data: thumb.toString('base64'), mimeType: 'image/jpeg' });
      else skipped += 1;
    }
    if (skipped) out.push({ type: 'text', text: `另有 ${skipped} 张图片较大且本机没有 ffmpeg 生成缩略图，请按 files[].path 打开` });
    return out;
  };

  /** 等待任务结束（或超时），期间按 progressToken 推送进度 */
  const waitFor = async (taskId: string, seconds: number, ctx: { mcpReq: { signal: AbortSignal; _meta?: Record<string, unknown>; notify: (n: { method: string; params?: Record<string, unknown> }) => Promise<void> } }): Promise<TaskRecord | null> => {
    const deadline = Date.now() + seconds * 1000;
    const token = ctx.mcpReq._meta?.progressToken as string | number | undefined;
    let tick = 0;
    for (;;) {
      const t = deps.store.getTask(taskId);
      if (!t || isTerminal(t.status) || Date.now() >= deadline || ctx.mcpReq.signal.aborted) return t;
      if (token !== undefined) {
        tick += 1;
        await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken: token, progress: tick, message: `任务 ${t.status}（已等待 ${Math.round((seconds * 1000 - (deadline - Date.now())) / 1000)} 秒）` } }).catch(() => undefined);
      }
      await new Promise<void>((resolve) => {
        const unsub = deps.services.events.subscribe((ev) => {
          if (ev.type === 'task.updated' && ev.task.id === taskId) done();
        });
        const timer = setTimeout(done, Math.min(10_000, Math.max(0, deadline - Date.now())));
        function done() {
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    }
  };

  server.registerTool(
    'list_endpoints',
    {
      title: '列出推理接入点',
      description:
        'BytePlus：列出账号下的推理接入点（Endpoint），可按 model_id 只看绑定该模型的。生成时把 endpoint_id 填进 model_override，就会通过它调用（例如关闭了内容过滤的 Endpoint）。需要先在平台设置页配置 AK/SK。',
      inputSchema: z.object({
        model_id: z.string().optional().describe('只列出绑定这个模型的 Endpoint，例如 byteplus/seedream-5-0-flash'),
        refresh: z.boolean().optional().describe('跳过 15 秒缓存，重新向控制面查询'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ model_id, refresh }) => {
      try {
        const all = await deps.services.endpoints.list(refresh ? { refresh: true } : {});
        const items = model_id ? all.filter((e) => e.modelId === model_id) : all;
        return ok(
          items.map((e) => ({
            ...endpointSummary(e),
            model_id: e.modelId,
            foundation_model: e.foundationModel ? `${e.foundationModel.name}-${e.foundationModel.version}` : null,
            ...(e.rateLimit && e.rateLimit.rpm > 0 ? { rate_limit: e.rateLimit } : {}),
          })),
        );
      } catch (err) {
        if (err instanceof ControlNotConfiguredError) return fail(`${err.message}（只影响 Endpoint 列表；不用 Endpoint 时可以直接生成）`);
        if (err instanceof ControlPlaneError) return fail(`控制面返回错误：${err.code} ${err.message}`);
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'list_models',
    {
      title: '列出模型',
      description: '列出可用的图像 / 视频模型、模式与素材槽。生成前先用它选 model_id 和 mode。',
      inputSchema: z.object({ include_hidden: z.boolean().optional().describe('包含已下线 / 即将下线的模型') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_hidden }) =>
      ok(
        catalog
          .listModels({ includeHidden: include_hidden ?? false })
          .map(({ provider, model }) => ({
            model_id: model.id,
            provider: provider.id,
            name: model.label.zh,
            api_model: model.apiModel,
            output: model.output,
            kind: model.kind,
            lifecycle: model.lifecycle.status,
            modes: model.modes.filter((m) => m.entry !== 'derived').map((m) => ({ id: m.id, name: m.label.zh, slots: m.slots.map((s) => `${s.id}(${s.kind} ${s.min}-${s.max})`) })),
          })),
      ),
  );

  server.registerTool(
    'get_model_schema',
    {
      title: '模型参数说明',
      description: '返回某个模型的全部模式、素材槽规格、参数字段（类型、默认值、范围、枚举）和提示词规则。params 的键用这里的字段 key。',
      inputSchema: z.object({ model_id: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ model_id }) => {
      try {
        const { provider, model } = resolveModel(model_id);
        const modeIds = model.modes.map((m) => m.id);
        return ok({
          model_id: model.id,
          provider: provider.id,
          api_model: model.apiModel,
          kind: model.kind,
          docs: model.docs.map((d) => d.url),
          modes: model.modes.map((m) => ({
            id: m.id,
            name: m.label.zh,
            ...(m.hint ? { hint: m.hint.zh } : {}),
            ...(m.entry === 'derived' ? { derived: true } : {}),
            ...(m.experimental ? { experimental: true } : {}),
            locked: Object.fromEntries(Object.entries(m.locked ?? {}).map(([k, v]) => [k, { value: v.value, reason: v.reason.zh }])),
            prompt: { required: typeof m.prompt.required === 'function' ? '视参数而定' : m.prompt.required, ...(m.prompt.maxChars ? { max_chars: m.prompt.maxChars } : {}), ...(m.prompt.refLabel ? { reference_syntax: `${m.prompt.refLabel('image', 1)} / ${m.prompt.refLabel('video', 1)} / ${m.prompt.refLabel('audio', 1)}` } : { reference_syntax: 'Image 1 / Video 1 / Audio 1' }), ...(m.prompt.hint ? { hint: m.prompt.hint.zh } : {}) },
            slots: m.slots.map((s) => ({ id: s.id, kind: s.kind, role: s.role, min: s.min, max: s.max, formats: s.spec.formats, max_mb: Math.round(s.spec.maxBytes / 1048576), ...(s.spec.durationSec ? { duration_sec: s.spec.durationSec } : {}), ...(s.spec.aspect ? { aspect: s.spec.aspect } : {}), ...(s.spec.pixels ? { pixels: s.spec.pixels } : {}) })),
          })),
          fields: model.fields.filter((f) => (f.send ?? 'always') !== 'never' || f.type === 'enum').map((f) => describeField(f, modeIds)),
          constraints: model.constraints.map((c) => c.id),
          tip: '先用 preview_request 检查参数和请求体，再调用 generate_image / create_video_task。',
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  const generateInput = z.object(generateShape);

  server.registerTool(
    'preview_request',
    {
      title: '预览请求',
      description: '不提交：校验参数并返回问题列表、最终请求体、curl、预估费用，以及是否需要把本地视频上传到公共托管站。',
      inputSchema: generateInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (raw) => {
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        const ep = await checkEndpoint(model, input.model_override);
        const form = await toForm(input as McpGenerateInput, provider, model, conv);
        const p = svc.preview(form, input.temp_host ? { tempHost: input.temp_host } : {});
        return ok({
          ...(ep ? { endpoint: endpointSummary(ep) } : {}),
          can_submit: p.canSubmit,
          issues: p.issues.map((i) => ({ id: i.id, severity: i.severity, message: i.message.zh, ...(i.fix ? { fix: i.fix.patch } : {}) })),
          request: p.request,
          estimated_cost: p.cost ? { usd: p.cost.amount, basis: p.cost.basis.zh } : null,
          ...(p.credential
            ? {
                credential: {
                  ...p.credential,
                  note: p.credential.kind === 'subscription' ? '订阅 Key：按量价折算，从订阅额度扣，不扣余额' : '按量 Key：扣账户余额',
                },
              }
            : {}),
          public_upload: p.uploads.required ? { required: true, host: p.uploads.target.id, files: p.uploads.files, note: '提交时需要 allow_public_upload: true' } : { required: false },
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  const withConsent = generateInput.extend({
    allow_public_upload: z.boolean().optional().describe('本地视频需要上传到公共临时托管站（任何人可凭链接下载）时必须显式设为 true'),
  });

  server.registerTool(
    'generate_image',
    {
      title: '生成图片',
      description: '提交图像生成（同步，完成后返回本地文件路径与缩略图）。会产生费用，返回里有预估费用。',
      inputSchema: withConsent,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (raw) => {
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        if (model.output !== 'image') return fail(`${model.id} 是视频模型，请用 create_video_task`);
        await checkEndpoint(model, input.model_override);
        const form = await toForm(input as McpGenerateInput, provider, model, conv);
        if (model.fields.some((f) => f.key === 'stream')) form.values.stream = false;
        const task = await svc.submit(form, 'mcp', { ...(input.allow_public_upload ? { publicUploadConsent: true } : {}), ...(input.temp_host ? { tempHost: input.temp_host } : {}) });
        return ok(summarizeTask(task, outputsRoot), await imageBlocks(task));
      } catch (err) {
        if (err instanceof TaskInputError && err.code === 'consent_required') return fail(`${err.i18n.zh}。如确认可以公开，请带 allow_public_upload: true 重试；或改用 https 链接 / asset:// / task:<id>#<n>。`);
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'create_video_task',
    {
      title: '创建视频任务',
      description: '提交视频生成（异步）。返回 task_id；可选 wait_seconds 等待完成（期间推送进度），没完成就之后用 get_task 查。会产生费用。',
      inputSchema: withConsent.extend({ wait_seconds: z.number().int().min(0).max(540).optional().describe('最多等待多少秒（0–540），默认不等') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (raw, ctx) => {
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        if (model.output !== 'video') return fail(`${model.id} 是图像模型，请用 generate_image`);
        await checkEndpoint(model, input.model_override);
        const form = await toForm(input as McpGenerateInput, provider, model, conv);
        let task = await svc.submit(form, 'mcp', { ...(input.allow_public_upload ? { publicUploadConsent: true } : {}), ...(input.temp_host ? { tempHost: input.temp_host } : {}) });
        if (input.wait_seconds && !isTerminal(task.status)) task = (await waitFor(task.id, input.wait_seconds, ctx as never)) ?? task;
        return ok({ ...summarizeTask(task, outputsRoot), ...(isTerminal(task.status) ? {} : { next: '用 get_task 查询进度（可带 wait_seconds）' }) });
      } catch (err) {
        if (err instanceof TaskInputError && err.code === 'consent_required') return fail(`${err.i18n.zh}。如确认可以公开，请带 allow_public_upload: true 重试；或改用 https 链接 / asset:// / task:<id>#<n>。`);
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'get_task',
    {
      title: '查询任务',
      description: '查询任务状态与结果文件。可选 wait_seconds 等待完成；include_images 返回图片缩略图。',
      inputSchema: z.object({ task_id: z.string(), wait_seconds: z.number().int().min(0).max(540).optional(), include_images: z.boolean().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ task_id, wait_seconds, include_images }, ctx) => {
      let task = deps.store.getTask(task_id);
      if (!task) return fail(`任务不存在：${task_id}`);
      if (wait_seconds && !isTerminal(task.status)) task = (await waitFor(task_id, wait_seconds, ctx as never)) ?? task;
      return ok(summarizeTask(task, outputsRoot), include_images ? await imageBlocks(task) : []);
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: '列出任务',
      description: '列出本地任务历史（网页与 MCP 共享），按创建时间倒序。',
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional(), status: z.string().optional(), provider: z.string().optional(), model_id: z.string().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, status, provider, model_id }) =>
      ok(deps.store.listTasks({ limit: limit ?? 20, ...(status ? { status } : {}), ...(provider ? { providerId: provider } : {}), ...(model_id ? { modelId: model_id } : {}) }).map((t) => ({ ...summarizeTask(t, outputsRoot), prompt: t.form.prompt.slice(0, 120) }))),
  );

  server.registerTool(
    'cancel_task',
    {
      title: '取消 / 删除云端任务',
      description: '排队中的视频任务：取消；已结束的任务：删除服务商那边的记录（本地文件保留）。生成中的任务不能取消。',
      inputSchema: z.object({ task_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const r = await svc.cancelOrDeleteRemote(task_id);
        return r.ok ? ok({ ok: true, task: r.task ? summarizeTask(r.task, outputsRoot) : null }) : fail(r.error?.message ?? '操作失败', r.error);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'list_presets',
    {
      title: '列出预设',
      description: '列出保存的参数预设（网页「预设与模板」里维护）。生成工具可用 preset_id 套用。',
      inputSchema: z.object({ model_id: z.string().optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ model_id }) => ok(deps.store.listPresets(model_id).map((p) => ({ preset_id: p.id, name: p.name, model_id: p.modelId, mode: p.modeId, params: p.values, ...(p.prompt ? { prompt: p.prompt } : {}) }))),
  );
}
