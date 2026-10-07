import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import zh from './locales/zh.json';

function keys(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : []));
}

describe('界面文案', () => {
  it('中英文案键完全一致', () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
  });

  it('代码里用到的 t("…") 键都存在', () => {
    const all = new Set(keys(zh));
    const missing: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), 'src', 'web'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z_]+(?:\.[a-zA-Z_]+)+)'/g)) if (!all.has(m[1]!)) missing.push(`${m[1]} @ ${file.split('src/web/')[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
