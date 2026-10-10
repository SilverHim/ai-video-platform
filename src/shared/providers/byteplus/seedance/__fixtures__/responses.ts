/**
 * Seedance 请求 / 响应样例。
 * - OFFICIAL_*：调研报告原样摘录的官方 / 实测片段；完整的官方示例请求 / 响应见 official.ts；
 * - 其余：官方没有对应的完整 JSON 示例（2.5 的查询结果只有 SDK 打印形式），按报告字段构造（标注"构造"）。
 */

/** 创建任务只返回 {"id":"cgt-..."}（docs/research/byteplus/video-api.md §1 异步流程） */
export const OFFICIAL_CREATE = `{"id":"cgt-..."}`;

/** 实测 401（docs/research/byteplus/platform-cors.md §3） */
export const OFFICIAL_401 = `{"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid. request id: ...","param":"","type":"Unauthorized"}}`;

/** 正片的 content（video-api.md §3.4 通用流程第 2 步） */
export const OFFICIAL_DRAFT_CONTENT = `[{"type":"draft_task","draft_task":{"id":"..."}}]`;

/** 旧写法缩写（video-api.md §3.1 官方示例） */
export const OFFICIAL_LEGACY_FLAGS = '--rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true';
/** 1.0 提示词指南示例末尾的全称文本命令（原文两个空格） */
export const GUIDE_10_LEGACY_FLAGS = '--resolution 1080p  --duration 5 --camerafixed false';
/** 1.5 pro 提示词指南旧写法示例里注释掉的全称写法 */
export const GUIDE_15_LEGACY_FLAGS = '--resolution 720p --ratio 16:9 --duration 5 --seed 11 --camerafixed false --watermark true';

/** 视频结果地址形态（platform-cors.md 结果 URL 节） */
export const OFFICIAL_VIDEO_URL = 'https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/xxx';

/** 构造：429 排队数超限（错误码见 video-api.md §7） */
export const QUOTA_429 = JSON.stringify({ error: { code: 'QuotaExceeded', message: 'constructed: too many queued tasks. request id: 0217abc123def4567', type: 'TooManyRequests' } });

/** 构造：2.x 传 flex 时的同步报错（error-codes：InvalidParameter.UnsupportedParameter） */
export const UNSUPPORTED_FLEX_400 = JSON.stringify({ error: { code: 'InvalidParameter.UnsupportedParameter', message: 'constructed: service_tier flex is not supported', type: 'BadRequest' } });

export const CREATED_AT = 1_791_000_000;
export const UPDATED_AT = 1_791_000_120;

/** 构造：2.5 成功（字段按 video-api.md §4；ratio 5:4 来自编辑示例响应） */
export const TASK_SUCCEEDED_25 = JSON.stringify({
  id: 'cgt-20261008-abc',
  model: 'dreamina-seedance-2-5-260628',
  status: 'succeeded',
  content: { video_url: OFFICIAL_VIDEO_URL, last_frame_url: 'https://example.invalid/last.jpeg' },
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  seed: 12345,
  resolution: '720p',
  ratio: '5:4',
  duration: 5,
  framespersecond: 24,
  generate_audio: true,
  output_format: 'mov',
  draft: false,
  service_tier: 'default',
  execution_expires_after: 172800,
  priority: 0,
  usage: { completion_tokens: 108900, total_tokens: 108900 },
  error: null,
});

/** 构造：1.0 按帧数生成的成功响应（只返回 frames，没有 duration；没有尾帧） */
export const TASK_SUCCEEDED_FRAMES = JSON.stringify({
  id: 'cgt-20261008-frm',
  model: 'seedance-1-0-pro-250528',
  status: 'succeeded',
  content: { video_url: 'https://example.invalid/v.mp4' },
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  seed: 11,
  resolution: '1080p',
  ratio: '16:9',
  frames: 121,
  framespersecond: 24,
  service_tier: 'flex',
  usage: { completion_tokens: 246840, total_tokens: 246840 },
  error: null,
});

/** 构造：2.5 首帧 ratio 不是 adaptive 的异步失败（video-api.md §3.3） */
export const TASK_FAILED_TYPE = JSON.stringify({
  id: 'cgt-20261008-bad',
  model: 'dreamina-seedance-2-5-260628',
  status: 'failed',
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  error: { code: 'InvalidParameter.TaskTypeConstraint', message: 'constructed: ratio must be adaptive. request id: 0217abc123def4567' },
});

/** 构造：输出被审核拦截 */
export const TASK_FAILED_SENSITIVE = JSON.stringify({
  id: 'cgt-20261008-sen',
  model: 'dreamina-seedance-2-0-260128',
  status: 'failed',
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  error: { code: 'OutputVideoSensitiveContentDetected', message: 'constructed: output video blocked' },
});

/** 构造：只有 id / status / 时间的中间状态 */
export const taskInState = (status: string): string => JSON.stringify({ id: 'cgt-20261008-q', model: 'dreamina-seedance-2-0-fast-260128', status, created_at: CREATED_AT, updated_at: UPDATED_AT });

/** 构造：查询 404（error-codes：NotFound.{Parameter}） */
export const TASK_NOT_FOUND = JSON.stringify({ error: { code: 'NotFound.TaskId', message: 'constructed: task not found', type: 'NotFound' } });
