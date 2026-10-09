// electron-builder 配置：应用目录是 scripts/prepare-desktop.mjs 生成的 dist/desktop（不带 node_modules）
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('electron-builder').Configuration} */
export default {
  // 发布后不要改：Windows 安装包的 GUID 由它推导（与 src/desktop/policy.ts 的 DESKTOP_APP_ID 一致）
  appId: 'io.github.silverhim.aivideoplatform',
  productName: 'AI视频生成平台',
  electronVersion: pkg.devDependencies.electron,
  directories: { app: 'dist/desktop', output: 'release', buildResources: 'desktop-resources' },
  files: ['**/*', '!**/*.map'],
  // 应用目录不带依赖（服务端已打成单文件）：返回 false 表示依赖由外部处理，
  // 不重建原生模块，也不去项目根目录收集 node_modules
  beforeBuild: async () => false,
  // 文件名用 ASCII（GitHub 会改写非 ASCII 的附件名），且不带版本号：
  // docs/agent-setup.md 直接从 releases/latest/download/<文件名> 下载，不用调 GitHub API（匿名每小时 60 次）
  artifactName: '${name}-${os}-${arch}.${ext}',
  mac: {
    // 只出 Apple 芯片版，不支持 Intel Mac
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.graphics-design',
    // 没有 Apple Developer ID：显式 ad-hoc 签名（Apple Silicon 上原生代码至少要 ad-hoc 签名才能运行）
    identity: '-',
    hardenedRuntime: false,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // exe 文件名用 ASCII（命令行、快捷方式更稳）；开始菜单与窗口显示的仍是 productName
    executableName: 'ai-video-platform',
  },
  nsis: {
    // 按用户安装，不需要管理员权限
    oneClick: true,
    perMachine: false,
    artifactName: '${name}-win-${arch}-setup.${ext}',
  },
};
