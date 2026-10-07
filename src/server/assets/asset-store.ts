import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import type { MediaMeta } from '../../shared/catalog/types.js';
import { writeStreamAtomically } from '../capture/downloader.js';
import { sniff } from '../media/sniff.js';
import type { AssetRecord, Store } from '../store/store.js';

export class AssetTooLargeError extends Error {}

/** 输入素材存储：<dataDir>/assets/<sha 前两位>/<sha>.<ext>，按 sha256 去重 */
export class AssetStore {
  constructor(
    private readonly store: Store,
    private readonly dataDir: string,
    private readonly maxBytes = 512 * 1024 * 1024,
  ) {}

  absPath(a: AssetRecord): string {
    return join(this.dataDir, a.path);
  }

  async save(source: Readable, info: { filename?: string; mime?: string }): Promise<AssetRecord> {
    const tmpDir = join(this.dataDir, '.cache', 'incoming');
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `${randomUUID()}.upload`);
    let seen = 0;
    const max = this.maxBytes;
    const limited = source.pipe(
      new Transform({
        transform(chunk: Buffer, _e, cb) {
          seen += chunk.length;
          if (seen > max) cb(new AssetTooLargeError(`文件超过 ${(max / 1048576).toFixed(0)} MB`));
          else cb(null, chunk);
        },
      }),
    );
    const out = await writeStreamAtomically(limited, tmp);
    const existing = this.store.getAssetBySha(out.sha256);
    if (existing) {
      await rm(tmp, { force: true });
      return existing;
    }
    const s = sniff(out.head);
    const ext = s.ext !== 'bin' ? s.ext : (info.filename?.split('.').pop()?.toLowerCase() ?? 'bin');
    const rel = posix.join('assets', out.sha256.slice(0, 2), `${out.sha256}.${ext}`);
    await mkdir(join(this.dataDir, 'assets', out.sha256.slice(0, 2)), { recursive: true });
    await rename(tmp, join(this.dataDir, rel));
    const kind = s.kind === 'other' ? guessKind(info.mime) : s.kind;
    const meta: MediaMeta | null = kind
      ? { kind, mime: s.mime !== 'application/octet-stream' ? s.mime : (info.mime ?? 'application/octet-stream'), bytes: out.bytes, ...(s.width ? { width: s.width } : {}), ...(s.height ? { height: s.height } : {}), ...(s.hasAlpha !== undefined ? { hasAlpha: s.hasAlpha } : {}) }
      : null;
    const rec: AssetRecord = {
      id: randomUUID(),
      sha256: out.sha256,
      filename: info.filename ? basename(info.filename) : null,
      mime: meta?.mime ?? info.mime ?? 'application/octet-stream',
      bytes: out.bytes,
      path: rel,
      createdAt: Date.now(),
      meta,
      uploads: {},
    };
    this.store.insertAsset(rec);
    return rec;
  }

  /** MCP 传本地文件路径时用：复制进素材库 */
  async saveFromPath(absPath: string): Promise<AssetRecord> {
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error(`不是文件：${absPath}`);
    if (st.size > this.maxBytes) throw new AssetTooLargeError(`文件超过 ${(this.maxBytes / 1048576).toFixed(0)} MB`);
    return this.save(createReadStream(absPath), { filename: basename(absPath) });
  }

  async readBytes(a: AssetRecord): Promise<Buffer> {
    return readFile(this.absPath(a));
  }
}

function guessKind(mime?: string): MediaMeta['kind'] | null {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}
