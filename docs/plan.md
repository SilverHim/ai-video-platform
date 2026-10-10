# AI视频生成平台（BytePlus Seedream/Seedance + MiniMax image-01/H3 + MCP）— 实施方案

## Context

项目目录 是空目录，从零开始。用户要一个**本机使用**的生成平台：
- 在网页里填写各服务商的 API Key、提示词、参考图/视频/音频和参数，提交生成图像或视频，然后查看、下载、复用结果；
- agent（Claude Code 等）通过 **MCP** 也能做同样的操作；
- 可插拔多服务商，以后还会再加；
- 以后要打包成 macOS / Windows 桌面应用。

调研全部完成，方法是读官方文档、对抗核实，再做无 Key 的 CORS 实测。报告在 scratchpad 的 `bp/ mm/ hosts/ tos/ mcp/ github.json`，Step 0 时拷进 `docs/research/`。GitHub 上没有可以直接 fork 的底座，所以自建，参数定义以官方文档为准。

## 已确认的决策

| 项 | 决定 |
|---|---|
| 场景 | 仅本机使用，服务只监听 127.0.0.1 |
| 技术栈 | 前端 React 19（react-router 8 要求 ≥19.2.7，原定 18）+ Vite + TypeScript + Tailwind v4；本机服务 Hono（@hono/node-server）；**Node 26**，用户升级，`engines >=24.15`，CI 在 24/26 上测 |
| 服务商/模型 | **BytePlus**：Seedream（5.0 pro/flash/lite、4.5、4.0）、Seedance（2.5、2.0/fast/mini、1.0 pro/pro fast；1.5 pro 已 Retired，默认隐藏）。**MiniMax 国际站**：image-01 / image-01-live；视频**只接 H3（V2）**，即 MiniMax-H3 / H3-Max |
| Key | 存在 `<dataDir>/keys.json`（mac 权限 0600），可用环境变量 `ARK_API_KEY` / `MINIMAX_API_KEY` 覆盖。网页设置页负责读写，显示时打码、可清除。网页与 MCP 共用这一份，浏览器不另存。Key 永不进日志、不进 Git |
| 任务/历史 | **本机服务的 SQLite（`node:sqlite`）是唯一事实来源**，存任务、结果、交换记录、素材、预设、模板，网页和 MCP 共享。轮询调度器跑在服务里，关掉网页任务照样完成并落盘。网页通过 SSE `/api/events` 实时刷新 |
| 结果 | 成功后服务自动下载到 `<dataDir>/outputs/YYYY-MM-DD/<provider>-<taskId>/`，同目录写 manifest.json；**每个结果只下载一次**。浏览器只播放本地 `/files/...` |
| 辅助功能 | 请求预览（JSON + curl，Key 打码）、结果下载、参数预设/提示词模板、原始响应查看 |
| 界面 | 中英可切换（i18next） |
| Seedance 参考视频 | 用户是个人账号：TOS 不支持个人开通；BytePlus 素材库只收真人肖像；Files API 不返回 URL。首版提供三种方式：①本地视频经服务上传到公共临时托管站拿直链，**默认 uguu.se，备选 tmpfiles.org**，上传前必须确认；②一键复用 24h 内生成的结果；③手填 URL / asset://。上传模块做成可插拔的 `UploadTarget`，S3 兼容存储（含 TOS/R2/S3/OSS）放到后续版本 |
| 首版高级功能 | Seedream 组图 + SSE 流式；Seedance 2.5 编辑/延长；Seedance Draft 样片两步；Seedream 5.0 图层分解 / 透明背景 |
| MCP | 本机 Streamable HTTP `http://127.0.0.1:<port>/mcp`，与网页同进程、同一个提交服务；带**本机访问令牌**；**不设花费限制**（用户决定）；公共托管上传要求工具参数 `allow_public_upload: true`；首版只面向 Claude Code（以及 Codex 等支持 HTTP MCP 的 agent） |
| 不做 | MiniMax Hailuo/01（V1）、H3 Regeneration（需白名单）、callback_url（统一轮询）、Seedream 交互式 point/bbox 画布、Claude Desktop 聊天界面的 stdio 桥（后续） |
| Git | 公开仓库 `SilverHim/ai-video-platform`，描述「AI视频生成平台」；首次提交 = 方案 + 调研报告；之后每个阶段提交并推送 |
| 后续打包 | macOS（.dmg）+ Windows（.exe）。用 Electron + electron-builder，GitHub Actions 两平台构建。首版就按可打包、跨平台来写（见「跨平台约束」） |

## 关键事实（决定架构的部分）

**必须经本机服务转发（已实测）**
- BytePlus `/images/generations` 的 CORS 预检，`Allow-Headers` 里没有 authorization。
- 视频任务接口返回 401 时不带 ACAO。
- TOS 结果桶没有开 CORS。
- MiniMax V2 有未公开的 Origin 白名单，官方 FAQ 也禁止在浏览器里暴露 Key；结果 CDN 没有 CORS，并且强制下载。

