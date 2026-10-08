# MCP 接入说明

平台在本机提供 MCP（Model Context Protocol）接口，让 Claude Code 等 agent 直接调用：列模型、预览请求、生成图像 / 视频、查询任务。agent 发起的任务与网页共享同一份历史，网页里实时可见。

## 接入

1. 启动平台：`npm start`（或开发时 `npm run dev`），保持运行。
2. 打开网页「设置 → MCP 接入」，复制接入命令，在终端运行，形如：

```bash
claude mcp add --transport http --scope user ai-video http://127.0.0.1:8787/mcp --header "Authorization: Bearer <令牌>"
```

3. 建议把该服务器的超时设为 10 分钟：在 `~/.claude.json` 对应条目里加 `"timeout": 600000`。

- 地址只监听 `127.0.0.1`；请求必须带本机访问令牌（`<数据目录>/mcp-token`，可在设置页轮换）。
- 规范要求校验 Origin：带非本机 Origin 的请求一律 403。
- 使用官方 TypeScript SDK v2（2026-07-28 协议），并兼容 2025 代客户端的握手（`legacy: 'stateless'`）。
- Claude Desktop 的聊天界面只能接公网或 stdio 的 MCP，本机 HTTP 暂不支持（后续版本提供 stdio 桥）。

## 工具

| 工具 | 作用 | 计费 |
|---|---|---|
| `list_models` | 列出模型、模式、素材槽 | 否 |
| `get_model_schema` | 某模型的全部字段（类型 / 默认 / 范围 / 枚举）、素材规格、提示词规则 | 否 |
| `preview_request` | 校验参数，返回问题列表、最终请求体、curl、预估费用、是否需要公开上传 | 否 |
| `generate_image` | 同步生成图片，返回本地文件路径与缩略图 | **是** |
| `create_video_task` | 创建视频任务，可选 `wait_seconds`（≤540）等待完成并推送进度 | **是** |
| `get_task` | 查询任务与结果文件，可选 `wait_seconds`、`include_images` | 否 |
| `list_tasks` | 本地任务历史 | 否 |
| `cancel_task` | 取消排队中的任务，或删除已结束任务的云端记录 | 否 |
| `list_presets` | 参数预设（后续版本） | 否 |
| `list_endpoints` | BytePlus：账号下的推理接入点（Endpoint），可按 `model_id` 筛选；返回状态和内容过滤开关。需要先在设置页配置 AK/SK | 否 |

### 参数与素材

- `params` 的键是 `get_model_schema` 返回的字段 `key`（不是请求里的字段名）。
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
