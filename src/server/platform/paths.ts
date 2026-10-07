import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DISPLAY_NAME } from '../../shared/api-contract.js';

/** 项目根目录：src/server/platform → 上三级；dist/server → 上两级。由入口文件位置推出，不依赖 cwd */
export function projectRootFrom(entryUrl: string): string {
  let dir = dirname(fileURLToPath(entryUrl));
  for (let i = 0; i < 5; i++) {
    if (dir.endsWith(join('src', 'server')) || dir.endsWith(join('dist', 'server'))) return resolve(dir, '..', '..');
    dir = resolve(dir, '..');
  }
  return resolve(dirname(fileURLToPath(entryUrl)), '..', '..');
}

/** 打包成桌面应用后使用的系统应用数据目录（开发时用项目下的 ./data） */
export function systemAppDataDir(platform: NodeJS.Platform = process.platform): string {
  const name = APP_DISPLAY_NAME;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', name);
  if (platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), name);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), name);
}