**BytePlus**（`https://ark.ap-southeast.bytepluses.com/api/v3`，Bearer 鉴权）
- Seedream 同步返回，可选 SSE 流式。
- Seedance 是异步任务：POST `/contents/generations/tasks` 创建，GET `/tasks/{id}` 轮询（QPS 20）。List 接口 QPS 只有 1，不要用它轮询。
- 结果在 `content.video_url`，有效 24 小时；2.5 的视频最多下载 100 次。任务状态包含 `expired`。
- 2.5 的首帧、首尾帧、编辑、延长必须 `ratio=adaptive`，违反了是**异步失败** → 提交前在本地锁定。
- 2.5 的 1080p 和 2.0 的 4K 是 10-bit HEVC，浏览器可能放不了 → 提供降级面板。

**MiniMax**（`https://api.minimax.io`，Bearer 鉴权）
- H3：POST `/v2/video_generation`（必填 model/content/resolution/duration）→ GET `/v2/query/video_generation/{task_id}`（官方建议每 10s 查一次）→ 结果在 `task.content.url`。
- 本地素材两种传法：`/v1/files/upload`（purpose=video_generation_input，得到 `mm_file://`，7 天有效），或 data URI。
- image-01 同步返回；业务错误看 `base_resp.status_code`，HTTP 状态可能是 200。
- file_id 可能超过 2^53 → 一律按字符串处理。

**MCP**（规范当前版本 2026-07-28，无会话、无 initialize）
- SDK：官方 `@modelcontextprotocol/server` 2.x 加 `@modelcontextprotocol/hono`，用 `createMcpHandler`（默认 `legacy:'stateless'`，兼容旧客户端握手）。本机 Claude Code 2.1.220 走 v1 运行时（2025-11-25 握手），需要实测兼容性；不行就退回 v1 SDK `@modelcontextprotocol/sdk` 1.32.x（MIT）。
- 规范要求：校验 Origin，非法时返回 403；只绑定 localhost。安全最佳实践要求本机 HTTP 加授权 token。
- Claude Code 的限制：
  - 工具结果超过 25k token 会转存为文件；
  - 工具调用超过 2 分钟会自动转入后台；
  - inputSchema 必须是合法的 draft 2020-12，根层不能用 anyOf/oneOf；
  - 环境变量名以 `_TOKEN` 结尾时可能被读成空，所以接入命令直接写 header，存在 user/local scope（`~/.claude.json`，不进仓库）。
- Claude Desktop 的聊天界面只能接公网 MCP 或 stdio → 放到后续。

## Step 0：环境与 Git（方案批准后第一件事）

1. **Node 26**：由用户执行 `brew upgrade node`（或者我在征得同意后执行），再用 `node -v` 确认版本是 v26.x。
2. 在 项目目录 执行 `git init -b main`，然后写入以下文件：
   - `README.md`：标题「AI视频生成平台」，包含简介、规划功能、开发中状态。
   - `.gitignore`：`node_modules/ dist/ data/ outputs/ .cache/ .env* .DS_Store *.log`。
   - `.gitattributes`：`* text=auto eol=lf`。
   - `docs/plan.md`：本方案。
   - `docs/research/`：从 scratchpad 拷来的 `byteplus/ minimax/ temp-hosts/ tos/ mcp/ github-similar-projects.json`。
3. **公开前脱敏**：
   - 用 `grep` 确认没有账号 ID、用户名、Key、profile 名（已预查过，没有）；
   - 把指向调研账号的配额描述改写成"个人档示例"；
   - 0x0.st 封禁细节改为中性表述。
4. 提交，commit 结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
5. 推送前在对话里列出将要公开的文件清单，然后执行 `gh repo create SilverHim/ai-video-platform --public --description "AI视频生成平台" --source . --remote origin --push`。

## 架构

```
浏览器（React SPA） ──REST / SSE──┐
                                 ├──► 本机服务（Hono，127.0.0.1）
Claude Code（MCP HTTP + 令牌） ───┘      ├ TaskService：submit / poll / cancel，网页与 MCP 共用
                                        ├ shared 内核：evaluate → build → normalize（前后端同一份）
                                        ├ Scheduler：服务端轮询；重启后从 SQLite 恢复
                                        ├ Capture：落盘 + manifest；只下载一次
                                        ├ AssetStore：本地素材按 sha256 存放；按模型解析成 data URI / 托管直链 / mm_file
                                        ├ UploadTargets：uguu、tmpfiles、mock、minimax-files
                                        ├ Store：node:sqlite，外面包一层 repository，可以换成 better-sqlite3
                                        └ Keystore / EventBus / Files（Range）
                                              │
                                              ▼
                            BytePlus / MiniMax / 临时托管站 / 结果 CDN
```

### 目录（单个 npm 包，用 tsconfig project references 隔离边界）

