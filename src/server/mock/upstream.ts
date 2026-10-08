import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { writeStreamAtomically, type Downloaded, type Downloader } from '../capture/downloader.js';
import type { FetchLike } from '../upstream/http.js';
import { MOCK_FRAME_JPEG_BASE64, MOCK_MP4_BASE64 } from './media.js';
import { makePng } from './png.js';

/**
 * Mock 上游（ARK_MOCK_UPSTREAM=1）：不需要 Key、不计费，响应格式按官方文档。
 * 提示词里写 MOCK_FAIL 返回参数错误，写 MOCK_SENSITIVE 让组图中一张被审核拦截。
 */
export const MOCK_CDN_HOST = 'mock.cdn.invalid';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockImageUrl(provider: string, w: number, h: number, seed: number, alpha = false) {
  return `https://${MOCK_CDN_HOST}/${provider}/${randomUUID()}.png?w=${w}&h=${h}&seed=${seed}&alpha=${alpha ? 1 : 0}`;
}

function sizeOf(size: unknown): [number, number] {
  if (typeof size === 'string') {
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (m) return [Number(m[1]), Number(m[2])];
    const tier = { '1K': 1024, '1.5K': 1536, '2K': 2048, '3K': 3072, '4K': 4096 }[size];
    if (tier) return [tier, tier];
  }
  return [2048, 2048];
}

/** 实际生成的 mock 图片控制在 512 以内（512×512 正好满足图层分解的像素下限） */
const small = (w: number, h: number): [number, number] => {
  const s = Math.min(1, 512 / Math.max(w, h));
  return [Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))];
};

