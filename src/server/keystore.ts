import { readFileSync, renameSync, writeFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { PROVIDER_IDS, type KeySource, type KeyStatus, type ProviderId } from '../shared/api-contract.js';

/** 环境变量覆盖：优先于 keys.json */
export const KEY_ENV_VARS: Record<ProviderId, string> = {
  byteplus: 'ARK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
};

interface StoredKey {
  apiKey: string;
  updatedAt: number;
}

interface KeyFile {
  version: 1;
  providers: Partial<Record<ProviderId, StoredKey>>;
}

export class KeyValidationError extends Error {}

/** 打码：保留前 4 位和后 4 位，短 Key 全部隐藏 */
export function maskKey(key: string): string {
  if (key.length <= 12) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function normalizeKey(raw: unknown): string {
  if (typeof raw !== 'string') throw new KeyValidationError('apiKey 必须是字符串');
  const key = raw.trim().replace(/^Bearer\s+/i, '');
  if (!key) throw new KeyValidationError('apiKey 不能为空');
  if (key.length > 1024) throw new KeyValidationError('apiKey 过长');
  if (/\s/.test(key)) throw new KeyValidationError('apiKey 不能包含空白字符');
  // 不校验具体格式：BytePlus 2026-09-17 之后的新 Key 格式文档未公开
  return key;
}

/**
 * Key 存储：<dataDir>/keys.json（POSIX 下权限 0600），环境变量可覆盖。
 * 原文 Key 只在服务端内存与该文件中出现，对外只给打码值。
 */
export class Keystore {
  constructor(
    private readonly file: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private read(): KeyFile {
    if (!existsSync(this.file)) return { version: 1, providers: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as KeyFile;
      if (parsed && parsed.version === 1 && typeof parsed.providers === 'object') return parsed;
    } catch {
      // 文件损坏时当作空；写入时会覆盖
    }
    return { version: 1, providers: {} };
  }

  private write(data: KeyFile): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** 服务端内部取原文 Key；没有配置返回 null */
  get(provider: ProviderId): string | null {
    const fromEnv = this.env[KEY_ENV_VARS[provider]]?.trim();
    if (fromEnv) return fromEnv;
    return this.read().providers[provider]?.apiKey ?? null;
  }

  status(provider: ProviderId): KeyStatus {
    const fromEnv = this.env[KEY_ENV_VARS[provider]]?.trim();
    if (fromEnv) return { provider, configured: true, source: 'env', masked: maskKey(fromEnv), updatedAt: null };
    const stored = this.read().providers[provider];
    if (stored) return { provider, configured: true, source: 'file', masked: maskKey(stored.apiKey), updatedAt: stored.updatedAt };
    return { provider, configured: false, source: 'none' satisfies KeySource, masked: null, updatedAt: null };
  }

  list(): KeyStatus[] {
    return PROVIDER_IDS.map((p) => this.status(p));
  }

  set(provider: ProviderId, rawKey: unknown, now = Date.now()): KeyStatus {
    const apiKey = normalizeKey(rawKey);
    const data = this.read();
    data.providers[provider] = { apiKey, updatedAt: now };
    this.write(data);
    return this.status(provider);
  }

  clear(provider: ProviderId): KeyStatus {
    const data = this.read();
    if (data.providers[provider]) {
      delete data.providers[provider];
      if (Object.keys(data.providers).length === 0 && existsSync(this.file)) unlinkSync(this.file);
      else this.write(data);
    }
    return this.status(provider);
  }
}
