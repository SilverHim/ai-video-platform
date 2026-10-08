import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录：src/server/platform → 上三级；dist/server → 上两级。由入口文件位置推出，不依赖 cwd */
export function projectRootFrom(entryUrl: string): string {
  let dir = dirname(fileURLToPath(entryUrl));
  for (let i = 0; i < 5; i++) {
    if (dir.endsWith(join('src', 'server')) || dir.endsWith(join('dist', 'server'))) return resolve(dir, '..', '..');
    dir = resolve(dir, '..');
  }
  return resolve(dirname(fileURLToPath(entryUrl)), '..', '..');
}
