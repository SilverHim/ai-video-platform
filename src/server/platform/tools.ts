import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/** 在 PATH 中查找可执行文件（Windows 自动补 .exe/.cmd），找不到返回 null */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<string | null> {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // 继续找
      }
    }
  }
  return null;
}
