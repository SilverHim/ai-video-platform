import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export interface InstanceLock {
  release: () => void;
}

export class DataDirInUseError extends Error {
  readonly code = 'DATA_DIR_IN_USE';
  constructor(dataDir: string) {
    super(`数据目录正被另一个服务实例使用：${dataDir}。同一个数据目录同时只能运行一个服务（例如开发服务与 npm start 都用项目下的 data/）；先关掉另一个，或用 --data-dir 指定别的目录`);
  }
}

/**
 * 数据目录的实例锁：在 <dataDir>/instance.lock 上持有一个 SQLite 排他事务（BEGIN EXCLUSIVE）。
 * 锁由操作系统的文件锁实现：进程退出（包括崩溃）时自动释放，不会留下残留锁，也不受进程号复用影响；
 * 同一进程里的第二个连接、其他进程都会立即拿不到（不等待）。拿不到时抛 DataDirInUseError
 */
export function acquireInstanceLock(dataDir: string): InstanceLock {
  const db = new DatabaseSync(join(dataDir, 'instance.lock'), { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
  } catch (err) {
    db.close();
    if (/locked|busy/i.test((err as Error).message)) throw new DataDirInUseError(dataDir);
    throw err;
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
