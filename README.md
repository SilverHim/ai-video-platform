# AI视频生成平台

本机运行的 AI 图像 / 视频生成集成平台：在网页里可视化填写提示词、参考图 / 视频 / 音频和参数，调用各服务商的生成接口；也可以让 Claude Code 等 agent 通过 MCP 操作。

> 状态：**开发中**。功能按 [`docs/plan.md`](docs/plan.md) 的阶段推进；真实调用需要你自己的 API Key（会产生费用）。

## 支持的服务商与模型

| 服务商 | 图像 | 视频 |
|---|---|---|
| BytePlus ModelArk（亚太） | Seedream 5.0 pro / flash / lite、4.5、4.0 | Dreamina Seedance 2.5、2.0 / fast / mini，Seedance 1.0 pro / pro fast |
| MiniMax 国际站 | image-01 / image-01-live | MiniMax-H3 / H3-Max |

可插拔架构，新增服务商见 [`docs/adding-a-provider.md`](docs/adding-a-provider.md)。

## 功能

- **按模型自动生成表单**：只显示该模型 / 模式支持的参数，锁定的值会写明原因（例如 Seedance 2.5 首帧任务必须 `ratio=adaptive`，否则会异步失败）
- **素材**：本地上传（按 sha256 去重）、URL、`asset://`、复用历史结果；提示词里输入 `@` 引用素材，编号随顺序自动更新
- **请求预览**：实时显示将要发送的 JSON、等价 curl（Key 用环境变量占位）、请求体大小、预估费用
- **高级能力**：Seedream 组图 + 流式出图、图层分解与透明背景；Seedance 2.5 视频编辑 / 延长、Draft 样片两步
- **异步任务**：服务端轮询，关掉网页任务照样跑完；完成后**自动下载到本地**（每个结果只下载一次）
- **历史**：网页与 MCP 共享，收藏、复用参数、查看原始请求与响应、从 outputs 目录重建
- **预设与模板**：保存常用参数组合与提示词片段
- **MCP**：本机 HTTP + 访问令牌，9 个工具，见 [`docs/mcp.md`](docs/mcp.md)
- 中英文界面切换

## 运行

需要 Node.js ≥ 24.15（推荐 26）。

```bash
npm install
```

不需要 Key、也不计费的演示模式（上游用内置 mock）：

```bash
npm run dev:mock
```

正常使用（浏览器打开 http://127.0.0.1:8787）：

```bash
npm start
```

开发模式（Vite 热更新，页面在 http://127.0.0.1:5173）：

```bash
npm run dev
```

然后在「设置」里填 BytePlus / MiniMax 的 API Key，可以先点「测试 Key（不计费）」确认。

## 数据与隐私

- 服务只监听 `127.0.0.1`，并校验 Host / Origin，防止其他网页访问
- API Key 保存在数据目录的 `keys.json`（macOS 上权限 0600），不进浏览器存储、不进日志、不进 Git；也可以用环境变量 `ARK_API_KEY` / `MINIMAX_API_KEY`
- 数据目录：开发时是项目下的 `data/`（任务数据库、结果文件 `outputs/`、素材、MCP 令牌），已在 `.gitignore` 中排除
- BytePlus Seedance 的本地参考视频需要先上传到公共临时托管站（uguu.se 或 tmpfiles.org，链接公开），每次上传前都会弹窗确认；MCP 需要显式传 `allow_public_upload`

## 开发

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

CI 在 macOS 与 Windows、Node 24 / 26 上运行类型检查、lint、测试与构建。

## 文档

- [实施方案](docs/plan.md)
- [调研报告](docs/research/)（基于官方文档的逐项核实，含 CORS 实测）
- [MCP 接入](docs/mcp.md)
- [新增服务商 / 模型](docs/adding-a-provider.md)

## 技术栈

React 19 + Vite + TypeScript 6.0 + Tailwind v4；本机服务 Hono（Node.js）；SQLite（`node:sqlite`）；MCP TypeScript SDK v2。