function byteplusImages(body: Record<string, unknown>): Response {
  const prompt = String(body.prompt ?? '');
  const model = String(body.model ?? '');
  if (prompt.includes('MOCK_FAIL')) return json(400, { error: { code: 'InvalidParameter', message: 'mock: invalid parameter. request id: mock0000000001', param: 'prompt', type: 'BadRequest' } });
  const [W, H] = sizeOf(body.size);
  const [w, h] = small(W, H);
  const b64 = body.response_format === 'b64_json';
  const created = Math.floor(Date.now() / 1000);
  const item = (i: number, extra: Record<string, unknown> = {}, alpha = false) => ({
    ...(b64 ? { b64_json: makePng(w, h, i, alpha).toString('base64') } : { url: mockImageUrl('byteplus', w, h, i, alpha) }),
    size: `${W}x${H}`,
    ...extra,
  });

  let data: Record<string, unknown>[];
  if (body.layer_decomposition === true) {
    data = [item(0, { z_index: 0, output_format: 'jpeg' })];
    for (let i = 1; i <= 3; i++) {
      const box = [Math.round((W * i) / 8), Math.round((H * i) / 8), Math.round((W * (i + 3)) / 8), Math.round((H * (i + 3)) / 8)];
      data.push(item(i, { z_index: i, output_format: 'png', name: `layer-${i}`, description: `mock layer ${i}`, bounding_box: { absolute: box, normalized: box.map((v, k) => Math.round((v / (k % 2 ? H : W)) * 1000)) } }, true));
    }
  } else if (body.sequential_image_generation === 'auto') {
    const max = Number((body.sequential_image_generation_options as { max_images?: number } | undefined)?.max_images ?? 15);
    const n = Math.max(1, Math.min(max, 3));
    data = Array.from({ length: n }, (_, i) => (prompt.includes('MOCK_SENSITIVE') && i === 1 ? { error: { code: 'OutputImageSensitiveContentDetected', message: 'mock: blocked' } } : item(i)));
  } else {
    data = [item(0, {}, body.background === 'transparent')];
  }
  const ok = data.filter((d) => !d.error).length;
  const usage = { generated_images: ok, output_tokens: Math.round((ok * W * H) / 256), total_tokens: Math.round((ok * W * H) / 256) };

  if (body.stream === true) {
    const frames: string[] = [];
    data.forEach((d, i) => {
      if (d.error) frames.push(`event: image_generation.partial_failed\ndata: ${JSON.stringify({ type: 'image_generation.partial_failed', model, created, image_index: i, error: d.error })}\n\n`);
      else frames.push(`event: image_generation.partial_succeeded\ndata: ${JSON.stringify({ type: 'image_generation.partial_succeeded', model, created, image_index: i, ...d })}\n\n`);
    });
    frames.push(`event: image_generation.completed\ndata: ${JSON.stringify({ type: 'image_generation.completed', model, created, usage })}\n\n`);
    frames.push('data: [DONE]\n\n');
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) {
          controller.enqueue(enc.encode(f));
          await new Promise((r) => setTimeout(r, 30));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return json(200, { model, created, data, usage });
}

function minimaxImages(body: Record<string, unknown>): Response {
  const prompt = String(body.prompt ?? '');
  if (prompt.includes('MOCK_FAIL')) return json(200, { id: 'mock-trace', base_resp: { status_code: 2013, status_msg: 'invalid params (mock)' } });
  const n = Math.min(9, Math.max(1, Number(body.n ?? 1)));
  const [w, h] = small(Number(body.width ?? 1024), Number(body.height ?? 1024));
  const b64 = body.response_format === 'base64';
  const data = b64
    ? { image_base64: Array.from({ length: n }, (_, i) => makePng(w, h, i).toString('base64')) }
    : { image_urls: Array.from({ length: n }, (_, i) => mockImageUrl('minimax', w, h, i)) };
  return json(200, { id: `mock-${randomUUID()}`, data, metadata: { success_count: String(n), failed_count: '0' }, base_resp: { status_code: 0, status_msg: 'success' } });
}


/* ---------------- 视频任务（状态随时间推进：<1.5s 排队，<3s 生成中，之后成功） ---------------- */

interface MockTask {
  id: string;
  provider: 'byteplus' | 'minimax';
  createdAt: number;
  body: Record<string, unknown>;
  cancelled?: boolean;
  deleted?: boolean;
}
const mockTasks = new Map<string, MockTask>();
const timing = { queuedMs: Number(process.env.ARK_MOCK_QUEUED_MS ?? 1500), runningMs: Number(process.env.ARK_MOCK_RUNNING_MS ?? 3000) };

/** 测试用：调整 mock 任务的状态推进时间 */
export function setMockTiming(t: { queuedMs: number; runningMs: number }): void {
  timing.queuedMs = t.queuedMs;
  timing.runningMs = t.runningMs;
}

function promptOf(body: Record<string, unknown>): string {
  const content = Array.isArray(body.content) ? (body.content as Record<string, unknown>[]) : [];
  return String(content.find((c) => c.type === 'text')?.text ?? body.prompt ?? '');
}

function phase(t: MockTask): 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' {
  if (t.cancelled) return 'cancelled';
  const age = Date.now() - t.createdAt;
  if (age < timing.queuedMs) return 'queued';
  if (age < timing.runningMs) return 'running';
  return promptOf(t.body).includes('MOCK_FAIL') ? 'failed' : 'succeeded';
}

function byteplusTaskView(t: MockTask): Record<string, unknown> {
  const status = phase(t);
  const created = Math.floor(t.createdAt / 1000);
  const base: Record<string, unknown> = { id: t.id, model: t.body.model, status, created_at: created, updated_at: Math.floor(Date.now() / 1000) };
  if (status === 'succeeded') {
    base.content = {
      video_url: `https://${MOCK_CDN_HOST}/byteplus/${t.id}.mp4`,
      ...(t.body.return_last_frame === true ? { last_frame_url: `https://${MOCK_CDN_HOST}/byteplus/${t.id}-last.jpeg` } : {}),
    };
    base.usage = { completion_tokens: 108900, total_tokens: 108900 };
    base.resolution = t.body.resolution ?? '720p';
    base.ratio = t.body.ratio === 'adaptive' || !t.body.ratio ? '16:9' : t.body.ratio;
    base.duration = typeof t.body.duration === 'number' && t.body.duration > 0 ? t.body.duration : 5;
    base.framespersecond = 24;
    base.seed = 12345;
  }
  if (status === 'failed') base.error = { code: 'InvalidParameter.TaskTypeConstraint', message: 'mock: task type constraint violated' };
  return base;
}

