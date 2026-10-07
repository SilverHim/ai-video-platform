import type { I18nText } from '../../shared/i18n.js';

export interface SpooledFile {
  path: string;
  bytes: number;
  sha256: string;
  mime: string;
  filename: string;
}

export interface VerifyResult {
  ok: boolean;
  status?: number;
  contentType?: string | null;
  totalBytes?: number | null;
  note?: string;
}

export interface UploadResult {
  url: string;
  /** 过期时间（毫秒）；null 表示未知 */
  expiresAt: number | null;
  verified?: VerifyResult;
}

export interface UploadTarget {
  id: string;
  kind: 'temp-host' | 'provider-files';
  label: I18nText;
  /** public-link：任何拿到链接的人都能下载，上传前必须征得同意 */
  privacy: 'public-link' | 'provider-private';
  maxBytes: number;
  /** 保留时长（毫秒） */
  ttlMs: number;
  /** 只给这些服务商用 */
  providers?: string[];
  homepage?: string;
  upload(file: SpooledFile, opts: { signal?: AbortSignal; providerKey?: string }): Promise<UploadResult>;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly code = 'UPLOAD_FAILED',
  ) {
    super(message);
  }
}
