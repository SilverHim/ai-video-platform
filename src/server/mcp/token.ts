import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/** MCP 本机访问令牌：<dataDir>/mcp-token（POSIX 0600），可轮换 */
export class McpTokenStore {
  private cached: string | null = null;

  constructor(private readonly file: string) {}

  get(): string {
    if (this.cached) return this.cached;
    if (existsSync(this.file)) {
      const t = readFileSync(this.file, 'utf8').trim();
      if (/^[a-f0-9]{64}$/.test(t)) return (this.cached = t);
    }
    return this.rotate();
  }

  rotate(): string {
    const token = randomBytes(32).toString('hex');
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, token, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
    this.cached = token;
    return token;
  }

  /** 校验 Authorization: Bearer <token>（常量时间比较） */
  verify(authorization: string | undefined | null): boolean {
    const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(authorization?.trim() ?? '');
    if (!m) return false;
    const a = Buffer.from(m[1]!.toLowerCase());
    const b = Buffer.from(this.get());
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
