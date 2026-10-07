import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('前端源码目录不能与开发代理前缀冲突', () => {
  it('src/web 下没有 api / files / mcp 目录（否则 Vite 会把源码请求代理到本机服务）', () => {
    const webRoot = join(process.cwd(), 'src', 'web');
    expect(existsSync(webRoot)).toBe(true);
    const names = readdirSync(webRoot);
    for (const reserved of ['api', 'files', 'mcp']) expect(names).not.toContain(reserved);
  });
});
