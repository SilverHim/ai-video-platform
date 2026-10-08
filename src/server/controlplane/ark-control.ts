import type { ContentFilterState, EndpointCreateInput, EndpointInfo, EndpointUpdateInput } from '../../shared/api-contract.js';
import type { ModelDef } from '../../shared/catalog/types.js';
import { USER_AGENT, type FetchLike } from '../upstream/http.js';
import { signRequest } from './sign.js';

/**
 * ModelArk 控制面（推理接入点管理），按官方 Control plane API 文档：
 * POST https://ark.ap-southeast-1.byteplusapi.com/?Action=<Action>&Version=2024-01-01，JSON 请求体，
 * Service=ark、Region=ap-southeast-1，AK/SK 签名（SignedHeaders=host;x-content-sha256;x-date）。
 * 只开放下面白名单里的 Action。
 */
export const CONTROL_HOST = 'ark.ap-southeast-1.byteplusapi.com';
export const CONTROL_REGION = 'ap-southeast-1';
export const CONTROL_SERVICE = 'ark';
export const CONTROL_VERSION = '2024-01-01';

export const CONTROL_ACTIONS = ['ListEndpoints', 'GetEndpoint', 'CreateEndpoint', 'UpdateEndpoint', 'StartEndpoint', 'StopEndpoint', 'DeleteEndpoint'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/**
 * 内容过滤：接口文档未列出 Moderation，2026-10-08 实测（见 docs/research/byteplus/catalog-params-test.md）：
 * 默认新建的 Endpoint 为 Default（开启）；Skip = 控制台里关掉 Content filter；
 * CreateEndpoint 与 UpdateEndpoint 都接受 Moderation.Strategy，运行中也能改，回读立即生效。
 */
export const MODERATION_OFF = 'Skip';
export const MODERATION_ON = 'Default';

export interface ControlCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export class ControlPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export class ArkControlClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = 30_000,
  ) {}

  async call(creds: ControlCredentials, action: ControlAction, body: Json): Promise<Json> {
    if (!(CONTROL_ACTIONS as readonly string[]).includes(action)) throw new ControlPlaneError('ActionNotAllowed', `不允许的控制面操作：${action}`, 400, null);
    const query = { Action: action, Version: CONTROL_VERSION };
    const payload = JSON.stringify(body);
    const signed = signRequest({
      method: 'POST',
      host: CONTROL_HOST,
      path: '/',
      query,
      body: payload,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      region: CONTROL_REGION,
      service: CONTROL_SERVICE,
    });
    const url = `https://${CONTROL_HOST}/?Action=${action}&Version=${CONTROL_VERSION}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { ...signed, 'Content-Type': 'application/json; charset=UTF-8', 'User-Agent': USER_AGENT },
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new ControlPlaneError(timeout ? 'Timeout' : 'NetworkError', timeout ? '控制面请求超时' : `控制面网络错误：${err instanceof Error ? err.message : String(err)}`, 0, null);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应按错误处理
    }
    const meta = isObj(data) && isObj(data.ResponseMetadata) ? data.ResponseMetadata : null;
    const err = meta && isObj(meta.Error) ? meta.Error : null;
    const requestId = meta ? str(meta.RequestId) || null : null;
    if (err || !res.ok || !isObj(data)) {
      throw new ControlPlaneError(str(err?.Code) || `HTTP${res.status}`, str(err?.Message) || `控制面返回 HTTP ${res.status}`, res.status, requestId);
    }
    return isObj(data.Result) ? data.Result : {};
  }
}

/* ---------------- 模型 ↔ 基础模型名 / 版本 ---------------- */

/** apiModel 形如 dola-seedream-5-0-flash-260915：末尾 6 位数字是版本 */
export function splitApiModel(apiModel: string): { name: string; version: string } | null {
  const m = /^(.+)-(\d{6})$/.exec(apiModel);
  return m ? { name: m[1]!, version: m[2]! } : null;
}

/** 基础模型名 + 版本 → 本平台模型 id（匹配 apiModel 或别名） */
export function matchModel(models: ModelDef[], fm: { name: string; version: string } | null): string | null {
  if (!fm) return null;
  const full = `${fm.name}-${fm.version}`;
  return models.find((m) => m.apiModel === full || m.aliases?.includes(full))?.id ?? null;
}

function contentFilterOf(strategy: string | null): ContentFilterState {
  if (strategy === null) return 'unknown';
  return strategy === MODERATION_OFF ? 'off' : 'on';
}

export function toEndpointInfo(raw: Json, models: ModelDef[]): EndpointInfo {
  const ref = isObj(raw.ModelReference) ? raw.ModelReference : {};
  const fmRaw = isObj(ref.FoundationModel) ? ref.FoundationModel : null;
  const foundationModel = fmRaw && str(fmRaw.Name) ? { name: str(fmRaw.Name), version: str(fmRaw.ModelVersion) } : null;
  const moderation = isObj(raw.Moderation) && typeof raw.Moderation.Strategy === 'string' ? raw.Moderation.Strategy : null;
  const rl = isObj(raw.RateLimit) && typeof raw.RateLimit.Rpm === 'number' && typeof raw.RateLimit.Tpm === 'number' ? { rpm: raw.RateLimit.Rpm, tpm: raw.RateLimit.Tpm } : null;
  return {
    id: str(raw.Id),
    name: str(raw.Name),
    description: str(raw.Description),
    status: str(raw.Status),
    statusReason: str(raw.StatusReason),
    foundationModel,
    customModelId: str(ref.CustomModelId) || null,
    modelId: matchModel(models, foundationModel),
    contentFilter: contentFilterOf(moderation),
    moderationStrategy: moderation,
    rateLimit: rl,
    projectName: str(raw.ProjectName),
    createTime: str(raw.CreateTime),
    updateTime: str(raw.UpdateTime),
  };
}

/* ---------------- 请求体 ---------------- */

export class EndpointInputError extends Error {}

const NAME_MAX = 64;
const DESC_MAX = 300;

function checkName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw new EndpointInputError('名称不能为空');
  if (name.trim().length > NAME_MAX) throw new EndpointInputError(`名称最长 ${NAME_MAX} 个字符`);
  return name.trim();
}

function checkDescription(d: unknown): string | undefined {
  if (d === undefined) return undefined;
  if (typeof d !== 'string') throw new EndpointInputError('描述必须是字符串');
  if (d.length > DESC_MAX) throw new EndpointInputError(`描述最长 ${DESC_MAX} 个字符`);
  return d;
}

function checkRateLimit(rl: unknown): { Rpm: number; Tpm: number } | undefined {
  if (rl === undefined) return undefined;
  if (!isObj(rl) || !Number.isInteger(rl.rpm) || !Number.isInteger(rl.tpm) || (rl.rpm as number) < 1 || (rl.tpm as number) < 1) {
    throw new EndpointInputError('限流需要 RPM 和 TPM 两个正整数');
  }
  return { Rpm: rl.rpm as number, Tpm: rl.tpm as number };
}

/** CreateEndpoint 请求体；model 必须是 BytePlus 目录里的模型 */
export function createBody(input: EndpointCreateInput, model: ModelDef | undefined, dryRun: boolean): Json {
  if (!model || model.providerId !== 'byteplus') throw new EndpointInputError('只能为 BytePlus 的模型创建 Endpoint');
  const fm = splitApiModel(model.apiModel);
  if (!fm) throw new EndpointInputError(`无法从 ${model.apiModel} 解析基础模型名和版本`);
  const description = checkDescription(input.description);
  const rateLimit = checkRateLimit(input.rateLimit);
  return {
    Name: checkName(input.name),
    ...(description ? { Description: description } : {}),
    ModelReference: { FoundationModel: { Name: fm.name, ModelVersion: fm.version } },
    ...(rateLimit ? { RateLimit: rateLimit } : {}),
    // 内容过滤默认开启（官方文档）；关闭时才写 Moderation
    ...(input.contentFilter === false ? { Moderation: { Strategy: MODERATION_OFF } } : {}),
    ...(dryRun ? { DryRun: true } : {}),
  };
}

/** GetEndpoint 的结果：文档示例包在 Result.Endpoint 里，实测是直接平铺在 Result 里，两种都接受 */
export function endpointOf(result: Json): Json {
  return isObj(result.Endpoint) ? result.Endpoint : result;
}

/** UpdateEndpoint 请求体：文档列出 Name / Description / RateLimit；内容过滤按实测用 Moderation.Strategy */
export function updateBody(id: string, input: EndpointUpdateInput): Json {
  const body: Json = { Id: id };
  if (input.contentFilter !== undefined) {
    if (typeof input.contentFilter !== 'boolean') throw new EndpointInputError('contentFilter 必须是布尔值');
    body.Moderation = { Strategy: input.contentFilter ? MODERATION_ON : MODERATION_OFF };
  }
  if (input.name !== undefined) body.Name = checkName(input.name);
  const description = checkDescription(input.description);
  if (description !== undefined) body.Description = description;
  const rateLimit = checkRateLimit(input.rateLimit);
  if (rateLimit) body.RateLimit = rateLimit;
  if (Object.keys(body).length === 1) throw new EndpointInputError('没有要修改的内容');
  return body;
}

export function checkEndpointId(id: string): string {
  if (!/^ep-[A-Za-z0-9-]{4,64}$/.test(id)) throw new EndpointInputError(`Endpoint ID 格式不对：${id}`);
  return id;
}
