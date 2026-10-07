import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/server/index.ts' },
  outDir: 'dist/server',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  splitting: false,
  // 依赖保持外部引用（运行时从 node_modules 加载）；src/shared 会被一起打进来
  skipNodeModulesBundle: true,
});
