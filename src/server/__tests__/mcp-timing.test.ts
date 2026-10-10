import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultRecord, TaskRecord } from '../../shared/task/records.js';
import { imageBlocks } from '../mcp/images.js';
import { beforeDeadline, DEFAULT_CALL_BUDGET, setCallBudget, waitWithin } from '../mcp/timing.js';
import { tempDir } from './helpers.js';

// 假时钟：Date.now 与定时器都由测试推进，不受机器快慢影响（文件读写照常是真实 I/O）
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  setCallBudget(DEFAULT_CALL_BUDGET);
});

describe('调用时间预算', () => {
  it('waitWithin：请求值与剩余预算取小，用完为 0，显式 0 保持 0', () => {
    const now = Date.now();
    expect(waitWithin(540, now)).toBe(540);
    expect(waitWithin(540, now - 90_000)).toBe(470);
    expect(waitWithin(30, now - 90_000)).toBe(30);
    expect(waitWithin(540, now - 600_000)).toBe(0);
    expect(waitWithin(0, now)).toBe(0);
  });

  it('beforeDeadline：先结束返回结果，先失败照常抛出，先到截止返回 null', async () => {
    expect(await beforeDeadline(Promise.resolve(1), Date.now() + 1000)).toBe(1);
    await expect(beforeDeadline(Promise.reject(new Error('boom')), Date.now() + 1000)).rejects.toThrow('boom');
    const slow = beforeDeadline(new Promise<number>(() => undefined), Date.now() + 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(await slow).toBeNull();
    // 截止后才失败：不会变成未处理的拒绝（vitest 会把未处理的拒绝报成失败）
    const late = beforeDeadline(new Promise<number>((_, reject) => setTimeout(() => reject(new Error('late')), 30)), Date.now() + 5);
    await vi.advanceTimersByTimeAsync(5);
    expect(await late).toBeNull();
    await vi.advanceTimersByTimeAsync(30);
  });
});

describe('内联缩略图', () => {
  const result = (path: string, bytes: number): ResultRecord => ({ id: path, taskId: 't', index: 0, role: 'image', kind: 'image', path, mime: 'image/png', bytes, width: null, height: null }) as ResultRecord;
  const taskWith = (results: ResultRecord[]) => ({ results }) as unknown as TaskRecord;
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
    writeFileSync(join(tmp.dir, 'small.png'), Buffer.from('png'));
  });
  afterEach(() => tmp.cleanup());

  it('小图原样内联，大图按剩余时间限时生成缩略图', async () => {
    const thumb = vi.fn(async () => Buffer.from('jpeg'));
    const out = await imageBlocks(taskWith([result('small.png', 3), result('big.png', 5_000_000)]), tmp.dir, Date.now() + 5000, thumb);
    expect(out).toEqual([
      { type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' },
      { type: 'image', data: Buffer.from('jpeg').toString('base64'), mimeType: 'image/jpeg' },
    ]);
    expect((thumb.mock.calls[0] as unknown[])[2]).toBe(5000);
  });

  it('已到截止时间：小图大图都跳过并说明', async () => {
    const thumb = vi.fn(async () => Buffer.from('jpeg'));
    const out = await imageBlocks(taskWith([result('small.png', 3), result('big.png', 5_000_000), result('big2.png', 5_000_000)]), tmp.dir, Date.now(), thumb);
    expect(thumb).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0]!.type === 'text' && out[0]!.text.includes('3 张') && out[0]!.text.includes('时间不够')).toBe(true);
  });

  it('缩略图卡住（例如找 ffmpeg 挂起）：到截止时间就跳过，不再等', async () => {
    const pending = imageBlocks(taskWith([result('big.png', 5_000_000)]), tmp.dir, Date.now() + 5000, () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(5000);
    const out = await pending;
    expect(out).toHaveLength(1);
    expect(out[0]!.type === 'text' && out[0]!.text.includes('时间不够')).toBe(true);
  });

  it('生成不了缩略图或读不到文件时说明，路径照样返回', async () => {
    const out = await imageBlocks(taskWith([result('big.png', 5_000_000), result('missing.png', 3)]), tmp.dir, Date.now() + 5000, async () => null);
    expect(out).toHaveLength(1);
    expect(out[0]!.type === 'text' && out[0]!.text.includes('2 张') && out[0]!.text.includes('ffmpeg')).toBe(true);
  });
});
