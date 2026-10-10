import type { FormInput } from '../catalog/types.js';
import type { NormalizedError } from './errors.js';
import type { LayerInfo, PartialFailure } from './results.js';
import type { JobStatus } from './status.js';

export type TaskOrigin = 'web' | 'mcp';
export type CaptureState = 'none' | 'pending' | 'done' | 'partial' | 'failed';

/** 本地保存的一个结果文件 */
export interface ResultRecord {
  id: string;
  taskId: string;
  index: number;
  role: 'image' | 'video' | 'last_frame' | 'base' | 'layer';
  kind: 'image' | 'video';
  /** 相对 outputs 目录的路径（用 / 分隔），浏览器通过 /files/<path> 访问 */
  path: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  /** 服务商原始链接（有时效） */
  remoteUrl: string | null;
  remoteExpiresAt: number | null;
  layer: LayerInfo | null;
}

export interface TaskRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** 第一次进入终态的时间；旧记录没有 */
  finishedAt?: number | null;
  origin: TaskOrigin;
  providerId: string;
  modelId: string;
  apiModel: string;
  modeId: string;
  kind: 'sync' | 'async';
  status: JobStatus;
  upstreamTaskId: string | null;
  baseUrlId: string;
  /** 提交时的表单快照（data URI 已截断），用于"复用参数" */
  form: FormInput;
  /** 实际发送的请求体（脱敏、截断） */
  request: Record<string, unknown> | null;
  error: NormalizedError | null;
  failures: PartialFailure[];
  usage: Record<string, unknown> | null;
  /** 服务商返回的实际参数 */
  actual: Record<string, unknown> | null;
  capture: CaptureState;
  /** 本地输出目录（相对 outputs） */
  outputDir: string | null;
  parentTaskId: string | null;
  costEstimate: { amount: number; currency: 'USD' } | null;
  favorite: boolean;
  note: string | null;
  results: ResultRecord[];
}

export interface ExchangeRecord {
  id: number;
  taskId: string;
  at: number;
  kind: 'submit' | 'poll' | 'final' | 'sse' | 'error' | 'cancel';
  status: number | null;
  /** 脱敏、截断后的响应文本 */
  body: string;
  /** 提交请求的请求体字节数（只有 submit / error 记录） */
  requestBytes?: number | null;
  /** 从开始发送请求到收到响应（或出错）的毫秒数 */
  durationMs?: number | null;
}

export interface TaskListQuery {
  limit?: number;
  before?: number;
  status?: string;
  providerId?: string;
  modelId?: string;
  origin?: TaskOrigin;
}

/** 参数预设：某个模型某个模式下的一组参数（可选带提示词），网页与 MCP 共用 */
export interface PresetRecord {
  id: string;
  name: string;
  modelId: string;
  modeId: string;
  values: Record<string, unknown>;
  prompt: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 提示词模板：文字片段，{{变量}} 在插入时填写 */
export interface TemplateRecord {
  id: string;
  name: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** /api/events 推送的事件 */
export type ServerEvent =
  | { type: 'task.updated'; task: TaskRecord }
  | { type: 'task.deleted'; taskId: string }
  /** 提交请求的上传进度（大请求体分片发送时，最多每秒一条） */
  | { type: 'task.progress'; taskId: string; sent: number; total: number }
  | { type: 'ping'; at: number };
