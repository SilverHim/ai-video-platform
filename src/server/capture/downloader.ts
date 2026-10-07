import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { sleep } from '../upstream/limiter.js';
import { USER_AGENT } from '../upstream/http.js';
import { assertSafeRemoteUrl } from './net-guard.js';

export interface Downloaded {
  bytes: number;
  sha256: string;
  /** 前 64KB，用于识别格式 */
  head: Buffer;
  contentType: string | null;
}

export interface Downloader {
  download(url: string, dest: string, signal?: AbortSignal): Promise<Downloaded>;
}

/** 把字节流写到 dest（先写 .part 再改名），同时算 sha256、截取文件头 */
export async function writeStreamAtomically(source: NodeJS.ReadableStream | Readable, dest: string): Promise<Omit<Downloaded, 'contentType'>> {
  const part = `${dest}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  const headChunks: Buffer[] = [];
  let headLen = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      if (headLen < 65536) {
        headChunks.push(chunk.subarray(0, 65536 - headLen));
        headLen += Math.min(chunk.length, 65536 - headLen);
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(source, tap, createWriteStream(part));
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  return { bytes, sha256: hash.digest('hex'), head: Buffer.concat(headChunks) };
}

export class HttpDownloader implements Downloader {
  private agent = new Agent({ connectTimeout: 15_000, headersTimeout: 60_000, bodyTimeout: 60_000 });

  async download(url: string, dest: string, signal?: AbortSignal): Promise<Downloaded> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const safe = await assertSafeRemoteUrl(url);
        const res = await undiciFetch(safe, { headers: { 'User-Agent': USER_AGENT }, dispatcher: this.agent, redirect: 'follow', ...(signal ? { signal } : {}) });
        if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`);
        if (res.url && res.url !== safe.toString()) await assertSafeRemoteUrl(res.url);
        const out = await writeStreamAtomically(Readable.fromWeb(res.body as WebReadableStream), dest);
        return { ...out, contentType: res.headers.get('content-type') };
      } catch (err) {
        lastErr = err;
        if (signal?.aborted || (err instanceof Error && err.name === 'UnsafeUrlError')) break;
        if (attempt < 3) await sleep(1000 * attempt);
      }
    }
    throw lastErr;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
