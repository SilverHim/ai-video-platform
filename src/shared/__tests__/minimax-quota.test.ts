import { describe, expect, it } from 'vitest';
import { parsePlanRemains } from '../providers/minimax/quota';

/** 2026-10-08 实测返回（M Plan 订阅 Key） */
const REAL = {
  model_remains: [
    {
      start_time: 1791447773879,
      end_time: 1791465773879,
      remains_time: 17999990,
      current_interval_total_count: 0,
      current_interval_usage_count: 0,
      model_name: 'general',
      current_weekly_total_count: 0,
      current_weekly_usage_count: 0,
      weekly_start_time: 1791369726171,
      weekly_end_time: 1791974526171,
      weekly_remains_time: 526752282,
      current_interval_status: 1,
      current_interval_remaining_percent: 100,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 1,
    },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
};

describe('MiniMax 订阅额度解析', () => {
  it('按实测结构拆成 5 小时窗口与周窗口', () => {
    expect(parsePlanRemains(REAL)).toEqual([
      {
        model: 'general',
        interval: { remainingPercent: 100, start: 1791447773879, end: 1791465773879, resetsInMs: 17999990, used: 0, total: 0 },
        weekly: { remainingPercent: 1, start: 1791369726171, end: 1791974526171, resetsInMs: 526752282, used: 0, total: 0 },
      },
    ]);
  });

  it('没有某个窗口的字段时该窗口为 null（例如视频只有周窗口）', () => {
    const [video] = parsePlanRemains({ model_remains: [{ model_name: 'video', current_weekly_remaining_percent: 40, weekly_remains_time: 1000 }] })!;
    expect(video).toMatchObject({ model: 'video', interval: null, weekly: { remainingPercent: 40, resetsInMs: 1000 } });
  });

  it('不认识的结构返回 null，界面退回原样展示', () => {
    expect(parsePlanRemains(null)).toBeNull();
    expect(parsePlanRemains({ base_resp: { status_code: 0 } })).toBeNull();
    expect(parsePlanRemains({ model_remains: [] })).toBeNull();
  });
});
