import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeRemoteUrl, isPrivateAddress } from '../capture/net-guard.js';
import { safeSegment, localDate } from '../capture/capture.js';
import { sniff } from '../media/sniff.js';
import { makePng } from '../mock/png.js';
import { Store } from '../store/store.js';
import { tempDir } from './helpers.js';

let cleanup: () => void | Promise<void> = () => {};
afterEach(async () => {
  await cleanup();
});

describe('Store', () => {
  it('迁移幂等，任务/结果/交换记录/账本读写', () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const file = `${tmp.dir}/app.db`;
    const s1 = new Store(file);
    s1.close();
    const s = new Store(file);
    const now = 1_700_000_000_000;
    s.insertTask({ id: 't1', createdAt: now, updatedAt: now, origin: 'web', providerId: 'byteplus', modelId: 'm', apiModel: 'm-1', modeId: 'generate', kind: 'sync', status: 'submitting', upstreamTaskId: null, baseUrlId: 'ap', form: { providerId: 'byteplus', modelId: 'm', modeId: 'generate', values: { a: 1 }, slots: {}, prompt: 'p' }, request: null, error: null, failures: [], usage: null, actual: null, capture: 'none', outputDir: null, parentTaskId: null, costEstimate: { amount: 0.1, currency: 'USD' }, favorite: false, note: null });
    s.updateTask('t1', { status: 'succeeded', usage: { n: 1 }, upstreamTaskId: 'cgt-1' }, now + 5);
    s.upsertResult({ id: 'r1', taskId: 't1', index: 0, role: 'image', kind: 'image', path: '2026-10-08/x/00.png', mime: 'image/png', bytes: 10, width: 1, height: 1, remoteUrl: null, remoteExpiresAt: null, layer: null });
    s.upsertResult({ id: 'r2', taskId: 't1', index: 0, role: 'image', kind: 'image', path: '2026-10-08/x/00b.png', mime: 'image/png', bytes: 11, width: 1, height: 1, remoteUrl: null, remoteExpiresAt: null, layer: null });
    const t = s.getTask('t1')!;
    expect(t).toMatchObject({ status: 'succeeded', updatedAt: now + 5, usage: { n: 1 }, form: { values: { a: 1 } }, costEstimate: { amount: 0.1 } });
    expect(t.results).toHaveLength(1);
    expect(t.results[0]!.path).toBe('2026-10-08/x/00b.png');
    expect(s.findByUpstream('byteplus', 'cgt-1')?.id).toBe('t1');
    for (let i = 0; i < 60; i++) s.addExchange({ taskId: 't1', at: i, kind: 'poll', status: 200, body: `p${i}` }, 50);
    s.addExchange({ taskId: 't1', at: 99, kind: 'submit', status: 200, body: 'first' });
    expect(s.listExchanges('t1').filter((e) => e.kind === 'poll')).toHaveLength(50);
    s.setLedger('k', 'done', 'a/b.png');
    expect(s.getLedger('k')).toEqual({ state: 'done', path: 'a/b.png' });
    expect(s.listTasks({ status: 'succeeded' })).toHaveLength(1);
    expect(s.listTasks({ status: 'failed' })).toHaveLength(0);
    expect(s.deleteTask('t1')).toBe(true);
    expect(s.listResults('t1')).toHaveLength(0);
    s.close();
  });
});

describe('sniff / makePng', () => {
  it('识别 PNG 宽高与透明通道', () => {
    expect(sniff(makePng(12, 7))).toMatchObject({ mime: 'image/png', ext: 'png', width: 12, height: 7, hasAlpha: false });
    expect(sniff(makePng(4, 4, 0, true))).toMatchObject({ hasAlpha: true });
  });
  it('识别 JPEG 与 MP4/MOV 头', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03]);
    expect(sniff(jpeg)).toMatchObject({ mime: 'image/jpeg', width: 64, height: 32 });
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]);
    expect(sniff(mp4)).toMatchObject({ ext: 'mp4', kind: 'video' });
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ')]);
    expect(sniff(mov)).toMatchObject({ ext: 'mov' });
    expect(sniff(Buffer.from('hello')).kind).toBe('other');
  });
});

describe('net-guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])('%s 是内网', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1'])('%s 不是内网', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it('拒绝 http 与内网字面量', async () => {
    await expect(assertSafeRemoteUrl('http://example.com/a.png')).rejects.toThrow('https');
    await expect(assertSafeRemoteUrl('https://127.0.0.1/a.png')).rejects.toThrow('内网');
    await expect(assertSafeRemoteUrl('not a url')).rejects.toThrow();
  });
});

describe('capture 工具函数', () => {
  it('safeSegment 去掉非法字符', () => {
    expect(safeSegment('cgt-2026:a/b\\c?*')).toBe('cgt-2026_a_b_c__');
    expect(safeSegment('..secret')).toBe('_secret');
  });
  it('localDate 格式', () => {
    expect(localDate(new Date(2026, 9, 8, 23, 59).getTime())).toBe('2026-10-08');
  });
});
