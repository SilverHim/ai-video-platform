import { spawn } from 'node:child_process';

/** 在访达 / 资源管理器中显示文件，或用系统默认程序打开 */
export function revealInFileManager(absPath: string, mode: 'reveal' | 'open', platform = process.platform): Promise<boolean> {
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = mode === 'reveal' ? ['-R', absPath] : [absPath];
  } else if (platform === 'win32') {
    cmd = 'explorer.exe';
    args = mode === 'reveal' ? [`/select,${absPath}`] : [absPath];
  } else {
    cmd = 'xdg-open';
    args = [mode === 'reveal' ? absPath.replace(/[/\\][^/\\]*$/, '') : absPath];
  }
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('spawn', () => {
      p.unref();
      resolve(true);
    });
  });
}
