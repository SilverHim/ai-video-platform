# 桌面版（Electron）

把平台打包成 macOS / Windows 桌面应用：双击打开即可使用，不需要装 Node.js、不需要命令行。功能和网页版完全一样（同一套前端与本机服务），MCP 也照常可用。

## 下载与第一次打开

到 GitHub Releases 下载对应安装包：

| 系统 | 文件 |
|---|---|
| macOS（Apple 芯片；不支持 Intel Mac） | `ai-video-platform-mac-arm64.dmg` |
| Windows 10/11（x64） | `ai-video-platform-win-x64-setup.exe` |

安装包没有付费签名（Apple Developer ID / Windows 代码签名证书），第一次打开要手动放行：

- **macOS 15 及以后**：右键「打开」已不能绕过 Gatekeeper（[Apple 开发者新闻](https://developer.apple.com/news/?id=saqachfa)）。做法是先双击打开一次，再到「系统设置 › 隐私与安全性」点「仍要打开」，输入登录密码（[Mac 使用手册](https://support.apple.com/guide/mac-help/mh40616/mac)；按钮在尝试打开后约 1 小时内可用）。
- **Windows**：SmartScreen 提示「Windows 已保护你的电脑」时点「更多信息」→「仍要运行」（[微软文档](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)：未签名安装包每个新版本都要重新积累信誉）。开启了「智能应用控制」的 Windows 11 可能直接拦截。
- 安装为「按用户安装」，不需要管理员权限。
- 没有自动更新（macOS 未签名无法自动更新），新版本请到 Releases 下载覆盖安装，数据会保留。

## 数据在哪里

| 系统 | 目录 |
|---|---|
| macOS | `~/Library/Application Support/ai-video-platform/data` |
| Windows | `%APPDATA%\ai-video-platform\data` |

里面是 `keys.json`（Key，macOS 上权限 0600）、`app.db`（任务历史）、`outputs/`（生成结果）、`mcp-token`。日志在上一级的 `logs/server.log`（上一次启动的日志是 `server.prev.log`）。

和开发时的 `npm start` / `npm run dev`（数据在项目下的 `data/`）是**两份独立的数据**。想把开发时的 Key 和历史带过去，退出桌面版后把 `data/` 里的内容拷到上面的目录即可。

## 运行方式

- 主进程只管窗口与生命周期；本机服务跑在 Electron 的 utilityProcess 里（数据库同步读写不会卡住界面，服务崩溃时会提示重启）。
- 服务只监听 `127.0.0.1`，第一次用 8787，被占用时依次往后试（例如开发服务器正在用 8787，桌面版就用 8788）；之后**固定从上次用的端口开始**（记在 `desktop-state.json`），MCP 地址和界面设置（语言等，按端口区分）不会来回变。MCP 地址以「设置 → MCP 接入」显示的为准。
- 同时只能开一个桌面版；再次打开会切到已有窗口。
- macOS 上关闭窗口不会退出（视频任务继续轮询），点 Dock 图标重新打开；`⌘Q` 退出时会先关服务、关数据库（最多等 8 秒，之后强制结束）。Windows 关闭窗口即退出。退出过程中再次打开应用，会在退出完成后自动重新启动。未完成的视频任务下次启动会自动续查。
- 本机服务意外退出时会弹框，可以选择重新启动服务；主窗口回到原来的页面。日志写不进去（例如磁盘满）不会影响服务运行。
- 从访达 / 开始菜单启动时 PATH 很短：macOS 上会补上 `/opt/homebrew/bin`、`/usr/local/bin`，以便找到 ffprobe。

## 安全设置

- 窗口开启 `contextIsolation`、`sandbox`，页面拿不到 Node 能力（没有 preload，页面只通过 HTTP 和本机服务通信）。
- 权限请求默认拒绝（Electron 默认全部批准），只放行本机页面的剪贴板写入与全屏。
- 窗口只能停留在本机服务的地址；其他 http / https 链接交给系统浏览器打开，其余协议（`file:` 等）一律不开；不允许 `<webview>`。
- 本机服务原有的防护照旧：Host / Origin 校验、`/api` 自定义头、MCP 访问令牌。

## 从源码构建

需要 Node.js ≥ 24.15。

```bash
npm install
```

开发时直接用 Electron 运行（会先构建前端与两个入口到 `dist/desktop`）：

```bash
npm run desktop:start
```

冒烟测试（在 Electron 运行时里起服务、读写数据库、取页面，然后退出）：

```bash
npm run desktop:prepare && npm run desktop:smoke
```

打安装包（输出到 `release/`；mac 上出 Apple 芯片（arm64）的 dmg，Windows 安装包需要在 Windows 上打）：

```bash
npm run desktop:dist
```

测试时可以用 Chromium 的 `--user-data-dir=<目录>` 开关让桌面版用一个临时数据目录，不影响真实数据。

### 打包结构

- `scripts/prepare-desktop.mjs` 生成应用目录 `dist/desktop`：`main.cjs`（主进程，CommonJS，保证 ready 之前的代码按顺序同步执行）、`server.mjs`（服务进程，依赖全部打成单文件）、`web/`（前端）、一份不带依赖的 `package.json`。
- 安装包里不带 `node_modules`（`electron-builder.config.mjs` 用 `beforeBuild` 返回 `false` 关掉依赖收集），asar 约 4MB。
- 版本：Electron 44（自带 Node 24.21，`node:sqlite` 可用）、electron-builder 26。
- macOS 用 ad-hoc 签名（`identity: "-"`、`hardenedRuntime: false`）：Apple 芯片上原生代码至少要有 ad-hoc 签名才能运行；没有公证。

## 发布（维护者）

1. 改 `package.json` 的 `version`，提交。
2. 推送标签 `v<版本>`（必须和 `version` 一致）。
3. GitHub Actions 的 Release 流程：先建草稿 Release，再在 macOS 26（arm64）和 Windows Server 2025 上构建；打包前后各跑一次冒烟测试，通过后把安装包传到草稿。
4. 在 GitHub 上检查草稿，确认后点发布。

也可以在 Actions 页手动运行 Release 流程：只构建，安装包作为构建产物保留 7 天，不建 Release。
