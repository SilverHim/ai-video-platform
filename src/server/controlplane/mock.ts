import { createHash, randomBytes } from 'node:crypto';
import type { FetchLike } from '../upstream/http.js';
import { CONTROL_HOST } from './ark-control.js';

/**
 * Mock 控制面（ARK_MOCK_UPSTREAM=1 与测试用）：内存里的 Endpoint 列表，响应结构按官方文档的示例。
 * 校验签名头的格式与 X-Content-Sha256；AccessKey ID 写 "invalid" 时返回鉴权失败。
 * 创建 / 启动后先是 Scheduling，约 1.5 秒后变 Running。
 */
interface MockEndpoint {
  Id: string;
  Name: string;
  Description: string;
  ProjectName: string;
  ModelReference: { FoundationModel: { Name: string; ModelVersion: string } };
  Status: string;
  StatusReason: string;
  RateLimit: { Rpm: number; Tpm: number };
  Moderation: { Strategy: string };
  CreateTime: string;
  UpdateTime: string;
  readyAt: number;
}

const endpoints = new Map<string, MockEndpoint>();
export const MOCK_SCHEDULING_MS = 1500;

export function resetMockControl(): void {
  endpoints.clear();
}

const meta = (action: string, error?: { Code: string; Message: string }) => ({
  RequestId: `mock${randomBytes(8).toString('hex')}`,
  Action: action,
  Version: '2024-01-01',
  Service: 'ark',
  Region: 'ap-southeast-1',
  ...(error ? { Error: error } : {}),
});
const ok = (action: string, result: unknown) => new Response(JSON.stringify({ ResponseMetadata: meta(action), Result: result }), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (action: string, status: number, Code: string, Message: string) =>
  new Response(JSON.stringify({ ResponseMetadata: meta(action, { Code, Message }) }), { status, headers: { 'content-type': 'application/json' } });

function view(e: MockEndpoint): Record<string, unknown> {
  if ((e.Status === 'Scheduling') && Date.now() >= e.readyAt) e.Status = 'Running';
  const { readyAt: _readyAt, ...rest } = e;
  return { ...rest, EndpointModelType: 'FoundationModel', ModelUnitId: '' };
}

export const mockControlFetch: FetchLike = async (url, init) => {
  const u = new URL(url);
  const action = u.searchParams.get('Action') ?? '';
  if (u.hostname !== CONTROL_HOST) return fail(action, 404, 'NotFound', `mock: unknown host ${u.hostname}`);
  const auth = init.headers.Authorization ?? '';
  const m = /^HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/ap-southeast-1\/ark\/request, SignedHeaders=([a-z0-9;-]+), Signature=[0-9a-f]{64}$/.exec(auth);
  if (!m || !m[3]!.split(';').includes('host') || !m[3]!.split(';').includes('x-date')) return fail(action, 401, 'InvalidAuthorization', 'mock: malformed Authorization header');
  if (m[1] === 'invalid') return fail(action, 401, 'InvalidAccessKey', 'mock: the access key is invalid');
  const body = typeof init.body === 'string' ? init.body : '';
  const sha = createHash('sha256').update(body).digest('hex');
  if (init.headers['X-Content-Sha256'] !== sha) return fail(action, 400, 'SignatureDoesNotMatch', 'mock: X-Content-Sha256 does not match the body');
  const req = (body ? JSON.parse(body) : {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const find = () => endpoints.get(String(req.Id ?? ''));

  switch (action) {
    case 'ListEndpoints': {
      const size = Math.min(100, Math.max(1, Number(req.PageSize ?? 10)));
      const page = Math.max(1, Number(req.PageNumber ?? 1));
      const all = [...endpoints.values()].map(view);
      return ok(action, { TotalCount: all.length, PageNumber: page, PageSize: size, Items: all.slice((page - 1) * size, page * size) });
    }
    case 'GetEndpoint': {
      const e = find();
      // 实测 GetEndpoint 的字段直接平铺在 Result 里（文档示例包了一层 Endpoint）
      return e ? ok(action, view(e)) : fail(action, 404, 'NotFound.EndpointId', `mock: the specified EndpointId ${String(req.Id)} is not found`);
    }
    case 'CreateEndpoint': {
      const ref = req.ModelReference as { FoundationModel?: { Name?: string; ModelVersion?: string } } | undefined;
      const fm = ref?.FoundationModel;
      if (!req.Name || !fm?.Name || !fm.ModelVersion) return fail(action, 400, 'InvalidParameter', 'mock: Name and ModelReference.FoundationModel are required');
      if (req.DryRun === true) return ok(action, {});
      const id = `ep-mock${Date.now().toString().slice(-8)}-${randomBytes(3).toString('hex').slice(0, 5)}`;
      const rl = req.RateLimit as { Rpm?: number; Tpm?: number } | undefined;
      const mod = req.Moderation as { Strategy?: string } | undefined;
      endpoints.set(id, {
        Id: id,
        Name: String(req.Name),
        Description: String(req.Description ?? ''),
        ProjectName: 'default',
        ModelReference: { FoundationModel: { Name: fm.Name, ModelVersion: fm.ModelVersion } },
        Status: 'Scheduling',
        StatusReason: '',
        RateLimit: { Rpm: rl?.Rpm ?? -1, Tpm: rl?.Tpm ?? -1 },
        Moderation: { Strategy: mod?.Strategy ?? 'Default' },
        CreateTime: now,
        UpdateTime: now,
        readyAt: Date.now() + MOCK_SCHEDULING_MS,
      });
      return ok(action, { Id: id });
    }
    case 'UpdateEndpoint': {
      const e = find();
      if (!e) return fail(action, 404, 'NotFound.Endpoint', 'mock: endpoint not found');
      if (typeof req.Name === 'string') e.Name = req.Name;
      if (typeof req.Description === 'string') e.Description = req.Description;
      const rl = req.RateLimit as { Rpm?: number; Tpm?: number } | undefined;
      if (rl?.Rpm && rl.Tpm) e.RateLimit = { Rpm: rl.Rpm, Tpm: rl.Tpm };
      const mod = req.Moderation as { Strategy?: string } | undefined;
      if (mod?.Strategy) e.Moderation = { Strategy: mod.Strategy };
      e.UpdateTime = now;
      return ok(action, {});
    }
    case 'StartEndpoint':
    case 'StopEndpoint': {
      const e = find();
      if (!e) return fail(action, 404, 'NotFound.Endpoint', 'mock: endpoint not found');
      if (action === 'StopEndpoint') e.Status = 'Stopped';
      else {
        e.Status = 'Scheduling';
        e.readyAt = Date.now() + MOCK_SCHEDULING_MS;
      }
      e.UpdateTime = now;
      return ok(action, {});
    }
    case 'DeleteEndpoint': {
      const e = find();
      if (!e) return fail(action, 404, 'NotFound.EndpointId', 'mock: endpoint not found');
      // 实测：运行中删除返回 403 OperationDenied.Running
      if (view(e).Status !== 'Stopped') return fail(action, 403, 'OperationDenied.Running', 'Operation is denied because endpoint is currently Running. please stop it first before deleting.');
      endpoints.delete(String(req.Id));
      return ok(action, {});
    }
    default:
      return fail(action, 400, 'InvalidAction', `mock: unsupported action ${action}`);
  }
};
