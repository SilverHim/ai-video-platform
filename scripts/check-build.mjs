// 检查构建产物能真正启动：dist/server/index.js 起服务、读写数据库、返回页面，然后退出
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { startServer } = await import(new URL('../dist/server/index.js', import.meta.url).href);
const dir = mkdtempSync(join(tmpdir(), 'ark-build-check-'));
const staticDir = fileURLToPath(new URL('../dist/web', import.meta.url));
let ok;
const s = await startServer({ dataDir: dir, port: 0, staticDir, version: 'check' });
try {
  const headers = { 'x-ark-client': 'web' };
  const tasks = await fetch(`${s.url}/api/tasks`, { headers });
  const page = await fetch(`${s.url}/`);
  ok = tasks.ok && page.ok && (await page.text()).includes('id="root"');
  console.log(`[check-build] tasks=${tasks.status} page=${page.status}`);
} finally {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(ok ? '[check-build] 通过' : '[check-build] 未通过');
process.exit(ok ? 0 : 1);
