# AI视频生成平台

本机运行的 AI 图像 / 视频生成集成平台：在网页里可视化填写提示词、参考图 / 视频 / 音频和参数，调用各服务商的生成接口；也可以让 Claude Code 等 agent 通过 MCP 操作。

> 状态：**开发中**（当前仓库只有实施方案和调研报告，代码按 `docs/plan.md` 的阶段陆续提交）。

## 规划中的功能

- **服务商与模型**（可插拔，后续可继续添加）
  - BytePlus ModelArk：Seedream 5.0 pro / flash / lite、4.5、4.0（图像）；Dreamina Seedance 2.5、2.0 / fast / mini、Seedance 1.0 pro / pro fast（视频）
  - MiniMax 国际站：image-01 / image-01-live（图像）；MiniMax-H3 / H3-Max（视频）
- 按模型能力自动显示、锁定、校验参数；首帧 / 首尾帧 / 全模态参考；Seedream 组图 + 流式、图层分解、透明背景；Seedance 2.5 视频编辑 / 延长、Draft 样片两步
- 请求预览（JSON + curl，Key 打码）、原始响应查看、参数预设 / 提示词模板
- 结果自动保存到本地文件夹，本地历史（网页与 MCP 共享），一键复用参数
- MCP 接口（本机 Streamable HTTP + 访问令牌），agent 可列模型、预览请求、生成图像 / 视频、查询任务
- 中英文界面；以后打包为 macOS / Windows 桌面应用

## 隐私与安全

- 只监听 `127.0.0.1`，不对外开放
- API Key 只保存在本机数据目录，不进浏览器存储、不进日志、不进 Git
- 参考视频若需上传到公共临时托管站（uguu.se / tmpfiles.org），每次都需明确同意

## 文档

- [实施方案](docs/plan.md)
- [调研报告](docs/research/)（基于官方文档的逐项核实，含 CORS 实测）

## 技术栈

React 19 + Vite + TypeScript 6.0（typescript-eslint 尚不支持 TS 7）+ Tailwind v4；本机服务 Hono（Node.js ≥ 24.15，推荐 26）；SQLite（`node:sqlite`）；MCP TypeScript SDK。
