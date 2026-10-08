// 准备桌面版的应用目录 dist/desktop：构建前端与两个入口，拷贝页面，写一份不带依赖的 package.json
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist', 'desktop');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
run('npx vite build');
run('npx tsup --config tsup.desktop.config.ts');
cpSync(join(root, 'dist', 'web'), join(out, 'web'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appPkg = {
  name: pkg.name,
  productName: 'AI视频生成平台',
  version: pkg.version,
  description: pkg.description,
  author: 'SilverHim',
  license: pkg.license,
  main: 'main.cjs',
};
writeFileSync(join(out, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);
console.log(`[prepare-desktop] 已生成 ${out}`);
