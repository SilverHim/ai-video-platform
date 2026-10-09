// 从 docs/agent-setup.md 逐字提取代码块，供 CI 按说明原文实测（.github/workflows/agent-setup-check.yml）
// 用法：node scripts/agent-setup-blocks.mjs <输出目录> [--local-dmg <dmg 路径>]
// 输出 mac-1.sh、mac-2.sh、mac-3.sh、win-1.ps1、win-2.ps1；
// 带 --local-dmg 时另出 mac-2-local.sh：第 2 步的安装命令原样保留，只把「从 Release 下载」换成拷贝本地 dmg（还没有正式发布时用）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('用法：node scripts/agent-setup-blocks.mjs <输出目录> [--local-dmg <dmg 路径>]');
const dmgFlag = process.argv.indexOf('--local-dmg');
const localDmg = dmgFlag > 0 ? process.argv[dmgFlag + 1] : undefined;
const doc = readFileSync(new URL('../docs/agent-setup.md', import.meta.url), 'utf8');
mkdirSync(out, { recursive: true });
const pick = (lang) => [...doc.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]);
const bash = pick('bash');
const ps = pick('powershell');
if (bash.length !== 3 || ps.length !== 2) throw new Error(`代码块数量不对：bash ${bash.length}，powershell ${ps.length}`);
bash.forEach((b, i) => writeFileSync(join(out, `mac-${i + 1}.sh`), b));
if (localDmg) {
  const step2 = bash[1];
  const from = step2.indexOf('TMP=$(mktemp -d)');
  const download = 'curl -fL --retry 2 -o "$DMG" "$URL"';
  if (from < 0 || !step2.includes(download)) throw new Error('第 2 步的安装命令和预期不一致，请同步更新本脚本');
  writeFileSync(join(out, 'mac-2-local.sh'), `(\n${step2.slice(from).replace(download, `cp ${JSON.stringify(localDmg)} "$DMG"`)}`);
}
// PowerShell 5.1 读无 BOM 的 .ps1 会按系统代码页解析，中文会乱：写 UTF-8 BOM
ps.forEach((b, i) => writeFileSync(join(out, `win-${i + 1}.ps1`), `\uFEFF${b}`));
console.log(`已提取到 ${out}`);
