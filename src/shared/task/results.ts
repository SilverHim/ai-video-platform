import type { NormalizedError } from './errors.js';
import type { TaskStatus } from './status.js';

export interface LayerInfo {
  zIndex: number;
  name?: string;
  description?: string;
  /** 绝对像素 [x1, y1, x2, y2] */
  bboxAbs?: [number, number, number, number];
  /** 归一化 [x1, y1, x2, y2]（0–1 或 0–999，按服务商约定） */
  bboxNorm?: [number, number, number, number];
}

/** 服务商返回的一个结果文件 */
export interface ResultAsset {
  index: number;
  role: 'image' | 'video' | 'last_frame' | 'base' | 'layer';
  kind: 'image' | 'video';
  source: { type: 'url'; url: string; expiresAt?: number } | { type: 'b64'; data: string; mime?: string };
  width?: number;
  height?: number;
  mime?: string;
  layer?: LayerInfo;
}

export interface PartialFailure {
  index: number;
  error: NormalizedError;
}

/** 同步结果 / 任务创建的解析结果 */
export type NormalizedResult =
  | { kind: 'sync'; status: 'succeeded' | 'partial' | 'failed'; assets: ResultAsset[]; failures: PartialFailure[]; usage?: Record<string, unknown>; error?: NormalizedError }
  | { kind: 'task-created'; taskId: string }
  | { kind: 'error'; error: NormalizedError };

/** 异步任务查询的解析结果 */
export interface TaskSnapshot {
  taskId: string;
  status: TaskStatus;
  /** 服务商原始状态值 */
  rawStatus: string;
  createdAt?: number;
  updatedAt?: number;
  assets: ResultAsset[];
  error?: NormalizedError;
  usage?: Record<string, unknown>;
  /** 服务商返回的实际参数（分辨率、比例、时长、seed 等） */
  actual?: Record<string, unknown>;
}

/** 流式事件解析结果 */
export type StreamUpdate =
  | { type: 'asset'; asset: ResultAsset }
  | { type: 'failure'; failure: PartialFailure }
  | { type: 'completed'; usage?: Record<string, unknown> }
  | { type: 'error'; error: NormalizedError };
