import { defineConfig } from 'tsup';

// 桌面版：主进程打成 CommonJS（ready 前的代码同步执行），服务进程打成 ESM；
// 依赖全部打进单文件，安装包里不带 node_modules；保留 node: 前缀（node:sqlite 只能带前缀引用）
export default defineConfig([
  {
    entry: { main: 'src/desktop/main.ts' },
    outDir: 'dist/desktop',
    format: ['cjs'],
    platform: 'node',
    target: 'node24',
    external: ['electron'],
    // 除 electron 外全部打进来：安装包里没有 node_modules，留成 require 的依赖在打包后会找不到
    noExternal: [/^(?!electron$).*/],
    outExtension: () => ({ js: '.cjs' }),
    removeNodeProtocol: false,
    clean: false,
    splitting: false,
  },
  {
    entry: { server: 'src/desktop/server-entry.ts' },
    outDir: 'dist/desktop',
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    noExternal: [/.*/],
    outExtension: () => ({ js: '.mjs' }),
    // 被打进来的 CommonJS 依赖会用 require 加载 Node 内置模块
    banner: { js: "import { createRequire as __arkCreateRequire } from 'node:module'; const require = __arkCreateRequire(import.meta.url);" },
    clean: false,
    splitting: false,
    removeNodeProtocol: false,
  },
]);
