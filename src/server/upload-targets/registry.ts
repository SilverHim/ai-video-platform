import { T } from '../../shared/catalog/helpers.js';
import { minimaxFiles } from './minimax-files.js';
import { tmpfiles, uguu } from './temp-hosts.js';
import type { UploadTarget } from './types.js';

/** mock 模式用：不联网，返回 mock CDN 链接 */
export const mockTempHost: UploadTarget = {
  id: 'mock-temp-host',
  kind: 'temp-host',
  label: T('Mock 托管（不联网）', 'Mock host (offline)'),
  privacy: 'public-link',
  maxBytes: 512 * 1024 * 1024,
  ttlMs: 3 * 3600_000,
  async upload(file) {
    return { url: `https://mock.cdn.invalid/uploads/${file.sha256}.${file.filename.split('.').pop() ?? 'bin'}`, expiresAt: Date.now() + this.ttlMs, verified: { ok: true, note: 'mock' } };
  },
};

export const mockProviderFiles: UploadTarget = {
  ...minimaxFiles,
  async upload(file) {
    return { url: `mm_file://${BigInt('0x' + file.sha256.slice(0, 15)).toString()}`, expiresAt: Date.now() + this.ttlMs };
  },
};

export interface UploadTargets {
  /** 公共临时托管（按用户选择：uguu 默认 / tmpfiles 备选） */
  tempHosts: Record<string, UploadTarget>;
  defaultTempHost: string;
  /** 服务商私有文件存储（providerId → target） */
  providerFiles: Record<string, UploadTarget>;
}

export function createUploadTargets(mock: boolean): UploadTargets {
  if (mock) return { tempHosts: { uguu: { ...mockTempHost, id: 'uguu' }, tmpfiles: { ...mockTempHost, id: 'tmpfiles', ttlMs: 24 * 3600_000 } }, defaultTempHost: 'uguu', providerFiles: { minimax: mockProviderFiles } };
  return { tempHosts: { uguu, tmpfiles }, defaultTempHost: 'uguu', providerFiles: { minimax: minimaxFiles } };
}