```
src/shared/   纯 TS（lib 只给 ES2023，禁止 DOM/Node）：
              - catalog：类型 + when 辅助函数
              - engine：evaluate / assets / prompt / migrate
              - request：build / wire / order / curl / sanitize / size
              - task：status / results / errors
              - 其他：sse/parse、api-contract、upload/types
              - providers/{byteplus/{seedream,seedance}, minimax/{image01,h3}}
src/server/   index（导出 startServer({port,dataDir,staticDir})）、app、config(dataDir)
              - middleware：local-guard、mcp-auth、logger 脱敏、body-limit、security-headers
              - upstream：自定义超时的 undici Agent、令牌桶 limiter、json-bigint
              - 业务模块：store/、keystore、tasks/（service、scheduler、recovery）、capture/、
                assets/、upload-targets/（registry、mock、uguu、tmpfiles、minimax-files）、events、
                mcp/（server、tools/*、schemas）、platform/（reveal/open 分平台实现、ffprobe 探测）
              - routes：health / keys / assets / tasks / preview / stream / events / outputs / files / mcp
src/web/      React：
              - 基础：app、i18n、api（client、sse）
              - stores：Zustand，只放 UI 状态和表单草稿（localStorage）
              - features：studio、params、assets、prompt、preview、queue、results、history、library、
                settings、mcp（接入说明）
tests/        fixtures（文档示例响应、SSE、错误体、请求黄金快照）、mock-upstream（Hono 写的假上游）、
              e2e（Playwright）、mcp（用官方 SDK client 做集成测试）
docs/         plan.md、research/、adding-a-provider.md、mcp.md
.github/workflows/ci.yml   macOS + Windows × Node 24/26：typecheck + test
```

**脚本**（全部用 `cross-env`，不用 shell 专有命令）：

| 命令 | 作用 |
|---|---|
| `dev` | 用 concurrently 同时跑 `tsx watch src/server/index.ts` 和 `vite`；Vite 把 `/api`、`/files`、`/mcp` 代理到本机服务 |
| `dev:mock` | 开 `ARK_MOCK_UPSTREAM=1`：不需要 Key，也不计费 |
| `build` | `vite build` + `tsup` |
| `start` | 必要时先重建，再执行 `node dist/server/index.js --open` |
| 其他 | `typecheck`、`test`（Vitest）、`test:e2e`、`lint` |

**依赖**

