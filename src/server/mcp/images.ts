import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskRecord } from '../../shared/task/records.js';
import { makeThumbnail } from '../media/thumbnail.js';
import { beforeDeadline } from './timing.js';

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** 内联缩略图上限：控制 MCP 输出的 token 消耗 */
const INLINE_IMAGE_MAX_BYTES = 200 * 1024;
const INLINE_IMAGE_MAX_COUNT = 4;
/** 单张缩略图最多花多久 */
const THUMB_TIMEOUT_MS = 15_000;
/** 离截止时间不到这么久就不再生成缩略图 */
const THUMB_MIN_MS = 1_000;

/**
 * 内联缩略图（最多 4 张）：小图原样返回；大图有 ffmpeg 时缩成 512px JPEG，否则跳过（路径照样返回）。
 * 读图、找 ffmpeg、等进程退出都要在 deadlineAt 前结束（单张缩略图也按剩余时间限时）；来不及的跳过并说明
 */
export async function imageBlocks(task: TaskRecord, outputsRoot: string, deadlineAt: number, thumbnail: typeof makeThumbnail = makeThumbnail): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  let failed = 0;
  let late = 0;
  for (const r of task.results) {
    if (r.kind !== 'image' || !r.path || !r.mime) continue;
    if (out.length >= INLINE_IMAGE_MAX_COUNT) break;
    const abs = join(outputsRoot, r.path);
    const left = deadlineAt - Date.now();
    const small = /^image\/(png|jpeg|webp|gif)$/.test(r.mime) && (r.bytes ?? Infinity) <= INLINE_IMAGE_MAX_BYTES;
    if (left < (small ? 1 : THUMB_MIN_MS)) {
      late += 1;
      continue;
    }
    // 包一层对象：区分「到了截止时间」（null）和「读不到 / 生成不了」（{ data: null }）
    const job = small ? readFile(abs).catch(() => null) : thumbnail(abs, 512, Math.min(THUMB_TIMEOUT_MS, left)).catch(() => null);
    const got = await beforeDeadline(job.then((data) => ({ data })), deadlineAt);
    if (!got) late += 1;
    else if (got.data && got.data.length <= INLINE_IMAGE_MAX_BYTES) out.push({ type: 'image', data: got.data.toString('base64'), mimeType: small ? r.mime : 'image/jpeg' });
    else failed += 1;
  }
  if (failed) out.push({ type: 'text', text: `另有 ${failed} 张图片没能内联（较大且本机没有 ffmpeg、处理超时或读取失败），请按 files[].path 打开` });
  if (late) out.push({ type: 'text', text: `另有 ${late} 张图片因为本次调用的时间不够，没有生成缩略图：请按 files[].path 打开，或用 get_task 带 include_images 再取` });
  return out;
}
