import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { TaskRecord } from '../../shared/task/records.js';
import { isTerminal } from '../../shared/task/status.js';
import type { AppDeps } from '../app.js';
import type { Catalog, SubmitOptions } from '../tasks/task-service.js';
import { TaskInputError } from '../tasks/task-service.js';
import { defaultModeId, describeField, McpInputError, summarizeTask, toForm, type McpGenerateInput } from './convert.js';
import { evaluate } from '../../shared/engine/evaluate.js';
import { ControlPlaneError } from '../controlplane/ark-control.js';
import { ControlNotConfiguredError } from '../controlplane/directory.js';
import type { EndpointInfo } from '../../shared/api-contract.js';
import type { FormInput, ModeDef, ModelDef, PromptGuide, ProviderDef } from '../../shared/catalog/types.js';
import { imageBlocks, type ContentBlock } from './images.js';
import { beforeDeadline, callBudgetSeconds, callDeadline, responseDeadline, WAIT_DEFAULT_SECONDS, waitWithin } from './timing.js';

type ToolResult = { content: ContentBlock[]; isError?: boolean };

const ok = (data: unknown, extra: ToolResult['content'] = []): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }, ...extra] });
const fail = (message: string, details?: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ error: message, ...(details ? { details } : {}) }, null, 2) }], isError: true });

/** 提示词里引用素材的写法：只列这个模式素材槽里实际有的类型（纯图像模型就只有 Image n） */
function referenceSyntax(m: ModeDef): { reference_syntax?: string } {
  if (m.prompt.refs === false) return {};
  const kinds = [...new Set(m.slots.map((s) => s.kind))];
  if (kinds.length === 0) return {};
  const label = m.prompt.refLabel ?? ((k: string, n: number) => `${k === 'image' ? 'Image' : k === 'video' ? 'Video' : 'Audio'} ${n}`);
  return { reference_syntax: [...new Set(kinds.map((k) => label(k, 1)))].join(' / ') };
}

/** 官方提示词指南 → 给 agent 看的精简结构（中文） */
function describeGuide(g: PromptGuide) {
  return {
    title: g.title.zh,
    source: g.source.url,
    revision: g.source.revision,
    checked_at: g.source.checkedAt,
    summary: g.summary.zh,
    ...(g.modes?.length ? { applies_to_modes: g.modes } : {}),
    rules: g.rules.map((r) => ({ rule: r.text.zh, ...(r.modes?.length ? { modes: r.modes } : {}) })),
    ...(g.examples?.length ? { examples: g.examples.map((e) => ({ prompt: e.prompt, note: e.note, ...(e.modes?.length ? { modes: e.modes } : {}) })) } : {}),
  };
}

/** 生成工具默认等到出结果：Claude Code 会把超过 2 分钟的工具调用自动转到后台，用户可以继续对话、结果自动回到对话（时间预算见 timing.ts） */
const waitSecondsDescription = () =>
  `最多等待多少秒（0–540），默认 ${WAIT_DEFAULT_SECONDS}。传 0 不等生成：本地素材处理完、提交后就返回 task_id（视频会等上游收下任务）。整次调用（含素材处理）控制在约 ${callBudgetSeconds()} 秒内：前面花掉的时间从等待里扣除，素材上传拖到预算用完时先返回 task_id、后台继续。需要客户端的工具超时不短于 10 分钟（按 docs/agent-setup.md 接入即为 600 秒）`;

/** 提交前的准备（校验 Endpoint、导入本地素材）超出调用预算时的说明 */
const PREPARE_TIMEOUT = '准备素材超时（导入本地文件或校验 Endpoint 太慢），没有提交任务，也不会计费：检查素材路径（例如是否在网络盘上）后重试';

/** 还没出结果时给 agent 的下一步提示；stalled：任务不会再自己往下走 */
const pendingNext = (t: TaskRecord, what: string, stalled: boolean): string => {
  if (t.status === 'submit_unknown') return '提交结果未知（例如提交时网络中断）：上游可能已经建好任务并计费。请到服务商控制台核对，确认前不要重新提交';
  if (t.status === 'unknown') {
    return stalled
      ? '任务状态未知（无法继续查询，例如超出了查询窗口），平台不再自动跟进：请到服务商控制台核对，不要重新提交'
      : '任务状态暂时未知，平台正在重查：用 get_task 稍后再查（可带 wait_seconds 继续等）。不要重新提交，以免重复计费';
  }
  if (t.status === 'resolving_assets') return `${what}任务已登记，素材还在上传、后台会继续提交：用 get_task 查询（可带 wait_seconds 继续等）。不要重新提交，以免重复计费`;
  // 异步任务停在 submitting：请求还在发给服务商（本地素材内联成 base64 时请求体可能很大，上传要几分钟）
  if (t.status === 'submitting' && t.kind === 'async') return `${what}任务还在提交：正在把请求发给服务商（本地素材内联较大时要几分钟），后台会继续：用 get_task 查询（可带 wait_seconds 继续等）。不要重新提交，以免重复计费`;
  return `${what}还在生成：用 get_task 查询（可带 wait_seconds 继续等）。不要重新提交，以免重复计费`;
};