| 部分 | 依赖 |
|---|---|
| 服务端 | hono、@hono/node-server、undici、busboy、zod v4、open、@modelcontextprotocol/server、@modelcontextprotocol/hono |
| 前端 | react@18、react-router、zustand、i18next、@codemirror/*、@radix-ui/*、lucide-react、@dnd-kit/*、@tanstack/react-virtual、fflate、tailwindcss v4 |
| 开发 | vitest、@testing-library/react、happy-dom、playwright、tsx、tsup、concurrently、cross-env |

### 可插拔 provider（核心）

```
ProviderDef（baseUrls 白名单 / endpoints 白名单 / auth / polling / limits / adapter）
 └ ModelDef（apiModel、family、lifecycle、docs{url,checkedAt}、modes、fields、constraints、refSyntax、allowEndpointOverride）
    ├ ModeDef（slots 素材槽：kind/role/min/max/sources/localTransport/MediaSpec；prompt 要求；locked 锁定值+原因；wire 常量）
    ├ FieldDef（enum/int/bool/seed/text/size/duration；默认/范围/枚举；visible/disabled(带原因)/unavailable；send 策略；wire.path）
    └ Constraint（跨字段校验，级别 error/warn/info，可带一键修复 patch）
engine.evaluate(ctx) → EvaluatedForm（字段状态、有效值、issues、canSubmit）—— 表单渲染、提交拦截、构建、MCP 校验、测试共用
adapter.build(ctx)   → BuiltRequest（预览与发送共用；素材经 AssetResolver 注入：预览用占位，提交时才编码或上传）
adapter.normalize / parseStreamEvent / extractAssets / normalizeError → 统一的 TaskStatus、ResultAsset、NormalizedError
wireGuards           → 对最终 JSON 的最后一道检查（例如 2.5 首帧 ratio 必须是 adaptive、正片不能带禁止字段），服务端转发前必跑
```

- 条件和约束都写成 TS 纯函数，前后端共享同一份。禁用时必须给出原因文案。
- `order.ts` 同时决定 content[] 的顺序和 `@Image n` 的编号，保证两者一致。提示词内部存成 `{{ref:<assetId>}}`，构建请求时再按模型语法渲染。
- 字段发送规则：
  - 模型不支持的字段，根本不写进它的声明；
  - 可见字段一律显式发送（Seedream 的 `size` 也显式发），这样就绕开了文档里默认值互相矛盾的问题；
  - `RawOverrides` 是高级 JSON 合并，留给 `tools` 这类未写进文档的字段，界面上醒目警告。
- 新增服务商：新建 `src/shared/providers/<new>/`（index/models/build/parse/errors），在 registry 里注册一行，再补 fixtures 和 mock。服务端路由、ParamRenderer、调度器、MCP 工具、历史页、设置页都不用改。MCP 工具从目录自动生成模型 schema。
- 参数蓝本：
  - TanStack/ai `packages/ai-byteplus`（MIT）、AstraForgeStudio（MIT）、Henji-AI 的声明式目录 + ParamRenderer（Apache-2.0）。摘抄的代码写进 `THIRD_PARTY_NOTICES.md`，并逐项对照调研报告。例如 TanStack 认为 Draft 只有 1.5 pro 支持，这和官方文档冲突。
  - AGPL 或限制性许可的项目只借思路。

**首批约束**（ID 就是测试用例 ID，细节见 `docs/research/`）

- **Seedream**
  - C-SD-1：图层分解只能传 1 张 png/jpeg，像素 ≥262,144。
  - C-SD-2：透明背景要求恰好 1 张带 alpha 的输入图，输出强制 png。
  - C-SD-4：参考图张数 + max_images ≤15（只给 warn）。
  - C-SD-5：自定义像素要落在像素区间内，且宽高比在 [1/16,16]。
  - C-SD-6：参考图上限，pro/flash 10 张，其余 14 张。
  - 组图和流式只开放给 lite/4.5/4.0；fast 优化模式只开放给 pro/4.0；output_format 只开放给 pro/flash/lite。
- **Seedance**
  - C-SE-2：2.5 的首帧/首尾帧/编辑/延长锁定 `ratio=adaptive`。
  - C-SE-3：编辑任务锁定 `duration=-1`，参考视频 4–30s，prompt 必填，并提示意图关键词。
  - C-SE-5：draft 锁定 480p。
  - C-SE-6：正片只发送 `draft_task` 和允许重设的字段。单测断言请求里不含 text、素材、duration、ratio、seed、generate_audio、omni_reference_task_type。
  - C-SE-7：参考素材的数量与时长。2.5 为 30/10/10、总时长 30s；2.0 为 9/3/3、总时长 15s，且不能只传音频。
  - C-SE-8：素材规格。
  - C-SE-9：本地视频必须经 UploadTarget 上传，或改填 URL / asset://。
  - C-SE-10：请求体 ≤64MB。
  - C-SE-13：flex 只开放给 1.x。
  - C-SE-16：prompt 里不能写 asset ID，也不能用 `--rs` 这类旧写法。
  - C-SE-21：用了托管直链时，自动把 `execution_expires_after` 设为 `min(172800, 托管剩余寿命 − 1h)`，并在预览里显示（可关闭）。
- **MiniMax**
  - image-01：
    - 尺寸是复合字段：8 种比例，或自定义宽高。自定义宽高只用于 image-01，范围 [512,2048] 且是 8 的倍数；选了自定义就不发 aspect_ratio。
    - 其他限制：n 为 1–9；prompt ≤1500；subject 只能 1 张 jpg/png，且 <10MB。
  - H3：
    - 文生视频时 ratio 必填，且不能是 adaptive；图生视频时不发 ratio。
    - 参考素材 9/3/3，合计 ≤12。
    - H3 为 768P/2K、4–15s；H3-Max 为 480P/768P、5–15s，并带 `extra.prompt_expansion_mode`；text ≤7000。
  - 文档有冲突的项（image-01-live 文生图、H3 只传尾帧、H3-Max 参考模式）标为「实验」，默认隐藏。

### 本机服务 API（网页用）

| 路由 | 作用 |
|---|---|
| `GET /api/health` | 返回版本、dataDir、ffprobe 是否可用、是否 mock 模式 |
| `GET/PUT/DELETE /api/keys/:provider`、`POST …/test` | 读写 Key（只返回打码后的值）；免费校验：BytePlus 调 List(page_size=1)，MiniMax 调 V2 List |
| `POST /api/assets` | 上传本地素材（流式写盘、算 sha256、去重），返回 assetId 和元数据（宽高、时长、alpha） |
| `POST /api/preview` | 用表单快照算出 issues、最终请求体（data URI 截断）、curl、体积和预估费用；**MCP 的 preview_request 调用同一个函数** |
| `POST /api/tasks` | 提交表单快照 `{provider, model, mode, values, assets, prompt}`。服务端重新 evaluate → 解析素材（含上传确认校验）→ build → wireGuards → 发送 → 写 SQLite。同步图像返回结果；视频返回任务 |
| `POST /api/tasks` + `stream:true` | Seedream SSE：服务端解析并重新编码转发，剥离 b64，注入 `ark.capture`/`ark.error`/`ark.done`；浏览器断开不影响落盘 |
| `GET /api/tasks`、`GET /api/tasks/:id` | 历史列表（筛选、分页）和详情（含 exchanges） |
| `POST /api/tasks/:id/cancel`、`DELETE /api/tasks/:id?remote=1` | 取消 queued 任务；删除本地或云端记录 |
| `POST /api/tasks/:id/refresh` | 立即重查 |
| `GET /api/cloud/:provider/tasks` | 云端任务列表（手动刷新；BytePlus 限 1 rps），可导入本地 |
| `GET /api/events` | SSE：推送任务状态变化、落盘完成、上传进度 |
| `GET/PUT /api/presets`、`/api/templates` | 预设与模板 CRUD、导入导出 |
| `GET /api/outputs/index`、`POST /api/outputs/reveal`、`/open` | 从 manifest 重建历史；在访达或资源管理器中显示；用系统播放器打开 |
| `GET /files/*` | 访问 outputs，支持 Range，防路径穿越 |

- **本机防护（local-guard）**
  - Host 必须是 `127.0.0.1` 或 `localhost` 加端口，防 DNS 重绑定。
  - Origin 必须同源（`/mcp` 也一样，非法时返回 403）。
  - `/api/*` 要求 `Sec-Fetch-Site` 为 same-origin 或 none，并且必须带 `X-Ark-Client` 头。
    例外：`GET/HEAD /api/assets/:id/content` 不要求 `X-Ark-Client`（网页用 `<img>` 直接加载素材，带不了自定义头），其余检查同上，与 `/files/*` 同等防护；响应带沙箱 CSP，直接打开时不执行其中的脚本。
  - `/mcp` 要求 `Authorization: Bearer <mcp-token>`：32 字节随机数，存在 `<dataDir>/mcp-token`，设置页可以轮换。
- **转发请求头从零构建**：不转发 Origin、Referer、Cookie。上游 base URL 只能从白名单 id 解析出来，防 SSRF。
- **超时**（undici 默认 300s 不够用，需自定义 Agent）

  | 场景 | 超时 | 重试 |
  |---|---|---|
  | Seedream 同步 | 15 分钟 | — |
  | SSE | 空闲 180s | — |
  | 创建任务 | 60s | **不重试**。超时时标为 `submit_unknown`，引导用户去云端任务核对 |
  | 查询 GET | 20s | 重试 1 次 |
  | 结果下载 | — | 重试 3 次，写 `.part` 文件，完成后改名 |

- **限速**：BytePlus GET 10 rps、List 1 rps；MiniMax 查询 5 rps；MiniMax image 10 RPM。
- **体积**：转发前计算实际请求体字节数，超过 64MB 返回 413。上传用 busboy 流式写盘。
- **落盘**
  - 幂等键 `provider:taskId:kind`，Promise 锁合并并发请求；ledger 写进 SQLite，重启后不会重复下载。
  - 只允许 https，拒绝私网地址；b64 直接解码写盘。
  - H3 的链接过期后重查任务换新链接。
- **日志**
  - 只记录方法、路由、状态、耗时、上游 request-id。
  - Key、token、签名参数、托管直链一律打码；data URI 截断。
  - 单测断言日志里不出现 Key 原文。

### MCP 工具（`src/server/mcp/`）

| 工具 | 注解 | 说明 |
|---|---|---|
| `list_models` | readOnly | 列出服务商、模型、模式、能力徽标、生命周期 |
| `get_model_schema` | readOnly | 给定模型，返回字段（类型/默认/范围/枚举/按模式可用性）、素材槽、约束说明、提示词规则（由目录自动生成） |
| `preview_request` | readOnly | 输入同 generate 类工具，返回 issues、最终请求体、curl、体积、预估费用，**不提交** |
| `generate_image` | openWorld | 同步生成。输入：model、mode、prompt、params、assets（本地绝对路径 / URL / `task:<id>#<index>`）、可选 preset_id。返回：taskId、本地文件路径、内联缩略图（每张 ≤~200KB，控制 token）、usage、预估费用 |
| `create_video_task` | openWorld | 返回 taskId。可选 `wait_seconds`（≤540），等待期间推送 `notifications/progress`，超时返回当前状态 |
| `get_task` | readOnly | 返回状态、输出文件路径、错误；可选 `wait_seconds`、`include_images` |
| `list_tasks` | readOnly | 查本地共享历史，可按服务商/模型/状态/时间筛选 |
| `cancel_task` | destructive | 取消 queued 任务，或删除云端记录 |
| `list_presets` | readOnly | 列出预设，generate 类工具可以通过 `preset_id` 套用 |

- 所有提交都走同一个 `TaskService.submit()`，所以 agent 发起的任务会实时出现在网页的历史和队列里（通过 EventBus 推送）。
- 本地视频要上传到公共托管站时，必须带 `allow_public_upload: true`；否则返回错误，说明隐私风险，并给出替代方式（URL / asset:// / 复用结果）。
- 不设花费限制，不加 `anthropic/requiresUserInteraction`（用户决定）。每个结果里附带预估费用，方便 agent 自己判断。
- schema 用 zod v4 生成 JSON Schema 2020-12，根层不用 anyOf/oneOf。按 provider 区分的参数统一放在 `params` 对象里，由 `preview_request` 和 `get_model_schema` 引导填写；服务端用 evaluate 严格校验，错误以 `isError` 返回，并附可修复建议。
- 接入方式：设置页的 MCP 卡片显示一键复制的命令 `claude mcp add --transport http --scope user ai-video http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`，以及推荐的 `timeout: 600000`。文档写在 `docs/mcp.md`。

### 上传目标 UploadTarget（Seedance 参考视频）

```ts
interface UploadTarget {
  id: string; kind: 'temp-host' | 'provider-files' | 's3-compatible'; label: I18nText;
  privacy: 'public-link' | 'provider-private' | 'presigned';
  maxBytes: number; ttlOptions: string[]; defaultTtl: string; supportsDelete: boolean;
  requiresConsent: boolean; scope?: { providers?: string[] };
  upload(file: SpooledFile, opts: { ttl; filename; mime; signal; providerKey? }):
    Promise<{ url: string; expiresAt: number | null; deleteHandle?: string; verified?: VerifyResult }>;
  delete?(handle: string, opts): Promise<void>;
}
```

- **`uguu`（默认）**
  - `POST https://uguu.se/upload`，multipart 字段 `files[]`。
  - 返回 JSON：`{success, files:[{hash, filename, url, size, dupe}]}`。
  - 单文件上限 128 MiB；从上传时起固定保留 3 小时；免账号；不能删除。
- **`tmpfiles`（备选）**
  - 单文件上限 100 MiB；保留时长 60s–48h，我们传 24h。
  - 直链要改成 `/dl/{id}/{name}`。
  - 站点在 Cloudflare 后面，可能有人机验证；不能删除。
  - P5 开工前再读一次它的官方 API 页，确认字段名。
- **`minimax-files`**：只给 MiniMax 用，`/v1/files/upload` → `mm_file://`，有效期 7 天。
- **`mock`**：测试用。
- **自动选择**：视频 >128 MiB，或预计排队超过 3 小时，就提示切到 tmpfiles；超过 100 MiB 时提示压缩（可以用 ffmpeg 一键压缩）。
- **明确排除的站点**：
  - catbox / litterbox：运营者在 2026-04 的官方博客里，把"Claude 编码项目拿它当中转"定性为滥用。
  - 0x0.st：条款禁止 AI 内容和自动化批量上传。
  - file.io、gofile 免费版。
- **安全措施**：
  - 网页弹出确认框，列出文件、站点、保留时长、"链接公开、任何人可下载"；
  - 服务端要求 `X-Upload-Consent` 头（或 MCP 的 `allow_public_upload`），缺失时返回 428；
  - 上传后服务端 GET 直链自检（字节数一致、不是 HTML 中间页）；
  - 按 sha256 缓存直链和过期时间。
- **复用历史结果**：官方原始 URL 剩余有效期 >3 小时就直接用（这样能保持"可信输出"身份），否则走 UploadTarget，并提示可信状态可能丢失。
- **其他素材**：
  - BytePlus 的图片和音频用 data URI；
  - MiniMax 的视频默认用 mm_file，图片和音频用 data URI，估算请求体超过 48MB 时自动改成 mm_file。
- **后续**：`s3-compatible`，TOS/R2/S3/OSS 共用。TOS 已调研：Johor 外网域名 `tos-ap-southeast-1.bytepluses.com`，只支持 virtual-hosted；`@volcengine/tos-sdk` 必须显式传 endpoint；预签名 URL 最长 7 天。

### 前端

- **路由**：`/` 工作台、`/history`（含"云端任务"子 Tab）、`/library`（预设和模板）、`/settings`（Key、上传目标、MCP 接入、通用、数据）。任务详情用抽屉打开，地址是 `?task=<id>`。
- **工作台三栏**：
  - 左栏：ModelPicker，按图像/视频分组，带能力徽标，"显示已弃用模型"默认关闭。
  - 中栏，从上到下：
    1. ModeTabs；
    2. PromptEditor（CodeMirror 6）：输入 `@` 补全素材芯片；Seedance 2.5 的 `()` `<>` `{}` `【】` 语法按钮；编辑/延长关键词模板；lint；
    3. SlotList：支持拖放、URL、asset://、从历史选择；dnd-kit 排序会影响编号；本地文件先 `POST /api/assets`；
    4. ParamRenderer：按声明渲染。锁定的字段显示锁图标和原因，附文档链接和 checkedAt；同一 family 内切换模型时自动迁移参数，并列出改动；
    5. IssuesPanel：可一键修复；
    6. SubmitBar：显示请求体大小（x/64MB）和预估费用。
  - 右栏 Tab：请求预览（JSON / curl，防抖 150ms）、任务队列、最新结果。
- **结果展示**：
  - StreamGrid：流式出图时逐格填充。
  - LayerViewer：底图上按 bbox 定位各图层，可切换显隐，棋盘格背景；可导出合成 PNG，或用 fflate 打成 zip。
  - VideoPlayer：只播放 `/files` 下的文件。播放失败时显示降级面板：用系统播放器打开，并显示 ffprobe 信息。
  - 卡片操作：复用参数、用作参考/首帧/尾帧、用尾帧接续、编辑/延长此视频、从样片生成正片、下载、在访达/资源管理器中显示。
- **状态**：
  - 任务、历史、预设都来自服务端 REST，再加 `/api/events` 实时更新；
  - Zustand 只管 UI 状态和表单草稿（localStorage，不存 Key）；
  - 不再用 IndexedDB。

### 任务生命周期（服务端 TaskService + Scheduler）

- **状态机**
  - 提交阶段：`awaiting_consent → resolving_assets → submitting`，之后分三路：
    - 同步任务：`succeeded | partial | failed`；
    - 流式任务：先 `streaming`，再进入上面的终态；
    - 异步任务：`queued ⇄ running → succeeded | failed | cancelled | expired`。
  - 异常状态：`submit_unknown`（创建请求超时或进程崩溃，不自动重提）、`unknown`（超出 7 天查询窗口，或连续出错）。
  - 落盘状态：`none → pending → done | failed`，失败可以重试。
- **轮询**
  - Seedance：提交后 5s 首查；2 分钟内每 5s 一次，10 分钟内每 10s，之后每 15s。
  - H3：提交后 10s 首查，之后每 10s，10 分钟后改为每 15s。
  - ±10% 抖动；遇到 429/5xx 按 ×2 退避，上限 60s；连续 10 次出错就暂停。
  - 截止时间：`created_at + execution_expires_after + 10min`。
  - 服务启动时，从 SQLite 读出所有非终态任务，继续轮询。
- **Draft**
  - 在 2.5 或 1.5 pro 上打开 draft，锁定 480p；成功后记录 `validUntil = created + 7d`。
  - 样片卡片上点"生成正片"，进入派生模式 `draft-final`：模型锁定，只保留可重设的字段，默认带入样片的值。
  - 2.5 的正片 resolution 先不发送，以实测为准。
- **编辑/延长**：从结果卡片一键进入 2.5 的对应模式（2.0 用全能参考模式加 prompt 模板）。reference_video 填历史结果，自动锁定 duration 和 ratio。

### 跨平台约束（为以后打包 mac/win）

- 所有路径都从 `dataDir` 出发：
  - 开发时用 `./data`；
  - 打包后 mac 用 `~/Library/Application Support/AI视频生成平台/`，Windows 用 `%APPDATA%\AI视频生成平台\`。
- 代码约束：
  - 一律用 `path.join` / `os.homedir()`；
  - 输出文件名避开 Windows 的非法字符和超长路径；
  - 端口可以动态分配；
  - 不用原生 C++ 模块。
- 平台相关功能要分别实现：
  - 在文件夹中显示：mac 用 `open -R`，Windows 用 `explorer /select,`；
  - ffprobe/ffmpeg 按平台在 PATH 里查找（可选增强）；
  - keys.json 在 mac 上设权限 0600；打包后改用 Electron safeStorage（mac 钥匙串 / Windows DPAPI）。
- CI 从 P0 开始就在 macOS 和 Windows 上跑。

## 分阶段实施与验证

真实调用一律用用户在设置页填的 Key。每个 R 项**执行前都要在对话里说明费用，等用户确认后再做**；免费的 List 或"测试 Key"也先征得同意。

| 阶段 | 内容 | 验证（不碰真实上游） | 真实调用检查点（需确认） |
|---|---|---|---|
| **Step 0** | Node 26、Git 初始化、推送公开仓库 | `node -v`、`git log`、`gh repo view` | — |
| **P0 脚手架** | package.json；tsconfig 三份；Vite（127.0.0.1）；Tailwind v4；服务端 `startServer` 加 dataDir 配置；health、local-guard、static、keystore；dev/build/start 脚本；ESLint 边界规则；Vitest；CI（mac/win × Node 24/26） | `npm run dev` 页面显示"服务在线"；`npm start` 打开 127.0.0.1；`lsof` 确认只监听回环地址；守卫测试：错误 Host/Origin 或缺少头时返回 403；shared 里引用 DOM/Node 会编译失败；CI 两平台全绿 | — |
| **P1 共享内核 + 两家图像声明** | catalog/engine/request/sse/task；BytePlus seedream 全套；MiniMax image-01（第二家用来验证抽象是否合理） | C-SD-* 和 image-01 表驱动测试；约 25 例请求黄金快照，人工对照文档；SSE 在任意位置切块都能解析；curl 转义；错误归一化（含 HTTP 200 + base_resp 错误） | — |
| **P2 服务核心** | upstream、store(node:sqlite)、TaskService(同步)、assets、capture、events、preview、files(Range)、logger、body-limit、mock-upstream、`dev:mock` | 用 mock 做集成测试：Key 改写且不外传 Origin；日志里没有 Key；64MB 返回 413；超时返回 504；创建请求不重试；GET 遇 503 会重试；浏览器断开后落盘仍完成；SSE 注入 ark.capture；`/files` Range 返回 206；路径穿越被拒；重启后 ledger 生效 | — |
| **P3 网页工作台（图像打通）** | 布局、i18n、设置（Key 写入 keystore）、ModelPicker、ModeTabs、ParamRenderer、素材、PromptEditor、预览/curl、StreamGrid、LayerViewer、基础历史、复用参数 | 组件测试；Playwright + mock 跑通：文生图、组图流式、图层分解、透明背景、image-01 文生图/主体参考、复用参数 | R1a 两家测试 Key（免费）；R1b Seedream 5.0 flash 1K 1 张（约 $0.018）；R1c 4.0 流式组图 2 张；R1d 5.0 pro 图层分解（最多 17 张，单独确认）；R1e 透明背景 1 张；R1f image-01 n=1（$0.0035） |
| **P4 异步视频** | Seedance + H3 的声明、构建、解析；Scheduler/recovery；限速；队列；VideoPlayer 降级；云端任务面板；Endpoint ID 覆盖；Draft | C-SE-* 与 H3 约束全部测试；每个模型 × 模式的 content[] 快照；正片禁止字段断言；用假定时器测调度器；mock 状态机（含异步 TaskTypeConstraint、expired）；并发查询加重启后结果只下载 1 次 | R2a List（免费）；R2b 2.0 fast/mini 480p 短视频；R2c 2.5 首帧；R2d 2.5 Draft + 正片（两次计费，单独确认）；R2e H3-Max 480P 5s（约 $0.25）；R2f 取消一个 queued 任务 |
| **P5 素材上传 + 全模态参考** | UploadTarget（uguu、tmpfiles、minimax-files、mock）、上传确认、直链自检、Seedance omni + 2.5 edit/extend、H3 r2v、"编辑/延长此视频"入口 | mock 托管站测试：返回页面链接、错误 Content-Type、HTML 中间页、缺少同意头返回 428；sha256 去重；file_id 大整数不丢精度；素材重排后编号与 content 顺序一致 | R3a 用 ffmpeg 合成一段测试视频，上传到 uguu 并 curl 验证直链（内容会公开，单独确认）；R3b 用这个直链跑 2.0 mini 参考视频任务（验证 BytePlus 能拉取）；R3c MiniMax mm_file 上传 + H3-Max r2v；R3d 对 24h 内的结果一键延长（2.5） |
| **P6 MCP** | mcp-auth 令牌、`/mcp`（createMcpHandler，legacy stateless）、9 个工具、progress 通知、设置页 MCP 卡片、`docs/mcp.md` | 用官方 SDK client 做集成测试：无 token 返回 401、非法 Origin 返回 403、工具 schema 能通过 2020-12 元 schema 校验、preview 与网页结果一致、MCP 提交的任务出现在 `/api/events`、`allow_public_upload` 缺失时报错 | R5a 用本机 Claude Code 接入：`claude mcp add …` 后执行 list_models / preview_request（免费）；R5b 让 agent 用 generate_image 生成 1 张（计费）；R5c 让 agent 用 create_video_task 加 wait_seconds 生成 1 段 480p 短视频（计费）。确认 Claude Code 2.1.220（v1 运行时）能握手；不行就退回 v1 SDK |
| **P7 历史/预设/模板/数据** | 筛选、收藏、谱系、详情；CRUD 与导入导出；从 outputs 重建历史；删除本地结果；在文件夹中显示；图层 zip | e2e；清空 SQLite 后从磁盘重建 | — |
| **P8 加固** | CSP（`connect-src 'self'`、`media-src 'self' blob:`）、a11y、i18n 键一致性脚本、性能、ffprobe、可选 HEVC 兼容转码、`docs/adding-a-provider.md` | 脚本加手测 | — |

每个阶段结束时：`npm run typecheck && npm test` 全绿（P3 起再加 `npm run test:e2e`），然后提交并推送 GitHub，并确认 CI 在 mac/win 上都通过。

**后续版本**：Electron 打包 mac/win 并发 Releases、S3 兼容存储（TOS/R2/S3/OSS）、Claude Desktop 聊天界面的 stdio 桥、Seedream 交互式 point/bbox 编辑。

## 风险与待确认项

1. **临时托管站**
   - uguu/tmpfiles 的视频 Content-Type、Range、直链行为还没实测；tmpfiles 可能被 Cloudflare 挑战拦住。
   - Seedance 何时拉取参考 URL、下载超时多久，官方都没写。靠 R3a/R3b 实测；另外用 C-SE-21 把 `execution_expires_after` 缩短来兜底。
   - 视频会公开放在第三方站点，靠确认框和 `allow_public_upload` 让用户知情。
2. **MCP 兼容性**：v2 SDK 的 legacy 模式能否让本机 Claude Code 2.1.220（v1 运行时）正常握手、progress 是否显示，在 R5a 实测；不行就用 v1 SDK `@modelcontextprotocol/sdk` 1.32.x。Claude Code 对 `resource_link` 和 `structuredContent` 的处理没有文档说明，所以工具结果一律同时给出文本路径。
3. **2.5 Draft 是否支持**：官方文档说支持，arkcli 目录说不支持；正片要不要显式传 resolution，也以 R2d 实测为准。
4. **未明确的字段**：2.x 是否接受 seed、`tools` 字段的语义都没写进文档 → 不暴露，留给 RawOverrides。
5. **播放兼容**：10-bit HEVC / mov 4:4:4 在浏览器里可能放不了（Windows 还取决于 HEVC 扩展）→ 降级面板。
6. **超长任务**：同步生图可能超过 5 分钟 → 用自定义 undici 超时。服务重启会丢掉正在进行的同步作业；创建类请求记为 `submit_unknown`。
7. **MiniMax 账号与链接**：订阅 Key（`sk-cp-`）能否调 REST 接口不明确，H3 要求按量付费 Key，界面给出提示；`content.url` 的有效期没写，所以生成后立即落盘。
8. **限流**：个人账号的 Seedance 是 RPM 180、并发 3，queued 数也有上限（会报 429 QuotaExceeded）→ 界面显示排队状态和说明。
9. **SQLite 选型**：`node:sqlite` 在 Node 24.15+/25.7+ 处于 Release Candidate，官方说明"不建议用于生产"。本机单用户可以接受；包一层 repository，必要时换成 better-sqlite3（自带 mac/win 预编译）。
10. **安全**：Key 存在本机文件，MCP 只用 token 鉴权 → 只监听 127.0.0.1、校验 Host/Origin、令牌可轮换、CSP、不渲染远端 HTML、日志脱敏。
11. **文档会变**：每个 ModelDef 都带 `docs.checkedAt`。
12. **P2 待验证**：@hono/node-server 的 serveStatic 是否支持 Range，以及能否检测到客户端断开。
13. **公开仓库**：调研报告公开前已检查，没有账号 ID 和 Key；`.gitignore` 排除了 data/outputs/缓存；代码里不出现任何 Key。
