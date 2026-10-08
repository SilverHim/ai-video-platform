import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keystore, maskKey, normalizeKey } from '../keystore.js';
import { BASE, makeApp, tempDir, WEB_HEADERS, json } from './helpers.js';

const SECRET = 'sk-test-0123456789abcdefSECRET';
let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  await cleanup();
});

describe('MiniMax 两种 Key', () => {
  const SUB = 'sk-cp-0123456789abcdefSUBSCRIPTION';
  const PAYGO = 'sk-api-0123456789abcdefPAYGO';

  it('订阅 / 按量各占一个槽位；不指定时优先订阅，指定了只用那种', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const ks = new Keystore(`${tmp.dir}/keys.json`, {});
    ks.set('minimax', PAYGO);
    expect(ks.resolve('minimax')).toEqual({ keyId: 'minimax', kind: 'paygo', key: PAYGO });
    expect(ks.resolve('minimax', 'subscription')).toBeNull();
    ks.set('minimax-subscription', SUB);
    expect(ks.resolve('minimax')).toEqual({ keyId: 'minimax-subscription', kind: 'subscription', key: SUB });
    expect(ks.resolve('minimax', 'paygo')?.key).toBe(PAYGO);
    expect(ks.status('minimax-subscription')).toMatchObject({ provider: 'minimax', kind: 'subscription', configured: true });
    expect(ks.list().map((k) => k.keyId)).toEqual(['byteplus', 'minimax', 'minimax-subscription']);
    // BytePlus 只有按量
    expect(ks.resolve('byteplus', 'subscription')).toBeNull();
  });

  it('升级：旧文件里 MiniMax 槽位存的是订阅 Key（sk-cp-）时，启动时挪到订阅槽位（只做一次）', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const file = `${tmp.dir}/keys.json`;
    writeFileSync(file, JSON.stringify({ version: 1, providers: { minimax: { apiKey: SUB, updatedAt: 1 } } }));
    const ks = new Keystore(file, {});
    expect(ks.status('minimax').configured).toBe(false);
    expect(ks.get('minimax-subscription')).toBe(SUB);
    expect(JSON.parse(readFileSync(file, 'utf8')).providers).toEqual({ 'minimax-subscription': { apiKey: SUB, updatedAt: 1 } });
  });

  it('按量槽位拒绝 sk-cp-（订阅 Key），清除订阅时不会把别的槽位挪来挪去', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const ks = new Keystore(`${tmp.dir}/keys.json`, {});
    expect(() => ks.set('minimax', SUB)).toThrow('订阅 Key');
    ks.set('minimax', PAYGO);
    ks.set('minimax-subscription', SUB);
    expect(ks.clear('minimax-subscription').configured).toBe(false);
    expect(ks.get('minimax')).toBe(PAYGO);
  });

  it('环境变量 MINIMAX_SUBSCRIPTION_KEY', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const ks = new Keystore(`${tmp.dir}/keys.json`, { MINIMAX_SUBSCRIPTION_KEY: SUB });
    expect(ks.resolve('minimax')).toMatchObject({ kind: 'subscription', key: SUB });
    expect(ks.status('minimax-subscription').source).toBe('env');
  });
});

describe('Keystore', () => {
  it('打码只保留首尾各 4 位', () => {
    expect(maskKey(SECRET)).toBe('sk-t…CRET');
    expect(maskKey('short')).toBe('••••');
  });

  it('规范化：去掉 Bearer 前缀与首尾空白，拒绝空值和内部空白', () => {
    expect(normalizeKey(`  Bearer ${SECRET}  `)).toBe(SECRET);
    expect(() => normalizeKey('')).toThrow();
    expect(() => normalizeKey('a b')).toThrow();
    expect(() => normalizeKey(123)).toThrow();
  });

  it('写入、读取、清除；文件权限 0600（POSIX）', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const file = `${tmp.dir}/keys.json`;
    const ks = new Keystore(file, {});
    expect(ks.status('byteplus')).toMatchObject({ configured: false, source: 'none' });
    ks.set('byteplus', SECRET, 1000);
    expect(ks.get('byteplus')).toBe(SECRET);
    expect(ks.status('byteplus')).toEqual({ keyId: 'byteplus', provider: 'byteplus', kind: 'paygo', configured: true, source: 'file', masked: maskKey(SECRET), updatedAt: 1000 });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    ks.clear('byteplus');
    expect(ks.get('byteplus')).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  it('环境变量优先，且来源标记为 env', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const ks = new Keystore(`${tmp.dir}/keys.json`, { MINIMAX_API_KEY: SECRET });
    ks.set('minimax', 'sk-file-key-should-not-win-xxxx');
    expect(ks.get('minimax')).toBe(SECRET);
    expect(ks.status('minimax').source).toBe('env');
  });
});

describe('/api/keys', () => {
  it('PUT 后列表只返回打码值，响应与日志都不含原文', async () => {
    const made = makeApp();
    cleanup = made.cleanup;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
    const spyErr = vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));

    const put = await made.app.request(`${BASE}/api/keys/byteplus`, {
      method: 'PUT',
      headers: { ...WEB_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: SECRET }),
    });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(SECRET);

    const list = await made.app.request(`${BASE}/api/keys`, { headers: WEB_HEADERS });
    const listText = await list.text();
    expect(listText).not.toContain(SECRET);
    expect(JSON.parse(listText).keys).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'byteplus', configured: true, masked: maskKey(SECRET) })]),
    );
    expect(readFileSync(made.config.paths.keys, 'utf8')).toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
    spy.mockRestore();
    spyErr.mockRestore();
  });

  it('未知服务商返回 404，非法 Key 返回 400', async () => {
    const made = makeApp();
    cleanup = made.cleanup;
    const unknown = await made.app.request(`${BASE}/api/keys/openai`, { method: 'PUT', headers: WEB_HEADERS, body: '{}' });
    expect(unknown.status).toBe(404);
    const bad = await made.app.request(`${BASE}/api/keys/minimax`, {
      method: 'PUT',
      headers: { ...WEB_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: '   ' }),
    });
    expect(bad.status).toBe(400);
  });

  it('DELETE 清除', async () => {
    const made = makeApp();
    cleanup = made.cleanup;
    made.keystore.set('minimax', SECRET);
    const res = await made.app.request(`${BASE}/api/keys/minimax`, { method: 'DELETE', headers: WEB_HEADERS });
    expect(await json(res)).toMatchObject({ key: { configured: false } });
  });
});
