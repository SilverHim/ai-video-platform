# MCP 接入说明

平台在本机提供 MCP（Model Context Protocol）接口，让 Claude Code 等 agent 直接调用：列模型、预览请求、生成图像 / 视频、查询任务。agent 发起的任务与网页共享同一份历史，网页里实时可见。

## 接入

**最省事**：对 agent 说一句话，它会自己读取本机的地址和令牌并完成登记（没装桌面版还会先下载安装），步骤见 [`agent-setup.md`](agent-setup.md)：

> 帮我按 https://raw.githubusercontent.com/SilverHim/ai-video-platform/main/docs/agent-setup.md 安装并接入 AI视频生成平台的 MCP

**手动接入**：

1. 启动平台：`npm start`（或开发时 `npm run dev`），保持运行。
2. 打开网页「设置 → MCP 接入」，复制接入命令，在终端运行，形如：

```bash
claude mcp remove ai-video --scope user 2>/dev/null; claude mcp add-json --scope user ai-video '{"type":"http","url":"http://127.0.0.1:8787/mcp","headers":{"Authorization":"Bearer <令牌>"},"timeout":600000}'
```

- 命令里带了 10 分钟超时（`"timeout": 600000`）。Claude Code 对 HTTP 类 MCP 服务器默认每个请求只等 60 秒（计到服务器返回第一个字节），出图常要 1–3 分钟；单服务器的 `timeout` 会同时提高这个计时器（[官方文档](https://code.claude.com/docs/en/env-vars) `MCP_TOOL_TIMEOUT` 一条）。`claude mcp add` 没有超时参数，所以用 `add-json`。
- Claude Code 2.1.274 之前的版本，Streamable HTTP 的工具调用接近 5 分钟时可能被切断（即使设了更长的 timeout），等待超过 4 分钟的话建议先升级。

- 地址只监听 `127.0.0.1`；请求必须带本机访问令牌（`<数据目录>/mcp-token`，可在设置页轮换）。
- 规范要求校验 Origin：带非本机 Origin 的请求一律 403。
- 使用官方 TypeScript SDK v2（2026-07-28 协议），并兼容 2025 代客户端的握手（`legacy: 'stateless'`）。
- Claude Desktop 的聊天界面只能接公网或 stdio 的 MCP，本机 HTTP 暂不支持（后续版本提供 stdio 桥）。

## 工具

| 工具 | 作用 | 计费 |
|---|---|---|
| `list_models` | 列出模型、模式、素材槽 | 否 |
| `get_model_schema` | 某模型的全部字段（类型 / 默认 / 范围 / 枚举）、素材规格、提示词规则 | 否 |
| `preview_request` | 校验参数，返回问题列表、最终请求体、curl（Key 用环境变量占位）、说明、预估费用（含可信度）、是否需要公开上传。传本地文件路径时会把文件导入素材库（按内容去重） | 否 |
| `generate_image` | 生成图片，最多等 `wait_seconds`（默认 50 秒）：完成就返回本地文件路径与缩略图，没完成先返回 `task_id`，再用 `get_task` 继续等 | **是** |
| `create_video_task` | 创建视频任务，可选 `wait_seconds`（≤540）等待完成并推送进度 | **是** |
| `get_task` | 查询任务与结果文件（含耗时 `duration_ms`、`usage`），可选 `wait_seconds`、`include_images` | 否 |
| `list_tasks` | 本地任务历史 | 否 |
| `cancel_task` | 取消排队中的任务，或删除已结束任务的云端记录 | 否 |
| `list_presets` | 列出参数预设（网页「预设与模板」里维护）；生成类工具可用 `preset_id` 套用 | 否 |
| `list_endpoints` | BytePlus：账号下的推理接入点（Endpoint），可按 `model_id` 筛选；返回状态和内容过滤开关。需要先在设置页配置 AK/SK | 否 |

### 等待与超时

- 出图常要 1–3 分钟，视频更久。`generate_image` 默认最多等 50 秒（留在常见的 60 秒请求超时之内），没出图就先返回 `task_id` 和 `next`；之后用 `get_task`（可带 `wait_seconds`）继续等。
- **调用超时或断开不等于失败**：任务仍在平台上运行并计费。先用 `get_task` / `list_tasks` 查，不要重新提交，否则会重复计费。
- `wait_seconds` 超过约 60 秒，需要客户端的工具超时足够长（按上面的接入命令登记就有 10 分钟）。等待期间如果客户端带了 `progressToken`，平台会推送进度通知。
- 平台对 MCP 请求一律用 SSE 流式响应（响应头立即发出、每 15 秒保活）。

### 参数与素材

- `params` 的键是 `get_model_schema` 返回的字段 `key`（不是请求里的字段名）。
- 默认值随模式变化的字段（例如尺寸）在 `get_model_schema` 里给出 `default_by_mode`：各模式不传这个参数时实际发送的值。尺寸会影响单价（例如 Seedream 5.0 pro：不超过 2,610,000 像素 $0.045/张，更大 $0.09/张，默认 2K 属于后者），实际费用以 `preview_request` 的 `estimated_cost` 为准。
- `mode` 不填时用默认模式（`get_model_schema` 的 `modes` 里标了 `default: true` 的那个）。
- `assets` 按槽位 id 分组，每项可以是：本地绝对路径、`https://` 链接、`asset://<素材ID>`、`mm_file://<file_id>`、`task:<任务id>#<结果序号>`（复用历史结果）。
- 提示词里引用素材按 `get_model_schema` 给出的写法（如 `Image 1`、`@Video 1`）。
- BytePlus Seedance 的本地参考视频需要先上传到公共临时托管站（默认 uguu.se，3 小时；可选 tmpfiles.org，24 小时），链接是公开的，所以必须显式传 `allow_public_upload: true`，否则工具返回错误说明。

### 推理接入点（BytePlus）与 Key 选择

- BytePlus 模型可以通过自己的推理接入点调用（例如关闭了内容过滤的 Endpoint）：先用 `list_endpoints`（可带 `model_id`）找到 `endpoint_id`，再在 `preview_request` / `generate_image` / `create_video_task` 里传 `model_override: "ep-…"`。
- 配了 AK/SK 时，平台会在提交前校验：账号下有这个 Endpoint、绑定的是同一个模型、没有停止；不符合就返回错误并说明怎么改。没配 AK/SK 时不做这层校验，由上游返回错误。
- `preview_request` 传了 `model_override` 时，返回里有 `endpoint`（名称、状态、`content_filter`），可以确认用的是哪个接入点。
- MiniMax 可以存按量 Key 和订阅 Key 两种：生成类工具的 `credential` 传 `paygo` 或 `subscription` 指定用哪种；不传时优先用订阅 Key。`preview_request` 的返回里有 `credential` 说明这次会用哪种、从哪里扣费。

### 费用

平台不设花费限制（用户决定）；生成类工具的返回里带 `estimated_cost_usd`（按官方标价估算），agent 可据此自行判断。
