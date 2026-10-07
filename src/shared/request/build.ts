import type { EvaluatedForm, ModelDef, ProviderDef, ResolvedAssets, BuildCtx, Issue } from '../catalog/types.js';
import type { I18nText } from '../i18n.js';
import { computeRefOrder, renderPrompt } from '../engine/refs.js';
import { cloneJson, deepMerge, setPath, utf8Bytes, type JsonObject } from './wire.js';

export interface BuiltRequest {
  providerId: string;
  modelId: string;
  endpointId: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body: JsonObject;
  stream: boolean;
  /** 实际（send）或估计（preview）的请求体字节数 */
  bodyBytes: number;
  /** 构建阶段新增的问题（wireGuard、体积超限） */
  issues: Issue[];
  notes: I18nText[];
}

/**
 * 表单 → 原始请求体。预览与发送走同一个函数，区别只在素材解析结果：
 * 预览时 resolved 里是占位 / 截断值，发送时是真实 data URI / URL。
 */
export function buildRequest(
  provider: ProviderDef,
  model: ModelDef,
  evaluated: EvaluatedForm,
  resolved: ResolvedAssets,
  purpose: 'preview' | 'send',
): BuiltRequest {
  const ctx = evaluated.ctx;
  const body: JsonObject = {};

  for (const f of model.fields) {
    const st = evaluated.fields[f.key];
    if (!st?.sent) continue;
    const v = evaluated.effective[f.key];
    if (f.fragment) {
      const frag = (f.fragment as (v: unknown, c: typeof ctx) => JsonObject | null)(v, ctx);
      if (frag) deepMerge(body, frag);
      continue;
    }
    if (!f.wire) continue;
    if (v === null || v === undefined) continue;
    if ((f.send ?? 'always') === 'if-set' && v === '') continue;
    setPath(body, f.wire, v);
  }
  if (ctx.mode.wire) deepMerge(body, cloneJson(ctx.mode.wire));

  const refOrder = computeRefOrder(ctx.mode, ctx.input.slots);
  const { text } = renderPrompt(ctx.input.prompt ?? '', refOrder, ctx.mode.prompt.refLabel);
  const buildCtx: BuildCtx = { ...ctx, evaluated, resolved, purpose, renderedPrompt: text.trim(), refOrder };
  deepMerge(body, model.adapter.compose(buildCtx));

  const notes: I18nText[] = [];
  if (ctx.input.modelOverride) {
    if (model.allowModelOverride) {
      body.model = ctx.input.modelOverride;
      notes.push({ zh: `model 已用 ${ctx.input.modelOverride} 覆盖`, en: `model overridden with ${ctx.input.modelOverride}` });
    } else {
      notes.push({ zh: '该模型不支持覆盖 model 字段，已忽略', en: 'Model override not supported; ignored' });
    }
  }
  if (ctx.input.rawOverrides) deepMerge(body, cloneJson(ctx.input.rawOverrides));

  const issues: Issue[] = [];
  for (const g of model.wireGuards ?? []) {
    const reason = g.check(body, ctx);
    if (reason) issues.push({ id: `guard:${g.id}`, severity: 'error', message: reason });
  }

  let bodyBytes = utf8Bytes(JSON.stringify(body));
  if (purpose === 'preview') {
    for (const id of Object.keys(refOrder)) {
      const r = resolved[id];
      if (r) bodyBytes += Math.max(0, r.bytes - utf8Bytes(r.wire));
    }
  }
  if (bodyBytes > provider.limits.maxRequestBytes) {
    issues.push({
      id: 'body:too-large',
      severity: 'error',
      message: {
        zh: `请求体约 ${(bodyBytes / 1e6).toFixed(1)} MB，超过上限 ${(provider.limits.maxRequestBytes / 1e6).toFixed(0)} MB；大文件请改用 URL 或上传方式`,
        en: `Request body is about ${(bodyBytes / 1e6).toFixed(1)} MB, over the ${(provider.limits.maxRequestBytes / 1e6).toFixed(0)} MB limit; use URLs or uploads for large files`,
      },
    });
  }

  const stream = body.stream === true && Boolean(model.endpoints.stream);
  const endpointId = stream ? model.endpoints.stream! : model.endpoints.submit;
  const ep = provider.endpoints[endpointId];
  if (!ep) throw new Error(`服务商 ${provider.id} 没有 endpoint ${endpointId}`);
  return { providerId: provider.id, modelId: model.id, endpointId, method: ep.method, path: ep.path, body, stream, bodyBytes, issues, notes };
}
