import { readFileSync, renameSync, writeFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { KEY_IDS, KEY_SLOTS, keyIdOf, keyKindsOf, type ControlCredentialStatus, type KeyId, type KeyKind, type KeySource, type KeyStatus, type ProviderId } from '../shared/api-contract.js';

/** 环境变量覆盖：优先于 keys.json */
export const KEY_ENV_VARS: Record<KeyId, string> = {
  byteplus: 'ARK_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-subscription': 'MINIMAX_SUBSCRIPTION_KEY',
};

/** MiniMax 订阅 Key 的前缀（官方 CLI 文档：sk-cp- 订阅、sk-api- 按量） */
export const SUBSCRIPTION_PREFIX = 'sk-cp-';

interface StoredKey {
  apiKey: string;
  updatedAt: number;
}

/** BytePlus 控制面 AK/SK（推理接入点管理用） */
export const CONTROL_ENV_VARS = { accessKeyId: 'BYTEPLUS_ACCESS_KEY_ID', secretAccessKey: 'BYTEPLUS_SECRET_ACCESS_KEY' } as const;

interface StoredControl {
  accessKeyId: string;
  secretAccessKey: string;
  updatedAt: number;
}

interface KeyFile {
  version: 1;
  /** 键是 KeyId（旧文件里只有 byteplus / minimax，兼容） */
  providers: Partial<Record<KeyId, StoredKey>>;
  controlPlane?: StoredControl;
}

export class KeyValidationError extends Error {}

/** 打码：保留前 4 位和后 4 位，短 Key 全部隐藏 */
export function maskKey(key: string): string {
  if (key.length <= 12) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function normalizeCredential(raw: unknown, label: string): string {
  if (typeof raw !== 'string') throw new KeyValidationError(`${label} 必须是字符串`);
  const v = raw.trim();
  if (!v) throw new KeyValidationError(`${label} 不能为空`);
  if (v.length > 512) throw new KeyValidationError(`${label} 过长`);
  if (/\s/.test(v)) throw new KeyValidationError(`${label} 不能包含空白字符`);
  return v;
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
  ) {
    this.migrateLegacy();
  }

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

  /**
   * 升级兼容（只在启动时做一次）：以前只有一个 MiniMax 槽位，填进去的若是订阅 Key（sk-cp-），挪到订阅槽位。
   * 之后按量槽位不再接受 sk-cp-（见 set），所以不会再出现需要迁移的数据
   */
  private migrateLegacy(): void {
    try {
      const data = this.read();
      const mm = data.providers.minimax;
      if (typeof mm?.apiKey === 'string' && mm.apiKey.startsWith(SUBSCRIPTION_PREFIX) && !data.providers['minimax-subscription']) {
        data.providers['minimax-subscription'] = mm;
        delete data.providers.minimax;
        this.write(data);
      }
    } catch {
      // 迁移失败不影响启动：Key 仍在原槽位，用户可在设置页重新填写
    }
  }

  private write(data: KeyFile): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** 服务端内部取原文 Key；没有配置返回 null */
  get(keyId: KeyId): string | null {
    const fromEnv = this.env[KEY_ENV_VARS[keyId]]?.trim();
    if (fromEnv) return fromEnv;
    return this.read().providers[keyId]?.apiKey ?? null;
  }

  /**
   * 按服务商取 Key：指定了类型就只用那种（不擅自换成按量，避免不知不觉扣余额）；
   * 没指定时有订阅 Key 用订阅，否则用按量
   */
  resolve(provider: string, pref?: KeyKind): { keyId: KeyId; kind: KeyKind; key: string } | null {
    const pick = (kind: KeyKind) => {
      const keyId = keyIdOf(provider, kind);
      const key = keyId ? this.get(keyId) : null;
      return keyId && key ? { keyId, kind, key } : null;
    };
    if (pref) return pick(pref);
    const kinds = keyKindsOf(provider);
    return (kinds.includes('subscription') ? pick('subscription') : null) ?? pick('paygo');
  }

  status(keyId: KeyId): KeyStatus {
    const base = { keyId, provider: KEY_SLOTS[keyId].provider as ProviderId, kind: KEY_SLOTS[keyId].kind };
    const fromEnv = this.env[KEY_ENV_VARS[keyId]]?.trim();
    if (fromEnv) return { ...base, configured: true, source: 'env', masked: maskKey(fromEnv), updatedAt: null };
    const stored = this.read().providers[keyId];
    if (stored) return { ...base, configured: true, source: 'file', masked: maskKey(stored.apiKey), updatedAt: stored.updatedAt };
    return { ...base, configured: false, source: 'none' satisfies KeySource, masked: null, updatedAt: null };
  }

  list(): KeyStatus[] {
    return KEY_IDS.map((k) => this.status(k));
  }

  set(keyId: KeyId, rawKey: unknown, now = Date.now()): KeyStatus {
    const apiKey = normalizeKey(rawKey);
    // sk-cp- 一定是订阅 Key（官方 CLI 文档）：放进按量槽位会用错额度，直接拒绝
    if (KEY_SLOTS[keyId].kind === 'paygo' && keyId === 'minimax' && apiKey.startsWith(SUBSCRIPTION_PREFIX)) {
      throw new KeyValidationError('这是订阅 Key（sk-cp- 开头），请填到「订阅 Key」一栏');
    }
    const data = this.read();
    data.providers[keyId] = { apiKey, updatedAt: now };
    this.write(data);
    return this.status(keyId);
  }

  clear(keyId: KeyId): KeyStatus {
    const data = this.read();
    if (data.providers[keyId]) {
      delete data.providers[keyId];
      this.writeOrRemove(data);
    }
    return this.status(keyId);
  }

  /** 文件里什么都不剩时删掉文件 */
  private writeOrRemove(data: KeyFile): void {
    if (Object.keys(data.providers).length === 0 && !data.controlPlane) {
      if (existsSync(this.file)) unlinkSync(this.file);
    } else this.write(data);
  }

  /* ---------------- 控制面 AK/SK ---------------- */

  /** 服务端内部取原文 AK/SK；环境变量两项都设置时优先 */
  getControl(): { accessKeyId: string; secretAccessKey: string } | null {
    const ak = this.env[CONTROL_ENV_VARS.accessKeyId]?.trim();
    const sk = this.env[CONTROL_ENV_VARS.secretAccessKey]?.trim();
    if (ak && sk) return { accessKeyId: ak, secretAccessKey: sk };
    const stored = this.read().controlPlane;
    return stored ? { accessKeyId: stored.accessKeyId, secretAccessKey: stored.secretAccessKey } : null;
  }

  controlStatus(): ControlCredentialStatus {
    const ak = this.env[CONTROL_ENV_VARS.accessKeyId]?.trim();
    const sk = this.env[CONTROL_ENV_VARS.secretAccessKey]?.trim();
    if (ak && sk) return { configured: true, source: 'env', maskedAccessKeyId: maskKey(ak), updatedAt: null };
    const stored = this.read().controlPlane;
    if (stored) return { configured: true, source: 'file', maskedAccessKeyId: maskKey(stored.accessKeyId), updatedAt: stored.updatedAt };
    return { configured: false, source: 'none', maskedAccessKeyId: null, updatedAt: null };
  }

  setControl(rawAk: unknown, rawSk: unknown, now = Date.now()): ControlCredentialStatus {
    const accessKeyId = normalizeCredential(rawAk, 'AccessKey ID');
    const secretAccessKey = normalizeCredential(rawSk, 'Secret Access Key');
    const data = this.read();
    data.controlPlane = { accessKeyId, secretAccessKey, updatedAt: now };
    this.write(data);
    return this.controlStatus();
  }

  clearControl(): ControlCredentialStatus {
    const data = this.read();
    if (data.controlPlane) {
      delete data.controlPlane;
      this.writeOrRemove(data);
    }
    return this.controlStatus();
  }
}
