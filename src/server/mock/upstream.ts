import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { writeStreamAtomically, type Downloaded, type Downloader } from '../capture/downloader.js';
import type { FetchLike } from '../upstream/http.js';
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

/** 实际生成的 mock 图片控制在 256 以内，避免占空间 */
const small = (w: number, h: number): [number, number] => {
  const s = Math.min(1, 256 / Math.max(w, h));
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
  if (!isMiniMax && init.method === 'GET' && u.pathname.endsWith('/contents/generations/tasks')) return json(200, { items: [], total: 0 });
  if (isMiniMax && init.method === 'POST' && u.pathname === '/v1/image_generation') return minimaxImages(body);
  if (isMiniMax && init.method === 'GET' && u.pathname === '/v2/query/video_generation') return json(200, { items: [], total: 0 });
  return json(404, { error: { code: 'NotFound', message: `mock: no route for ${init.method} ${u.pathname}` } });
};

/** mock 模式的下载器：为 mock CDN 链接现场生成图片 */
export class MockDownloader implements Downloader {
  async download(url: string, dest: string): Promise<Downloaded> {
    const u = new URL(url);
    if (u.hostname !== MOCK_CDN_HOST) throw new Error(`mock 模式下不下载外部链接：${u.hostname}`);
    const png = makePng(Number(u.searchParams.get('w') ?? 64), Number(u.searchParams.get('h') ?? 64), Number(u.searchParams.get('seed') ?? 0), u.searchParams.get('alpha') === '1');
    return { ...(await writeStreamAtomically(Readable.from([png]), dest)), contentType: 'image/png' };
  }
}