function minimaxTaskView(t: MockTask): Record<string, unknown> {
  const status = phase(t);
  const task: Record<string, unknown> = { id: t.id, model: t.body.model, status, created_at: Math.floor(t.createdAt / 1000), updated_at: Math.floor(Date.now() / 1000), task_type: 'generation', modality: 'video', resolution: t.body.resolution, duration: t.body.duration, ratio: '', usage: {} };
  if (status === 'succeeded') {
    task.content = { url: `https://${MOCK_CDN_HOST}/minimax/${t.id}.mp4` };
    task.usage = { total_seconds: t.body.duration, output_seconds: t.body.duration };
  }
  if (status === 'failed') task.error = { code: '1026', message: 'mock: sensitive content' };
  return { task };
}

function videoRoutes(u: URL, init: { method: string }, body: Record<string, unknown>, isMiniMax: boolean): Response | null {
  if (!isMiniMax && u.pathname.endsWith('/contents/generations/tasks')) {
    if (init.method === 'POST') {
      if (promptOf(body).includes('MOCK_REJECT')) return json(400, { error: { code: 'InvalidParameter', message: 'mock: rejected on submit. request id: mock0000000003', type: 'BadRequest' } });
      const id = `cgt-mock-${randomUUID().slice(0, 13)}`;
      mockTasks.set(id, { id, provider: 'byteplus', createdAt: Date.now(), body });
      return json(200, { id });
    }
    if (init.method === 'GET') {
      const items = [...mockTasks.values()].filter((t) => t.provider === 'byteplus' && !t.deleted).map(byteplusTaskView);
      return json(200, { items, total: items.length });
    }
  }
  const bpOne = /\/contents\/generations\/tasks\/([^/]+)$/.exec(u.pathname);
  if (!isMiniMax && bpOne) {
    const t = mockTasks.get(decodeURIComponent(bpOne[1]!));
    if (!t || t.deleted) return json(404, { error: { code: 'NotFound.TaskId', message: 'mock: task not found', type: 'NotFound' } });
    if (init.method === 'GET') return json(200, byteplusTaskView(t));
    if (init.method === 'DELETE') {
      const st = phase(t);
      if (st === 'queued') t.cancelled = true;
      else if (st === 'succeeded' || st === 'failed') t.deleted = true;
      else return json(400, { error: { code: 'InvalidParameter', message: `mock: cannot cancel or delete a ${st} task`, type: 'BadRequest' } });
      return json(200, {});
    }
  }
  if (isMiniMax && u.pathname === '/v2/video_generation' && init.method === 'POST') {
    const id = `mm-mock-${randomUUID().slice(0, 13)}`;
    mockTasks.set(id, { id, provider: 'minimax', createdAt: Date.now(), body });
    return json(200, { task_id: id });
  }
  const mmQuery = /^\/v2\/query\/video_generation\/([^/]+)$/.exec(u.pathname);
  if (isMiniMax && mmQuery && init.method === 'GET') {
    const t = mockTasks.get(decodeURIComponent(mmQuery[1]!));
    if (!t || t.deleted) return json(400, { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id (2013)', http_code: '400' } });
    return json(200, minimaxTaskView(t));
  }
  const mmDel = /^\/v2\/video_generation\/([^/]+)$/.exec(u.pathname);
  if (isMiniMax && mmDel && init.method === 'DELETE') {
    const t = mockTasks.get(decodeURIComponent(mmDel[1]!));
    if (!t || t.deleted) return json(400, { type: 'error', error: { type: 'bad_request_error', message: 'invalid task_id (2013)', http_code: '400' } });
    const st = phase(t);
    if (st === 'queued') {
      t.cancelled = true;
      return json(200, { task_id: t.id, action: 'cancelled', status: 'cancelled' });
    }
    if (st === 'succeeded' || st === 'failed') {
      t.deleted = true;
      return json(200, { task_id: t.id, action: 'deleted', status: st });
    }
    return json(400, { type: 'error', error: { type: 'bad_request_error', message: `cannot cancel ${st} task (2013)`, http_code: '400' } });
  }
  return null;
}

export const mockFetch: FetchLike = async (url, init) => {
  await new Promise((r) => setTimeout(r, 40));
  const u = new URL(url);
  const auth = init.headers.Authorization ?? '';
  const isMiniMax = u.hostname.endsWith('minimax.io');
  if (!auth.startsWith('Bearer ') || auth === 'Bearer invalid') {
    return isMiniMax
      ? json(200, { base_resp: { status_code: 1004, status_msg: "login fail: Please carry the API secret key in the 'Authorization' field of the request header" } })
      : json(401, { error: { code: 'AuthenticationError', message: 'the API key or AK/SK in the request is missing or invalid. request id: mock0000000002', param: '', type: 'Unauthorized' } });
  }
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  if (!isMiniMax && init.method === 'POST' && u.pathname.endsWith('/images/generations')) return byteplusImages(body);
  if (isMiniMax && init.method === 'POST' && u.pathname === '/v1/image_generation') return minimaxImages(body);
  // 订阅额度：返回格式文档未写，这里按 2026-10-08 实测的结构
  if (isMiniMax && init.method === 'GET' && u.pathname === '/v1/token_plan/remains') {
    const now = Date.now();
    return json(200, {
      model_remains: [
        {
          model_name: 'general',
          start_time: now - 3_600_000,
          end_time: now + 4 * 3_600_000,
          remains_time: 4 * 3_600_000,
          current_interval_total_count: 0,
          current_interval_usage_count: 0,
          current_interval_status: 1,
          current_interval_remaining_percent: 80,
          weekly_start_time: now - 2 * 86_400_000,
          weekly_end_time: now + 5 * 86_400_000,
          weekly_remains_time: 5 * 86_400_000,
          current_weekly_total_count: 0,
          current_weekly_usage_count: 0,
          current_weekly_status: 1,
          current_weekly_remaining_percent: 60,
        },
      ],
      base_resp: { status_code: 0, status_msg: 'success' },
    });
  }
  if (isMiniMax && init.method === 'GET' && u.pathname === '/v2/query/video_generation') {
    const items = [...mockTasks.values()].filter((t) => t.provider === 'minimax' && !t.deleted).map((t) => minimaxTaskView(t).task);
    return json(200, { items, total: items.length });
  }
  const video = videoRoutes(u, init, body, isMiniMax);
  if (video) return video;
  return json(404, { error: { code: 'NotFound', message: `mock: no route for ${init.method} ${u.pathname}` } });
};

/** mock 模式的下载器：为 mock CDN 链接现场生成图片 */
export class MockDownloader implements Downloader {
  async download(url: string, dest: string): Promise<Downloaded> {
    const u = new URL(url);
    if (u.hostname !== MOCK_CDN_HOST) throw new Error(`mock 模式下不下载外部链接：${u.hostname}`);
    if (u.pathname.endsWith('.mp4')) return { ...(await writeStreamAtomically(Readable.from([Buffer.from(MOCK_MP4_BASE64, 'base64')]), dest)), contentType: 'video/mp4' };
    if (u.pathname.endsWith('.jpeg')) return { ...(await writeStreamAtomically(Readable.from([Buffer.from(MOCK_FRAME_JPEG_BASE64, 'base64')]), dest)), contentType: 'image/jpeg' };
    const png = makePng(Number(u.searchParams.get('w') ?? 64), Number(u.searchParams.get('h') ?? 64), Number(u.searchParams.get('seed') ?? 0), u.searchParams.get('alpha') === '1');
    return { ...(await writeStreamAtomically(Readable.from([png]), dest)), contentType: 'image/png' };
  }
}
