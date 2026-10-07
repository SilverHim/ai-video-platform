import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const nodeBuiltins = ['node:*', 'fs', 'path', 'os', 'crypto', 'http', 'https', 'stream', 'child_process', 'url', 'util'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'data/**', 'outputs/**', 'coverage/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // shared：前后端共用，禁止依赖 React、Node 内置模块、web/server 代码
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: nodeBuiltins, message: 'src/shared 必须平台无关，不能引用 Node 内置模块' },
          { group: ['react', 'react-dom', 'react/*'], message: 'src/shared 不能引用 React' },
          { group: ['**/server/**', '**/web/**'], message: 'src/shared 不能引用 server/web 代码' },
        ],
      }],
    },
  },
  // server：不能引用 web 代码
  {
    files: ['src/server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/web/**'], message: 'server 不能引用 web 代码' }] }],
    },
  },
  // web：不能引用 server 代码和 Node 内置模块
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/server/**'], message: 'web 不能引用 server 代码' },
          { group: nodeBuiltins, message: 'web 运行在浏览器里，不能引用 Node 内置模块' },
        ],
      }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
