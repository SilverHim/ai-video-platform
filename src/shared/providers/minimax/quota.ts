/**
 * 订阅额度（GET https://www.minimax.io/v1/token_plan/remains）的解析。
 * 返回格式官方文档没写，以下按 2026-10-08 实测的结构与字段名推断：
 * { model_remains: [{ model_name, start_time, end_time, remains_time, current_interval_remaining_percent, current_interval_status,
 *   current_interval_total_count, current_interval_usage_count, weekly_start_time, weekly_end_time, weekly_remains_time,
 *   current_weekly_remaining_percent, current_weekly_status, current_weekly_total_count, current_weekly_usage_count }], base_resp }
 * 时间为毫秒时间戳，remains_time 为距窗口结束的毫秒数。
 */
export interface QuotaWindow {
  /** 剩余百分比（0–100） */
  remainingPercent: number | null;
  start: number | null;
  end: number | null;
  /** 距重置还剩多少毫秒 */
  resetsInMs: number | null;
  used: number | null;
  total: number | null;
}

export interface PlanQuotaItem {
  /** 接口里的 model_name，例如 general */
  model: string;
  /** 5 小时窗口（视频模型没有这个窗口时可能为 null） */
  interval: QuotaWindow | null;
  weekly: QuotaWindow | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function windowOf(o: Record<string, unknown>, prefix: 'current_interval' | 'current_weekly', times: { start: string; end: string; remains: string }): QuotaWindow | null {
  const w: QuotaWindow = {
    remainingPercent: num(o[`${prefix}_remaining_percent`]),
    start: num(o[times.start]),
    end: num(o[times.end]),
    resetsInMs: num(o[times.remains]),
    used: num(o[`${prefix}_usage_count`]),
    total: num(o[`${prefix}_total_count`]),
  };
  return Object.values(w).every((v) => v === null) ? null : w;
}

/** 解析成功返回各项额度；结构不认识时返回 null（界面退回原样展示） */
export function parsePlanRemains(body: unknown): PlanQuotaItem[] | null {
  if (!isObj(body) || !Array.isArray(body.model_remains)) return null;
  const items = body.model_remains.filter(isObj).map((o) => ({
    model: typeof o.model_name === 'string' ? o.model_name : '',
    interval: windowOf(o, 'current_interval', { start: 'start_time', end: 'end_time', remains: 'remains_time' }),
    weekly: windowOf(o, 'current_weekly', { start: 'weekly_start_time', end: 'weekly_end_time', remains: 'weekly_remains_time' }),
  }));
  return items.length ? items : null;
}
