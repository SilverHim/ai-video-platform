// npm start 之前运行：dist 不存在或比源码旧时重新构建
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputs = [join(root, 'dist/server/index.js'), join(root, 'dist/web/index.html')];
const sources = [join(root, 'src'), join(root, 'package.json'), join(root, 'vite.config.ts'), join(root, 'tsup.config.ts')];

function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const name of readdirSync(p)) max = Math.max(max, newestMtime(join(p, name)));
  return max;
}

const builtAt = Math.min(...outputs.map((p) => (existsSync(p) ? statSync(p).mtimeMs : 0)));
const changedAt = Math.max(...sources.map(newestMtime));
if (builtAt === 0 || changedAt > builtAt) {
  console.log('[ensure-build] 构建产物缺失或过期，正在构建…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
} else {
  console.log('[ensure-build] 构建产物是最新的');
}
