import { spawn } from 'node:child_process';
import { findExecutable } from '../platform/tools.js';

let ffmpeg: Promise<string | null> | null = null;

/** 用本机 ffmpeg 生成 JPEG 缩略图（最长边 maxSide）；没有 ffmpeg 返回 null。可选增强，不是必需依赖 */
export async function makeThumbnail(absPath: string, maxSide: number, timeoutMs = 15_000): Promise<Buffer | null> {
  ffmpeg ??= findExecutable('ffmpeg');
  const bin = await ffmpeg;
  if (!bin) return null;
  const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
  return new Promise((resolve) => {
    const p = spawn(bin, ['-v', 'error', '-i', absPath, '-frames:v', '1', '-vf', scale, '-q:v', '5', '-f', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.on('error', () => (clearTimeout(timer), resolve(null)));
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null);
    });
  });
}
