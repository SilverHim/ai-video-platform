/**
 * MCP 生成类工具的时间预算。按 docs/agent-setup.md 接入时客户端的工具超时是 600 秒，整次调用要在这之内返回：
 * - 默认等生成最多 WAIT_DEFAULT_SECONDS；
 * - callMs：从工具入口算起，素材上传、提交、等待生成都在这之内，超了先返回 task_id（后台继续处理，不重复提交）；
 * - responseMs：缩略图也要在这之前做完，剩下的留给返回
 */
export const WAIT_DEFAULT_SECONDS = 540;
export const DEFAULT_CALL_BUDGET = { callMs: 560_000, responseMs: 585_000 } as const;

const budget: { callMs: number; responseMs: number } = { ...DEFAULT_CALL_BUDGET };

/** 测试用：调小时间预算 */
export function setCallBudget(b: Partial<typeof budget>): void {
  Object.assign(budget, b);
}

export const callBudgetSeconds = (): number => Math.round(budget.callMs / 1000);
export const callDeadline = (startedAt: number): number => startedAt + budget.callMs;
export const responseDeadline = (startedAt: number): number => startedAt + budget.responseMs;

/** 本次调用还能等多久（秒）：请求的等待时长与剩余预算取小 */
export const waitWithin = (requested: number, startedAt: number): number => Math.max(0, Math.min(requested, (callDeadline(startedAt) - Date.now()) / 1000));

/** 在截止时间前等 p：p 先结束就返回它的结果（失败照常抛出）；先到截止时间返回 null，p 在后台照常继续 */
export async function beforeDeadline<T>(p: Promise<T>, deadlineAt: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), Math.max(0, deadlineAt - Date.now()))));
  try {
    // race 给 p 挂了处理函数：截止后 p 再失败也不会成为未处理的拒绝
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}
