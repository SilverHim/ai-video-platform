/** 统一的任务状态（服务商状态映射到这里） */
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'unknown';

/** 本地任务记录的生命周期状态（包含提交阶段） */
export type JobStatus =
  | 'awaiting_consent'
  | 'resolving_assets'
  | 'submitting'
  | 'submit_unknown'
  | TaskStatus;

/** 终态（不会再变化的状态） */
export const TERMINAL_STATUSES: readonly JobStatus[] = ['succeeded', 'partial', 'failed', 'cancelled', 'expired'];
const TERMINAL = new Set<JobStatus>(TERMINAL_STATUSES);

export function isTerminal(s: JobStatus): boolean {
  return TERMINAL.has(s);
}
