import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import type { ResultAsset } from '../../shared/task/results.js';
import type { CaptureState, ResultRecord, TaskRecord } from '../../shared/task/records.js';
import { sniff } from '../media/sniff.js';
import type { Store } from '../store/store.js';
import { writeStreamAtomically, type Downloader } from './downloader.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 只保留安全字符，避免 Windows 非法字符与路径穿越 */
export function safeSegment(s: string, max = 64): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, max) || 'x';
}

function fileName(a: ResultAsset, ext: string): string {
  const prefix = a.role === 'image' ? '' : `${a.role === 'last_frame' ? 'last-frame' : a.role}-`;
  return `${prefix}${pad(a.index)}.${ext}`;
}

export interface CaptureOutcome {
  results: ResultRecord[];
  state: CaptureState;
  errors: string[];
  outputDir: string;
}

/**
 * 结果落盘：
 * - 目录 outputs/<本地日期>/<provider>-<任务号>/
 * - 账本键 provider:任务号:role:index，同一结果只下载一次（Seedance 2.5 链接有下载次数上限）
 * - 并发请求共享同一个进行中的下载
 */
export class CaptureService {
  private inflight = new Map<string, Promise<ResultRecord>>();

  constructor(
    private readonly store: Store,
    private readonly outputsRoot: string,
    private readonly downloader: Downloader,
  ) {}

  outputDirFor(task: Pick<TaskRecord, 'providerId' | 'upstreamTaskId' | 'id' | 'createdAt'>): string {
    return posix.join(localDate(task.createdAt), `${safeSegment(task.providerId)}-${safeSegment(task.upstreamTaskId ?? task.id)}`);
  }

  async capture(task: TaskRecord, assets: ResultAsset[]): Promise<CaptureOutcome> {
    const rel = task.outputDir ?? this.outputDirFor(task);
    await mkdir(join(this.outputsRoot, rel), { recursive: true });
    const settled = await Promise.allSettled(assets.map((a) => this.captureOne(task, rel, a)));
    const results: ResultRecord[] = [];
    const errors: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') results.push(s.value);
      else {
        const a = assets[i]!;
        errors.push(`${a.role} #${a.index}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
        // 下载失败也记一条结果，保留原始链接以便重试
        const rec: ResultRecord = {
          id: randomUUID(),
          taskId: task.id,
          index: a.index,
          role: a.role,
          kind: a.kind,
          path: null,
          mime: a.mime ?? null,
          bytes: null,
          width: a.width ?? null,
          height: a.height ?? null,
          remoteUrl: a.source.type === 'url' ? a.source.url : null,
          remoteExpiresAt: a.source.type === 'url' ? (a.source.expiresAt ?? null) : null,
          layer: a.layer ?? null,
        };
        this.store.upsertResult(rec);
        results.push(rec);
      }
    });
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    const state: CaptureState = assets.length === 0 ? 'done' : ok === assets.length ? 'done' : ok === 0 ? 'failed' : 'partial';
    await this.writeManifest(task, rel, results);
    return { results, state, errors, outputDir: rel };
  }

  private captureOne(task: TaskRecord, rel: string, a: ResultAsset): Promise<ResultRecord> {
    const key = `${task.providerId}:${task.upstreamTaskId ?? task.id}:${a.role}:${a.index}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.doCapture(task, rel, a, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doCapture(task: TaskRecord, rel: string, a: ResultAsset, key: string): Promise<ResultRecord> {
    const existing = this.store.getLedger(key);
    if (existing?.state === 'done' && existing.path && existsSync(join(this.outputsRoot, existing.path))) {
      const prev = this.store.listResults(task.id).find((r) => r.role === a.role && r.index === a.index && r.path === existing.path);
      if (prev) return prev;
    }
    this.store.setLedger(key, 'downloading', null);
    const tmpName = `.${randomUUID()}.tmp`;
    const tmpAbs = join(this.outputsRoot, rel, tmpName);
    let info: { bytes: number; sha256: string; head: Buffer; contentType: string | null };
    try {
      if (a.source.type === 'b64') {
        const buf = Buffer.from(a.source.data, 'base64');
        info = { ...(await writeStreamAtomically(Readable.from([buf]), tmpAbs)), contentType: a.source.mime ?? null };
      } else {
        info = await this.downloader.download(a.source.url, tmpAbs);
      }
    } catch (err) {
      this.store.setLedger(key, 'failed', null, err instanceof Error ? err.message : String(err));
      throw err;
    }
    const sniffed = sniff(info.head);
    const ext = sniffed.ext !== 'bin' ? sniffed.ext : (a.kind === 'video' ? 'mp4' : 'png');
    const finalRel = posix.join(rel, fileName(a, ext));
    await rename(tmpAbs, join(this.outputsRoot, finalRel));
    const rec: ResultRecord & { sha256: string } = {
      id: randomUUID(),
      taskId: task.id,
      index: a.index,
      role: a.role,
      kind: a.kind,
      path: finalRel,
      mime: sniffed.mime !== 'application/octet-stream' ? sniffed.mime : (info.contentType ?? a.mime ?? null),
      bytes: info.bytes,
      width: sniffed.width ?? a.width ?? null,
      height: sniffed.height ?? a.height ?? null,
      remoteUrl: a.source.type === 'url' ? a.source.url : null,
      remoteExpiresAt: a.source.type === 'url' ? (a.source.expiresAt ?? null) : null,
      layer: a.layer ?? null,
      sha256: info.sha256,
    };
    this.store.upsertResult(rec);
    this.store.setLedger(key, 'done', finalRel);
    return rec;
  }

  private async writeManifest(task: TaskRecord, rel: string, results: ResultRecord[]): Promise<void> {
    const manifest = {
      version: 1,
      capturedAt: new Date().toISOString(),
      task: {
        id: task.id,
        createdAt: task.createdAt,
        origin: task.origin,
        providerId: task.providerId,
        modelId: task.modelId,
        apiModel: task.apiModel,
        modeId: task.modeId,
        upstreamTaskId: task.upstreamTaskId,
        form: task.form,
        request: task.request,
        usage: task.usage,
        actual: task.actual,
      },
      files: results.map((r) => ({ role: r.role, index: r.index, path: r.path ? posix.basename(r.path) : null, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, layer: r.layer })),
    };
    await writeFile(join(this.outputsRoot, rel, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  /** 结果文件的绝对路径（不存在返回 null） */
  async absPath(relPath: string): Promise<string | null> {
    const abs = join(this.outputsRoot, relPath);
    try {
      return (await stat(abs)).isFile() ? abs : null;
    } catch {
      return null;
    }
  }
}
