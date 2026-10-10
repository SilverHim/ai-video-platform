import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export interface InstanceLock {
  release: () => void;
}

export class DataDirInUseError extends Error {
  readonly code = 'DATA_DIR_IN_USE';
  constructor(dataDir: string) {
    super(
      `无法取得数据目录的独占锁：${dataDir}。可能有另一个服务实例在用它（同一个数据目录同时只能运行一个服务，例如开发服务与 npm start 都用项目下的 data/），也可能是其他程序暂时占着锁文件；先关掉另一个实例再试，或用 --data-dir 指定别的目录`,
    );
  }
}

/** SQLite 的 SQLITE_BUSY / SQLITE_LOCKED：锁被别的连接占着 */
const LOCK_CONFLICT = new Set([5, 6]);
const RETRIES = 3;
const RETRY_DELAY_MS = 100;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 数据目录的实例锁：在 <dataDir>/instance.lock 上持有一个 SQLite 排他事务（BEGIN EXCLUSIVE）。
 * 锁由操作系统的文件锁实现：进程退出（包括崩溃）时自动释放，不会留下残留锁，也不受进程号复用影响；
 * 同一进程里的第二个连接、其他进程都拿不到。偶发的瞬时冲突（例如别的程序短暂占用）会短暂重试几次。
 * 数据目录需要放在支持可靠文件锁的本地磁盘上（网络盘不保证互斥）
 */
export function acquireInstanceLock(dataDir: string): InstanceLock {
  const db = new DatabaseSync(join(dataDir, 'instance.lock'), { timeout: 0 });
  for (let attempt = 0; ; attempt++) {
    try {
      db.exec('BEGIN EXCLUSIVE');
      break;
    } catch (err) {
      const conflict = LOCK_CONFLICT.has((err as { errcode?: number }).errcode ?? -1);
      if (conflict && attempt < RETRIES) {
        sleepSync(RETRY_DELAY_MS);
        continue;
      }
      db.close();
      if (conflict) throw new DataDirInUseError(dataDir);
      throw err;
    }
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    },
  };
}