const assetSpec = z
  .record(z.string(), z.array(z.string()))
  .optional()
  .describe(
    '素材，按槽位 id 分组。每项可以是：本地绝对路径、https:// 链接、asset://<素材ID>、mm_file://<file_id>、task:<任务id>#<结果序号>（复用历史结果）。槽位 id 见 get_model_schema。' +
      'BytePlus 的本地图片 / 音频会以 base64 内联进请求体，几 MB 以上的大图上传可能要几分钟：能用 https 链接或 task:<id>#<n> 就优先用（本地文件就是以前的生成结果、原始链接还有效时，平台会自动改用原始链接）',
  );

const generateShape = {
  model_id: z.string().describe('模型 id，例如 byteplus/seedream-5-0-pro（用 list_models 查）'),
  mode: z.string().optional().describe('模式 id；不填用默认模式（get_model_schema 的 modes 里标了 default: true 的那个）'),
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

  /**
   * 在调用预算内提交，返回任务 id：素材上传、提交拖到预算用完时，先返回已登记的任务（后台继续处理，不会重复提交）。
   * 预算内出的错（参数、素材、最终检查）照常抛出，以 isError 返回。
   * done 在后台处理结束时兑现（同步图像是出图落盘，异步视频是上游建好任务）；超预算先返回时为 null
   */
  /**
   * 任务不会再自己往下走，等也没用：提交结果未知；或状态未知且调度器没在重查
   * （服务重启恢复、「立即重查」时会把 unknown 查回正常状态，那时要接着等）
   */
  const isStalled = (t: TaskRecord): boolean => t.status === 'submit_unknown' || (t.status === 'unknown' && !deps.services.scheduler.isTracking(t.id));
  /** 提交请求正在上传：「已上传 x / y MB（约 z KB/s）」 */
  const uploadText = (taskId: string): string | null => {
    const u = svc.uploadProgress(taskId);
    if (!u) return null;
    const sec = Math.max(1, (Date.now() - u.startedAt) / 1000);
    const mb = (n: number) => (n / 1048576).toFixed(1);
    return u.sent >= u.total ? `请求体 ${mb(u.total)} MB 已发完，等服务商响应` : `已上传 ${mb(u.sent)} / ${mb(u.total)} MB（约 ${Math.round(u.sent / 1024 / sec)} KB/s）`;
  };
  const nextHint = (t: TaskRecord, what: string): string => {
    const base = pendingNext(t, what, isStalled(t));
    const up = t.status === 'submitting' ? uploadText(t.id) : null;
    return up ? `${base}（${up}）` : base;
  };

  /** 提交前的准备也受调用预算限制：超时返回 null，不再提交（后台导入完也不会提交、不计费） */
  const prepareWithin = (input: McpGenerateInput, provider: ProviderDef, model: ModelDef, startedAt: number): Promise<FormInput | null> =>
    beforeDeadline(
      (async () => {
        await checkEndpoint(model, input.model_override);
        return toForm(input, provider, model, conv);
      })(),
      callDeadline(startedAt),
    );

  const startWithin = async (form: FormInput, opts: SubmitOptions, startedAt: number): Promise<{ id: string; done: Promise<TaskRecord> | null }> => {
    const registered: { id?: string } = {};
    const started = svc.start(form, 'mcp', { ...opts, onRegistered: (id) => (registered.id = id) });
    const settled = await beforeDeadline(started, callDeadline(startedAt));
    if (settled) return { id: settled.task.id, done: settled.done };
    if (registered.id) return { id: registered.id, done: null };
    // 预算用完时还没建好任务记录（几乎不会）：没有 task_id 可返回，只能等它
    const s = await started;
    return { id: s.task.id, done: s.done };
  };
  const consentOpts = (input: { allow_public_upload?: boolean | undefined; temp_host?: string | undefined }): SubmitOptions => ({
    ...(input.allow_public_upload ? { publicUploadConsent: true } : {}),
    ...(input.temp_host ? { tempHost: input.temp_host } : {}),
  });

  /** 等待任务结束（或超时），期间按 progressToken 推送进度 */
  const waitFor = async (taskId: string, seconds: number, ctx: { mcpReq: { signal: AbortSignal; _meta?: Record<string, unknown>; notify: (n: { method: string; params?: Record<string, unknown> }) => Promise<void> } }): Promise<TaskRecord | null> => {
    const deadline = Date.now() + seconds * 1000;
    const token = ctx.mcpReq._meta?.progressToken as string | number | undefined;
    let tick = 0;
    for (;;) {
      const t = deps.store.getTask(taskId);
      if (!t || isTerminal(t.status) || isStalled(t) || Date.now() >= deadline || ctx.mcpReq.signal.aborted) return t;
      if (token !== undefined) {
        tick += 1;
        const up = t.status === 'submitting' ? uploadText(taskId) : null;
        await ctx.mcpReq
          .notify({ method: 'notifications/progress', params: { progressToken: token, progress: tick, message: `任务 ${t.status}${up ? `：${up}` : ''}（已等待 ${Math.round((seconds * 1000 - (deadline - Date.now())) / 1000)} 秒）` } })
          .catch(() => undefined);
      }
      await new Promise<void>((resolve) => {
        const unsub = deps.services.events.subscribe((ev) => {
          if ((ev.type === 'task.updated' && ev.task.id === taskId) || (ev.type === 'task.progress' && ev.taskId === taskId)) done();
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
        const defaultMode = defaultModeId(model);
        // 默认值随上下文变化的字段（例如尺寸）：按模式求值一遍，给出不传时实际发送的值
        const dynamicKeys = model.fields.filter((f) => typeof f.default === 'function').map((f) => f.key);
        const defaultsByField: Record<string, Record<string, unknown>> = {};
        for (const m of dynamicKeys.length ? model.modes : []) {
          if (m.entry === 'derived') continue;
          const ev = evaluate(provider, model, { providerId: provider.id, modelId: model.id, modeId: m.id, values: {}, slots: {}, prompt: '' });
          for (const k of dynamicKeys) {
            const st = ev.fields[k];
            if (st?.visible && st.value !== undefined) (defaultsByField[k] ??= {})[m.id] = st.value;
          }
        }
        return ok({
          model_id: model.id,
          provider: provider.id,
          api_model: model.apiModel,
          kind: model.kind,
          docs: model.docs.map((d) => d.url),
          modes: model.modes.map((m) => ({
            id: m.id,
            name: m.label.zh,
            ...(m.id === defaultMode ? { default: true } : {}),
            ...(m.hint ? { hint: m.hint.zh } : {}),
            ...(m.entry === 'derived' ? { derived: true } : {}),
            ...(m.experimental ? { experimental: true } : {}),
            locked: Object.fromEntries(Object.entries(m.locked ?? {}).map(([k, v]) => [k, { value: v.value, reason: v.reason.zh }])),
            prompt: { required: typeof m.prompt.required === 'function' ? '视参数而定' : m.prompt.required, ...(m.prompt.maxChars ? { max_chars: m.prompt.maxChars } : {}), ...referenceSyntax(m), ...(m.prompt.hint ? { hint: m.prompt.hint.zh } : {}) },
            slots: m.slots.map((s) => ({ id: s.id, kind: s.kind, role: s.role, min: s.min, max: s.max, formats: s.spec.formats, max_mb: Math.round(s.spec.maxBytes / 1048576), ...(s.spec.durationSec ? { duration_sec: s.spec.durationSec } : {}), ...(s.spec.aspect ? { aspect: s.spec.aspect } : {}), ...(s.spec.pixels ? { pixels: s.spec.pixels } : {}) })),
          })),
          fields: model.fields.filter((f) => (f.send ?? 'always') !== 'never' || f.type === 'enum').map((f) => describeField(f, modeIds, defaultsByField[f.key])),
          constraints: model.constraints.map((c) => c.id),
          // BytePlus 官方提示词指南的要点（提炼；applies_to_modes 是整份指南适用的模式，rules 里的 modes 表示只适用于这些模式）
          ...(model.promptGuides?.length ? { prompt_guides: model.promptGuides.map(describeGuide) } : {}),
          tip: `${model.promptGuides?.length ? '写提示词前先看 prompt_guides（官方提示词指南要点）；' : ''}先用 preview_request 检查参数、请求体和费用，再调用 generate_image / create_video_task。`,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  const generateInput = z.object(generateShape);

  const withConsent = generateInput.extend({
    allow_public_upload: z
      .boolean()
      .optional()
      .describe(
        '同意把本地素材上传到公共临时托管站（任何人可凭链接下载，uguu 保留 3 小时 / tmpfiles 24 小时，不能删除）。BytePlus 的本地视频必须这样才能提交；本地图片设为 true 时也先上传、请求里只放链接，提交快得多，不设就按 base64 内联（几 MB 的图要几十秒到几分钟）',
      ),
  });

  /** 没同意公开上传、又有本地图片要内联时，提示可以加快 */
  const publicUploadHint = (form: FormInput, input: { allow_public_upload?: boolean | undefined; temp_host?: string | undefined }): { public_upload_hint?: string } => {
    if (input.allow_public_upload) return {};
    const n = svc.uploadPlan(form, consentOpts(input)).files.filter((f) => f.optional).length;
    return n ? { public_upload_hint: `${n} 张本地图片按 base64 内联提交（请求体大、上传慢）。下次可以带 allow_public_upload: true，先传到公共临时托管站再提交（公开链接，保留 3 小时）` } : {};
  };

  server.registerTool(
    'preview_request',
    {
      title: '预览请求',
      description: '不提交、不计费：校验参数并返回问题列表、最终请求体、curl（Key 用环境变量占位）、预估费用，以及哪些本地素材会上传到公共托管站（带 allow_public_upload 时按同意后的请求体预览）。传本地文件路径时会把文件导入平台素材库（按内容去重），所以不标为只读。',
      inputSchema: withConsent,
      // 不是只读：本地路径的素材会导入素材库（幂等：同一文件只存一份）
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (raw) => {
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        const ep = await checkEndpoint(model, input.model_override);
        const form = await toForm(input as McpGenerateInput, provider, model, conv);
        const p = svc.preview(form, consentOpts(input));
        return ok({
          ...(ep ? { endpoint: endpointSummary(ep) } : {}),
          can_submit: p.canSubmit,
          issues: p.issues.map((i) => ({ id: i.id, severity: i.severity, message: i.message.zh, ...(i.fix ? { fix: i.fix.patch } : {}) })),
          // 平台内部的接口 id（endpointId）不给 agent：容易和 BytePlus 推理接入点（ep-…）混淆
          request: { method: p.request.method, url: p.request.url, body: p.request.body, body_bytes: p.request.bodyBytes, stream: p.request.stream },
          curl: p.curl,
          ...(p.notes.length ? { notes: p.notes.map((n) => n.zh) } : {}),
          estimated_cost: p.cost ? { usd: p.cost.amount, basis: p.cost.basis.zh, confidence: p.cost.confidence } : null,
          ...(p.credential
            ? {
                credential: {
                  ...p.credential,
                  note: p.credential.kind === 'subscription' ? '订阅 Key：按量价折算，从订阅额度扣，不扣余额' : '按量 Key：扣账户余额',
                },
              }
            : {}),
          public_upload: p.uploads.files.length
            ? {
                required: p.uploads.required,
                host: p.uploads.target.id,
                files: p.uploads.files.map((f) => ({ name: f.name, bytes: f.bytes, ...(f.optional ? { optional: true } : {}) })),
                note: p.uploads.required
                  ? '本地视频必须公开上传：提交时需要 allow_public_upload: true'
                  : 'optional 的本地图片：带 allow_public_upload: true 会先传到公共托管站、请求里只放链接（快）；不带就按 base64 内联（慢）',
              }
            : { required: false },
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'generate_image',
    {
      title: '生成图片',
      description: `提交图像生成并等到出结果（最多 wait_seconds 秒，默认 ${WAIT_DEFAULT_SECONDS}）：完成就返回本地文件路径与缩略图；等不到就返回 task_id，之后用 get_task 继续等。出图常要 1–3 分钟。在 Claude Code 主对话里，超过 2 分钟的调用会自动转到后台：用户可以继续对话，结果完成后自动回到对话（请在主对话直接调用，子代理里的调用不会转后台）。客户端超时或断开不会取消已提交的任务（可能仍在执行并计费）：先用 get_task / list_tasks 查，不要重新提交。会产生费用，返回里有预估费用。`,
      inputSchema: withConsent.extend({
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(540)
          .optional()
          .describe(waitSecondsDescription()),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (raw, ctx) => {
      const startedAt = Date.now();
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        if (model.output !== 'image') return fail(`${model.id} 是视频模型，请用 create_video_task`);
        const form = await prepareWithin(input as McpGenerateInput, provider, model, startedAt);
        if (!form) return fail(PREPARE_TIMEOUT);
        if (model.fields.some((f) => f.key === 'stream')) form.values.stream = false;
        // 不等上游完成就拿到任务：整次调用有时间预算，客户端超时也不会丢掉 task_id
        const { id } = await startWithin(form, consentOpts(input), startedAt);
        const wait = waitWithin(input.wait_seconds ?? WAIT_DEFAULT_SECONDS, startedAt);
        const task = (wait > 0 ? await waitFor(id, wait, ctx as never) : null) ?? deps.store.getTask(id);
        if (!task) return fail(`任务不存在：${id}`);
        const hint = publicUploadHint(form, input);
        if (!isTerminal(task.status)) return ok({ ...summarizeTask(task, outputsRoot), next: nextHint(task, '图片'), ...hint });
        return ok({ ...summarizeTask(task, outputsRoot), ...hint }, await imageBlocks(task, outputsRoot, responseDeadline(startedAt)));
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
      description: `提交视频生成并等到出结果（最多 wait_seconds 秒，默认 ${WAIT_DEFAULT_SECONDS}，期间推送进度）；等不到就返回 task_id，之后用 get_task 继续等。在 Claude Code 主对话里，超过 2 分钟的调用会自动转到后台：用户可以继续对话，结果完成后自动回到对话（请在主对话直接调用，子代理里的调用不会转后台）。客户端超时或断开不会取消已提交的任务（可能仍在执行并计费）：先用 get_task / list_tasks 查，不要重新提交。会产生费用。`,
      inputSchema: withConsent.extend({
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(540)
          .optional()
          .describe(waitSecondsDescription()),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (raw, ctx) => {
      const startedAt = Date.now();
      try {
        const input = applyPreset(raw);
        const { provider, model } = resolveModel(input.model_id);
        if (model.output !== 'video') return fail(`${model.id} 是图像模型，请用 generate_image`);
        const form = await prepareWithin(input as McpGenerateInput, provider, model, startedAt);
        if (!form) return fail(PREPARE_TIMEOUT);
        const { id, done } = await startWithin(form, consentOpts(input), startedAt);
        const wait = waitWithin(input.wait_seconds ?? WAIT_DEFAULT_SECONDS, startedAt);
        // 不等生成时也等上游收下任务（拿到排队状态或提交错误），同样不超出预算
        const task = (wait > 0 ? await waitFor(id, wait, ctx as never) : done ? await beforeDeadline(done, callDeadline(startedAt)) : null) ?? deps.store.getTask(id);
        if (!task) return fail(`任务不存在：${id}`);
        return ok({ ...summarizeTask(task, outputsRoot), ...(isTerminal(task.status) ? {} : { next: nextHint(task, '视频') }), ...publicUploadHint(form, input) });
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
      description: '查询任务状态与结果文件（含耗时 duration_ms 与 usage）。可选 wait_seconds 等待完成；include_images 返回图片缩略图。',
      inputSchema: z.object({
        task_id: z.string(),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(540)
          .optional()
          .describe(`最多等待多少秒（0–540），默认不等；整次调用控制在约 ${callBudgetSeconds()} 秒内。在 Claude Code 主对话里，超过 2 分钟的调用会自动转到后台：用户可以继续对话，结果完成后自动回到对话（请在主对话直接调用，子代理里的调用不会转后台）。需要客户端的工具超时不短于 10 分钟`),
        include_images: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ task_id, wait_seconds, include_images }, ctx) => {
      const startedAt = Date.now();
      let task = deps.store.getTask(task_id);
      if (!task) return fail(`任务不存在：${task_id}`);
      const wait = waitWithin(wait_seconds ?? 0, startedAt);
      if (wait > 0 && !isTerminal(task.status)) task = (await waitFor(task_id, wait, ctx as never)) ?? task;
      return ok({ ...summarizeTask(task, outputsRoot), ...(isStalled(task) ? { next: nextHint(task, '任务') } : {}) }, include_images ? await imageBlocks(task, outputsRoot, responseDeadline(startedAt)) : []);
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
