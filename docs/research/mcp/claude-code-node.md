## 修正后的报告：客户端接入方式与 Node 能力（已逐条对照官方原文）

这次核查全程只读：没写项目文件，没装包，没改配置。用到的只有 curl GET 官方文档原文（.md）、`npm view`，以及在内存库上跑的 `node -e`。

本机环境：Node v25.9.0（darwin-arm64，napi=10，`process.versions.sqlite`=3.53.0），PATH 上的 Claude Code 是 2.1.220。npm 上 `@anthropic-ai/claude-code` 最新是 **2.1.292**，本机落后 72 个小版本。下面凡是标了版本要求的功能，都对照了本机的 2.1.220。

---

### 1) Claude Code 接入 MCP

#### 1.1 添加服务器的命令

来源：https://code.claude.com/docs/en/mcp （Installing MCP servers）

- **HTTP（推荐）**
  - 写法：`claude mcp add --transport http <name> <url> [--header "Authorization: Bearer ..."]`。
  - `--transport` 可简写为 `-t`，`--header` 可简写为 `-H`。
  - JSON 配置里，`type` 可以写 `http`，也可以写别名 `streamable-http`。
  - 有 `url` 没 `type` 会报错：`MCP server "<name>" has a "url" but no "type"; add "type": "http" (or "sse" / "ws") to this entry`。
    - 原因：不写 `type` 时按 stdio 处理。
    - 这条报错文本要求 v2.1.202+，本机符合。
- **SSE**
  - 已废弃。
  - 用 `--transport http` 连只支持 SSE 的服务器时，会自动切换到 SSE。这个自动切换要求 **v2.1.265+**，本机不满足。
  - 本机如果要连 SSE，必须显式写 `--transport sse`。
- **stdio**
  - 写法：`claude mcp add [options] <name> -- <command> [args...]`。`--` 之后的内容原样交给服务器命令。
  - `-e/--env KEY=value` 可以接多对。
  - 服务器名不能紧跟在 `--env` 后面，中间要隔一个别的选项。
  - 子进程会拿到这些环境变量：
    - `CLAUDE_PROJECT_DIR`
    - `CLAUDE_CODE_SESSION_ID`
    - `CLAUDECODE=1`
    - 来源：https://code.claude.com/docs/en/env-vars
- **ws**
  - 只能通过 `.mcp.json` 或 `claude mcp add-json` 配置，`--transport` 不接受 `ws`。
  - 只支持 header 认证，不支持 OAuth。
  - `claude mcp list` 里不显示 ws 服务器。
- **`claude mcp add-json <name> '<json>'`**
  - 传入的是 `mcpServers` 里的单个条目，不要带 `mcpServers` 这层外壳。
- **服务器名**
  - 只能用字母、数字、`-`、`_`。
  - 以下内置名称被保留：`workspace`、`claude-in-chrome`、`computer-use`、`Claude Preview`、`Claude Browser`。

#### 1.2 scope 与 `.mcp.json`

来源同上（MCP installation scopes）

| scope | 存放位置 | 说明 |
|---|---|---|
| `local`（默认） | `~/.claude.json` → `projects["<项目路径>"].mcpServers` | 只在当前项目生效，只有自己能用 |
| `project` | 项目根目录的 `.mcp.json` | 可以提交进版本库；交互式会话使用前会弹窗请用户批准；`claude mcp reset-project-choices` 可重置批准记录 |
| `user` | `~/.claude.json` 顶层 | 所有项目都能用 |

- **哪些情况不弹批准窗口**
  - `claude -p`、Agent SDK、云端会话：不弹窗，直接加载。
  - `bypassPermissions` 模式且设置了 `skipDangerousModePermissionPrompt`：也不弹。
  - 想挡住某个服务器：
    - 用 `disabledMcpjsonServers`；
    - 或 `--setting-sources`；
    - 或 `--strict-mcp-config`。
- **工作区信任**：从 v2.1.196 起，未信任的文件夹里，仓库自带的 `enableAllProjectMcpServers` / `enabledMcpjsonServers` 会被忽略。
- **同名服务器优先级**
  - 顺序：`managedMcpServers`（v2.1.259+）> local > project > user > plugin > claude.ai connectors。
  - 整条配置按优先级取用，不跨 scope 合并字段。
  - 三个 scope 之间按名字判重；plugin 和 connector 按 endpoint 判重。
- **`.mcp.json` 示例**

  ```json
  {"mcpServers":{"shared-server":{"type":"http","url":"https://example.com/mcp"}}}
  ```

- **变量展开**
  - 支持 `${VAR}` 和 `${VAR:-default}`。
  - 可用在 `command`、`args`、`env`、`url`、`headers` 里。
  - 变量没设置又没写默认值时：给出警告，原样保留 `${VAR}` 文本。
- **凭据变量读成空串**
  - 范围：远程服务器的 `url` / `headers`。
  - 文档举的例子：`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`AWS_BEARER_TOKEN_BEDROCK`、`HTTPS_PROXY`、`NPM_TOKEN`。
  - 这些名字不管有没有设置都读成空，`:-default` 对它们也不生效。
  - 原文：A name outside this set, such as `API_KEY`, expands as written。
  - **修正**：文档没说明这个集合是固定名单，还是按名字模式匹配。名单里有 `NPM_TOKEN`，所以以 `_TOKEN` 结尾的自定义名（例如 `ARK_MCP_TOKEN`）也可能被读成空。
  - 实际使用前要验证：运行 `claude --debug-file <scratch路径>`，在日志里搜 `never expanded toward a remote server`。不确定时，就改用不像凭据的中性变量名。
- **其他字段**
  - `timeout`：单位毫秒，小于 1000 会被忽略。
  - `alwaysLoad: true`：跳过 tool search，启动时最多等 5 秒。单个工具也可以在 `_meta` 里写 `"anthropic/alwaysLoad": true`。
  - `headersHelper`：
    - 每次连接都运行一次，10 秒超时。
    - 项目级和 local 级的 helper，要等文件夹被信任后才运行。
    - 项目 `.mcp.json` 里的 helper 运行时，会**去掉**名字含 TOKEN/SECRET/PASSWORD/KEY/AUTH 的环境变量，所以 helper 应该从文件或凭据库里读密钥。

**本平台示例**（推断，`/mcp` 路径只是假设）

```json
{"mcpServers":{"ark":{"type":"http","url":"http://127.0.0.1:8787/mcp","headers":{"Authorization":"Bearer ${<自定义变量名>}"},"timeout":600000}}}
```

- 不建议用 `claude mcp add --scope project -H "Authorization: Bearer <明文>"`：shell 会先展开，明文 token 会写进要提交的 `.mcp.json`（推断）。
- 个人机器上也可以用 local scope，配置存在不提交的 `~/.claude.json` 里。

#### 1.3 超时与输出限制

来源：https://code.claude.com/docs/en/mcp ；https://code.claude.com/docs/en/env-vars

**输出限制**

- `MAX_MCP_OUTPUT_TOKENS`：默认 25000；超过 10000 token 给出警告，这个警告阈值固定，不能改。
- 没有图片的成功结果超过 token 上限：存到会话的 `tool-results` 目录，对话里只给 Claude 一个文件路径。
- 只对前台调用生效的两条：
  - 没声明 `anthropic/maxResultSizeChars` 的工具，成功的文本结果超过 50,000 字符就存文件（不受 `MAX_MCP_OUTPUT_TOKENS` 影响）。
  - `isError: true` 的错误文本超过约 11,000 字符时，只保留开头 5,000 和结尾 5,000 字符。
  - 转成后台任务的调用，结果走 task notification。
- `_meta["anthropic/maxResultSizeChars"]`：
  - 在 `tools/list` 里声明，上限 500,000 字符。
  - 只对文本有效。含图片的结果始终受 `MAX_MCP_OUTPUT_TOKENS` 约束。
- 工具描述和 server instructions：默认在 2,048 字符处截断。`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` 可以调整，但要求 v2.1.280+，本机不可用。

**超时**

| 项目 | 规则 |
|---|---|
| `MCP_TIMEOUT` | 启动超时，30000 ms |
| `MCP_TOOL_TIMEOUT` | 100000000 ms（约 28 小时）；per-server `timeout` 会覆盖它；这是墙钟上限，progress 通知不会延长它 |
| HTTP/SSE 单次请求计时（到服务器返回首字节为止） | 取 60 秒、该服务器适用的工具超时、`MCP_TIMEOUT` 三者中的最大值；28 小时的默认值不参与比较；stdio 和 ws 没有这个计时 |
| 空闲超时（既没有响应也没有 progress） | HTTP/SSE/ws 5 分钟，stdio 30 分钟；可用 `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` 调整，0 表示关闭，不能超过实际生效的 `MCP_TOOL_TIMEOUT`；per-server `timeout` ≥1000 时同时作为空闲超时的下限（v2.1.203+） |
| 自动转后台 | 主会话调用超过 2 分钟转成后台任务（v2.1.212+，`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` 可调），`/tasks` 显示最新 progress；子代理、IDE 服务器、`-p`（除非 `CLAUDE_AUTO_BACKGROUND_TASKS=1`）不转后台；elicitation 对话框开着时推迟 |

**对平台的影响**（推断）

- 同步出图如果可能超过 60 秒，有两种办法：
  - 把服务器的 `timeout` 设到 60000 以上，例如 600000，单次请求计时会随之放宽；
  - 或者尽早返回首字节，持续发 `notifications/progress`。
- 前提是客户端在请求里带了 `progressToken`。文档没有明文写 Claude Code 一定会带。

#### 1.4 各项能力的支持情况

**image content**

- 支持 PNG/JPEG/GIF/WebP，内联给 Claude 看，可能被缩放或压缩。
- 原图另存为文件要求 **v2.1.283+**，本机只能拿到内联图。
- 开了 `--no-session-persistence` 时也不存文件。

**resource_link**

- Claude Code 文档没有提到。
- 规范里有定义：https://modelcontextprotocol.io/specification/2026-07-28/server/tools 。2026-07-28 是规范当前的 current 版本，见 https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning 。
- 文档能确认的只有：
  - resources 可以用 `@server:protocol://path` 引用；
  - Claude Code 会自动提供列出和读取 resources 的工具；
  - `ui://` 资源不进入 `@` 建议列表。

**elicitation**

- 支持 form 和 url 两种模式，弹对话框，也可以用 `Elicitation` hook 自动应答。
- url 模式下，转义后的 URL 上限约 8,000 字符。
- 在 2026-07-28 协议版本的连接上，会声明 `elicitation: {form: {}, url: {}}`。

**progress**

- 会重置空闲超时，在 `/tasks` 里显示，不延长墙钟上限。
- 规范：https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress 。请求里带 `_meta.progressToken`，服务器发 `notifications/progress`；`progress` 必须递增，`total` 和 `message` 可选。

**其他**

- `list_changed` 支持。
- `roots/list` 支持（v2.1.203+ 包含额外的工作目录）。
- OAuth 支持。v2 运行时只把 OAuth 凭据发给 HTTPS 的 token endpoint，或 `localhost` / `127.0.0.1` / `::1`。
- prompts 在菜单里显示为 `/servername:promptname (MCP)`，输入 `/mcp__servername__promptname` 也能运行。

**inputSchema 约束**（修正）

- 根层级的 `anyOf` / `oneOf` / `allOf`：
  - 正常情况下会被压平，但这依赖远程配置；压不了的话这个工具会被跳过。
  - anyOf/oneOf 各分支的 `required` 只写进描述，schema 不强制，服务端要自己校验。
- 约束的是**顶层**属性名：1–64 个字符，只能用 `[A-Za-z0-9_.-]`。
- 必须通过 draft 2020-12 元 schema 校验（只针对没声明 `$schema` 或声明 2020-12 的 schema）：
  - 不合格的工具会被剔除，但剔除靠 feature flag 开启；
  - flag 不可用时，schema 照常发出，**整个请求 400 失败**；
  - 这些检查要求 v2.1.216+，本机符合。
- 结论：schema 必须一开始就写对。

**计费工具**：`_meta["anthropic/requiresUserInteraction"]: true`（值必须是 JSON 布尔 `true`）

- acceptEdits、auto、bypassPermissions 下每次调用都弹窗，不提供"don't ask again"，allow 规则也跳不过。
- dontAsk 模式直接拒绝。
- `--permission-prompt-tool` 返回的 allow 会被改成 deny。
- Agent SDK 的 `canUseTool` 可以批准。

**权限规则**

- `mcp__ark`、`mcp__ark__*`、`mcp__ark__<tool>` 三种写法都行。
- allow 规则里没有锚定的 `mcp__*` 会被跳过。
- settings 文件里带括号的 `mcp__` 规则会被跳过。
- 来源：https://code.claude.com/docs/en/permissions

#### 1.5 客户端运行时

- **v1**：基于 TS SDK 1.x。
- **v2**：基于 TS SDK 2.0，加入了 2026-07-28 协议版本。
  - 在拉取 feature flag 的会话里，v2.1.232+ 使用 v2。
  - 在不拉 feature flag 的会话里，v2.1.274+ 默认使用 v2。
  - 可以用 `MCP_SDK_GENERATION=v1|v2` 指定运行时；`MCP_PROTOCOL_NEGOTIATION`（v2.1.221+）控制是否探测协议版本。
- 本机 2.1.220 走 v1（推断）。
- npm 上 `@modelcontextprotocol/sdk` 1.32.1（MIT，node>=18）的协议版本：
  - `LATEST_PROTOCOL_VERSION='2025-11-25'`；
  - 同时支持 2025-06-18、2025-03-26、2024-11-05、2024-10-07。
  - 所以服务端至少要能处理 2025-11-25 及更早的 `initialize` 握手。
- npm 上 `@modelcontextprotocol/server` 最新是 2.3.1（Apache-2.0，node>=20，依赖 `@modelcontextprotocol/core` 2.3.1 和 zod ^4.2.0）。

#### 1.6 Claude Desktop 怎么接入

- **Custom Connector 连不上本机服务。**
  - 原文："Claude connects to your remote MCP server from Anthropic's cloud infrastructure, rather than from your local device. This is true across every Claude client"，服务器必须能从公网访问。
  - 来源：https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp 。这是 Anthropic 帮助中心，不在白名单里，但 code.claude.com/docs/en/desktop 直接链接了这篇。
- **本机服务要走 `claude_desktop_config.json`。**
  - 路径：`~/Library/Application Support/Claude/claude_desktop_config.json`；入口：Settings > Developer > Edit Config。
  - 官方示例只有 stdio 写法（`command` / `args` / `env`）。
  - 来源：https://modelcontextprotocol.io/docs/develop/connect-local-servers （会重定向到 /docs/2026-07-28/...）。
  - 帮助中心说，这种本地服务器在 Cowork 和 claude.ai 里不可用。
- **也可以做成 MCPB 包（`.mcpb`）。**
  - 它是一个 zip，里面是 local MCP server 加 `manifest.json`；`server.type` 取 node / python / binary。
  - 说它是 stdio 属于推断。
  - 来源：https://github.com/modelcontextprotocol/mcpb
- **Desktop 的 Code 标签页能直接用 HTTP。**
  - 它读取 `~/.claude.json` 和 `.mcp.json`，同时加载 `claude_desktop_config.json`。
  - 同名冲突时，用 `claude_desktop_config.json` 的定义。
  - 独立运行的 CLI 不读 `claude_desktop_config.json`，可以用 `claude mcp add-from-claude-desktop` 导入（仅 macOS/WSL）。
  - 来源：https://code.claude.com/docs/en/desktop
- **结论（推断）**：Desktop 的聊天界面要接本平台，需要一个 stdio 桥接小服务器（或 MCPB 包），由它去调用 `127.0.0.1:8787`。

---

### 2) Node.js 自带的 `node:sqlite`

#### 2.1 官方状态

来源：https://nodejs.org/docs/latest-v25.x/api/sqlite.html ；https://nodejs.org/docs/latest-v25.x/api/documentation.html

- 当前标记是 **Stability: 1.2 - Release candidate**。
- 变更历史：
  - v22.5.0：加入。
  - v22.13.0 / v23.4.0：不再需要 `--experimental-sqlite` flag，但仍属实验性。
  - v25.7.0（v24 线是 v24.15.0）：变成 release candidate，PR #61262。
  - v25.7.0 发布说明里写的是 "sqlite: mark as release candidate"，见 https://nodejs.org/en/blog/release/v25.7.0 。
- PR #61262 同时**删掉了 ExperimentalWarning**：删除了 `lib/sqlite.js` 里的 `emitExperimentalWarning('SQLite')`。所以 v25.7.0+ / v24.15.0+ 不再打印警告。来源：https://github.com/nodejs/node/pull/61262 （nodejs 官方仓库，但不在白名单里）。
- Stability 1 的原文要点：
  - "not subject to semantic versioning"；
  - "**Use of the feature is not recommended in production environments**"；
  - 1.2 的说明是 "No further breaking changes are anticipated but may still occur"。

#### 2.2 API 要点

- **只有同步 API**："All APIs exposed by this class execute synchronously"。会阻塞事件循环属于推断。
- 只能通过 `node:` 前缀引入。
- **构造函数** `new DatabaseSync(path, options)` 的选项：
  - `open`、`readOnly`；
  - `enableForeignKeyConstraints=true`；
  - `enableDoubleQuotedStringLiterals=false`；
  - `allowExtension=false`；
  - `timeout=0`；
  - `readBigInts`、`returnArrays`；
  - `allowBareNamedParameters=true`；
  - `allowUnknownNamedParameters=false`；
  - `defensive`：v25.1.0 加入，v25.5.0 起默认 true；
  - `limits`。
- **数据库方法与属性**：
  - 运行时限制属性 `database.limits` 标注为 v25.8.0；构造函数的 `limits` 选项没单独标版本。
  - 执行与语句：`exec`、`prepare`、`createTagStore`（LRU 语句缓存，默认 1000 条，v24.9.0 加入）。
  - 连接：`open`、`close`。
  - 自定义函数：`function`、`aggregate`。
  - 扩展与安全：`enableLoadExtension`、`loadExtension`、`enableDefensive`、`setAuthorizer`。
  - 变更集：`createSession`、`applyChangeset`。
  - 状态：`location()`、`isOpen`、`isTransaction`、`Symbol.dispose`。
- **`StatementSync`**：
  - `run()` 返回 `{changes, lastInsertRowid}`；
  - 还有 `get`、`all`、`iterate`、`columns`、`sourceSQL`、`expandedSQL`、`setReadBigInts`、`setReturnArrays`、`setAllowBareNamedParameters`、`setAllowUnknownNamedParameters`。
- `sqlite.backup()` 返回 Promise（异步）。

#### 2.3 本机实测

只读命令，只用内存库。

- 导出 `DatabaseSync`、`StatementSync`、`Session`、`constants`、`backup`。
- 建表、插入、查询正常，退出码 0。
- stderr 为空，没有 ExperimentalWarning。
- `process.versions.sqlite` = 3.53.0，`select sqlite_version()` = 3.53.4，两者不一致。
- `createTagStore`、`setAuthorizer`、`Symbol.dispose`、`limits`、`enableDefensive` 都存在。

#### 2.4 需要注意：Node 25 已经 EOL

- nodejs.org 的 previous-releases 里，v25 的状态是 `"EOL"`，最后一个版本是 25.9.0（2026-03-31）。
- 目前 v26.11.0 是 Current（2026-10-07），v24.21.0 是 LTS（Krypton）。
- 来源：https://nodejs.org/en/about/previous-releases
- 补充（来源 github.com/nodejs/Release 的 schedule.json，不在白名单里）：
  - v24 将在 2026-10-20 进入 maintenance；
  - v26 将在 2026-10-28 成为 LTS。
- 建议把运行时对齐到 24 LTS 或 26。

#### 2.5 备选：better-sqlite3

来源：npm registry 只读查询，https://www.npmjs.com/package/better-sqlite3

- 最新版 13.0.3（2026-08-05），MIT，`engines.node >=22`，依赖只有 `node-addon-api ^8.0.0`。
- `binding.gyp` 里定义了 `NAPI_VERSION=10`，说明它基于 Node-API。
- tarball 里自带 8 个平台的预编译二进制：
  - `prebuilds/darwin-arm64.node`、`darwin-x64`；
  - `linux-arm64`、`linux-x64`；
  - `linuxmusl-arm64`、`linuxmusl-x64`；
  - `win32-arm64`、`win32-x64`。
- `gypfile:false`，没有 install 脚本，安装时不编译。
- `lib/binding.js` 优先加载预编译文件。
- README 原话："Requires a currently supported Node.js version"。Node 25 已经 EOL，严格来说不在它的支持范围内。
- 本机 napi=10，按理能加载 darwin-arm64 预编译文件（推断，因为禁止安装，没有实测）。
- 它提供 `transaction()` 帮助函数，`node:sqlite` 没有对应的函数。

---

### gaps（仍未解决）

- **`resource_link`**：Claude Code 文档没写 tool result 里的 `resource_link` 怎么处理。
- **`structuredContent` / `outputSchema`**：Claude Code 文档没写这两者是否传给模型、怎么展示。
- **图片结果超过 `MAX_MCP_OUTPUT_TOKENS` 时怎么办**：文档只写了"没有图片"的结果会存文件。
- **`progressToken`**：Claude Code 是否一定在 `tools/call` 里带 `progressToken` 没有明文。progress 在前台调用时怎么在 UI 上展示也没写。
- **`claude_desktop_config.json` 能否直接写 `type:http` / `url`**：没有官方说明。只有 3P 部署的 `managedMcpServers` 写明支持 `"http"`。
- **凭据变量名单**：被读成空串的名单是固定的还是按模式匹配没有说明。`ARK_MCP_TOKEN` 这类以 `_TOKEN` 结尾的名字是否安全没有实测。`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 会不会清掉 stdio 服务器配置里的 `env`，也没有说明。
- **本机 2.1.220 实际协商结果**：用的是哪个运行时、协商出哪个协议版本，没有实测。
- **`requiresUserInteraction` 版本要求**：这个注解本身是否有最低版本要求，文档没写（v2.1.214 只对应 Remote Control 不提供一键批准那一条）。
- **SQLite 版本号不一致**：`process.versions.sqlite`（3.53.0）和 `sqlite_version()`（3.53.4）为什么不一样，没有官方解释。
- **better-sqlite3 实际加载**：13.0.3 在 Node 25.9.0 上能否实际加载没有验证（禁止安装）。
- **来源白名单**：support.claude.com、github.com/nodejs 这两处来源不在任务给定的白名单里。

## corrections
[
 {
  "claim": "inputSchema 约束：属性名必须 1–64 个字符，只能用 [A-Za-z0-9_.-]",
  "problem": "范围说大了。官方只限制顶层属性名，没有限制所有属性名。",
  "correct_fact": "原文是 \"Top-level property names must be 1 to 64 characters long and use only ASCII letters and digits, `_`, `.`, and `-`\"。嵌套属性不在这条检查范围内。",
  "source_url": "https://code.claude.com/docs/en/mcp#tools-with-invalid-input-schemas"
 },
 {
  "claim": "inputSchema 必须是合法的 draft 2020-12 schema，否则这个工具会被剔除",
  "problem": "夸大且不完整。剔除行为要靠 feature flag 开启，而且只检查没声明 $schema 或声明了 draft 2020-12 的 schema。",
  "correct_fact": "Claude Code 通过拉取的 feature flag 开启剔除。flag 拉取关闭或 flag 从没到达时，只在日志里记录，schema 照常发给 API，整个请求会 400 失败（错误里按位置点名这个工具）。声明了其他 dialect 的 schema 跳过元 schema 校验，但仍做顶层属性名检查。v2.1.216 之前没有任何部署做这些检查。",
  "source_url": "https://code.claude.com/docs/en/mcp#tools-with-invalid-input-schemas"
 },
 {
  "claim": "根层级的 anyOf/oneOf/allOf 会被压平",
  "problem": "不完整。压平依赖远程配置；没有这份配置或压不了时，这个工具会被跳过。anyOf/oneOf 分支的 required 只写进描述，schema 不强制。",
  "correct_fact": "allOf：合并属性，各分支 required 照样生效。anyOf/oneOf：合并属性，各分支 required 只在工具描述里说明，schema 不强制。没收到启用改写的远程配置，或改写不出 API 能接受的 schema 时，跳过这个工具。服务端要自己校验参数组合。",
  "source_url": "https://code.claude.com/docs/en/mcp#tool-input-schemas-with-a-root-level-combinator"
 },
 {
  "claim": "_meta[\"anthropic/requiresUserInteraction\"]: true 让每次调用都必须有人确认，bypassPermissions/auto 下也一样，allow 规则也跳不过",
  "problem": "列举不全，\"必须有人确认\"在 Agent SDK 下不成立。",
  "correct_fact": "acceptEdits、auto、bypassPermissions 下都会弹窗，也不提供\"don't ask again\"。dontAsk 模式直接拒绝。非交互模式下 --permission-prompt-tool 返回的 allow 会被改成 deny。Agent SDK 的 canUseTool 回调能收到这类调用并可以批准。值必须是 JSON 布尔 true，其他值一律忽略。",
  "source_url": "https://code.claude.com/docs/en/mcp#require-approval-for-a-specific-tool"
 },
 {
  "claim": "平台 token 应该用自定义变量名，例如 ARK_MCP_TOKEN（会正常展开）",
  "problem": "这是没经过验证的推断，而且有风险。被读成空串的名单里有 NPM_TOKEN，文档没说这个名单是固定的还是按名字模式匹配，以 _TOKEN 结尾的名字可能也会被读成空。",
  "correct_fact": "文档只举了例子（ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN、AWS_BEARER_TOKEN_BEDROCK、HTTPS_PROXY、NPM_TOKEN），并说 API_KEY 照常展开。可以这样验证：运行 `claude --debug-file <scratch路径>`，在日志里搜 `never expanded toward a remote server`。另外，项目 .mcp.json 里的 headersHelper 运行时，会去掉名字里带 TOKEN/SECRET/PASSWORD/KEY/AUTH 的环境变量，所以 helper 不能从环境变量里读 ARK_MCP_TOKEN。",
  "source_url": "https://code.claude.com/docs/en/mcp#credential-variables-that-read-as-empty"
 },
 {
  "claim": "文本超过 50,000 字符就存文件；isError 文本超过约 11,000 字符只保留首尾各 5,000",
  "problem": "漏了适用范围：这两条只对在前台完成的调用生效。",
  "correct_fact": "原文：\"Two more limits apply to a call that completes in the foreground\"。已经转成后台任务的调用，结果通过 task notification 返回。",
  "source_url": "https://code.claude.com/docs/en/mcp#mcp-output-limits-and-warnings"
 },
 {
  "claim": "v2 运行时在拉取 feature flag 的会话里从 v2.1.232 起使用；本机 2.1.220 应该走 v1，所以服务端要兼容旧的协议版本",
  "problem": "不完整，也没说清旧版本具体是哪个。",
  "correct_fact": "不拉 feature flag 的会话（Bedrock/Vertex/Foundry、关闭遥测等）从 v2.1.274 起默认用 v2。可以用 MCP_SDK_GENERATION=v1|v2 指定运行时，用 MCP_PROTOCOL_NEGOTIATION（v2.1.221+）控制是否探测协议版本。v1 基于 TS SDK 1.x，npm 上 @modelcontextprotocol/sdk 1.32.1 的 LATEST_PROTOCOL_VERSION 是 2025-11-25，SUPPORTED 还包括 2025-06-18、2025-03-26、2024-11-05、2024-10-07。所以服务端至少要能处理 2025-11-25 及更早的 initialize 握手。npm 上 Claude Code 最新版是 2.1.292，本机落后。",
  "source_url": "https://code.claude.com/docs/en/mcp#mcp-client-runtimes"
 },
 {
  "claim": "node:sqlite 从哪个版本起不再打印 ExperimentalWarning，官方没有明文（gap）",
  "problem": "可以查到：v25.7.0 / v24.15.0 那个 PR 本身就删掉了警告。",
  "correct_fact": "PR #61262 的描述是 \"Mark the SQLite module as release candidate and remove the experimental warning\"，diff 删除了 lib/sqlite.js 里的 emitExperimentalWarning('SQLite')。所以 v25.7.0 起（v24 线是 v24.15.0 起）不再打印警告，和本机 v25.9.0 实测一致。来源是 GitHub 上 nodejs 官方仓库，不在白名单里。",
  "source_url": "https://github.com/nodejs/node/pull/61262"
 },
 {
  "claim": "Stability 1.2 的描述（只引用了 not subject to semantic versioning、No further breaking changes are anticipated）",
  "problem": "漏了 Stability 1 里和生产使用直接相关的一句。",
  "correct_fact": "Stability 1 原文还有：\"Use of the feature is not recommended in production environments\"，并且 \"Experimental features leave the experimental status typically either by graduating to stable, or are removed without a deprecation cycle\"。",
  "source_url": "https://nodejs.org/docs/latest-v25.x/api/documentation.html"
 },
 {
  "claim": "limits 选项从 v25.8.0 起可用",
  "problem": "说得太确定。文档只给 database.limits 属性标了 added: v25.8.0，构造函数的 limits 选项在 changes 里没有单独标版本。",
  "correct_fact": "database.limits（运行时读写）标注为 v25.8.0。构造函数的 options.limits 有文档但没标版本（推断和前者同时加入）。构造函数选项还有报告没列的 enableDoubleQuotedStringLiterals 和 allowExtension，方法还有 enableLoadExtension 和 enableDefensive。",
  "source_url": "https://nodejs.org/docs/latest-v25.x/api/sqlite.html"
 },
 {
  "claim": "Desktop 的 Code 标签页会读取 ~/.claude.json、.mcp.json，同时加载 claude_desktop_config.json",
  "problem": "漏了冲突时的优先级，也漏了适用范围。",
  "correct_fact": "同名服务器同时出现在 claude_desktop_config.json 和 ~/.claude.json/.mcp.json 里时，Code 标签页用 claude_desktop_config.json 的定义。独立运行的 CLI 不读 claude_desktop_config.json，可以用 `claude mcp add-from-claude-desktop` 导入（仅 macOS/WSL）。帮助中心说 claude_desktop_config.json 里的本地服务器在 Cowork 和 claude.ai 里不可用。",
  "source_url": "https://code.claude.com/docs/en/desktop"
 },
 {
  "claim": "MCPB 本质是 stdio 服务器加一个 manifest.json",
  "problem": "\"stdio\"是推断。官方原文写的是 local MCP server，server.type 是 node/python/binary。",
  "correct_fact": "原文：\"zip archives containing a local MCP server and a `manifest.json`\"，manifest 里 server.type 取 \"node\"、\"python\" 或 \"binary\"，由 mcp_config.command 启动。",
  "source_url": "https://github.com/modelcontextprotocol/mcpb"
 },
 {
  "claim": "权限规则写法是 mcp__<server>__<tool>，也可以用 mcp__ark__*",
  "problem": "不完整。",
  "correct_fact": "mcp__ark（不带工具名）也能匹配这个服务器的全部工具。allow 规则里没有锚定的 \"mcp__*\" 会被跳过并给出警告。settings 文件里带括号的 mcp__ 规则会被跳过。",
  "source_url": "https://code.claude.com/docs/en/permissions"
 },
 {
  "claim": "（遗漏）工具描述与 server instructions 的长度限制",
  "problem": "报告没提，这会直接影响服务端怎么写描述。",
  "correct_fact": "每个工具描述和每个服务器的 instructions 默认在 2,048 字符处截断。CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH 可以调整，但要求 v2.1.280+，本机 2.1.220 用不了。",
  "source_url": "https://code.claude.com/docs/en/mcp#for-mcp-server-authors"
 },
 {
  "claim": "自动转后台：主会话调用超过 2 分钟转后台任务（v2.1.212+）",
  "problem": "漏了例外情况。",
  "correct_fact": "子代理的调用、IDE 服务器、非交互模式（-p，除非设了 CLAUDE_AUTO_BACKGROUND_TASKS=1）都不会转后台。elicitation 对话框开着时也推迟转后台。per-server timeout ≥1000 还会作为空闲超时的下限（v2.1.203+）。CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT 不能超过实际生效的 MCP_TOOL_TIMEOUT。",
  "source_url": "https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls"
 },
 {
  "claim": "prompts 会变成 /server:prompt 命令",
  "problem": "格式说得不准。",
  "correct_fact": "菜单里显示为 `/servername:promptname (MCP)`，输入 `/mcp__servername__promptname` 也能运行，参数按空白切分。",
  "source_url": "https://code.claude.com/docs/en/mcp#use-mcp-prompts-as-commands"
 }
]

## gaps
- Claude Code 官方文档完全没提到 tool result 里 `resource_link` 怎么处理（会不会自动读取、怎么展示），只确认了 resources 可以用 @ 引用，以及它会自动提供列出/读取资源的工具
- progress 通知在前台调用时（不在 /tasks 后台任务里）的 UI 展示方式，文档没写
- `claude_desktop_config.json` 能不能直接写 `type:http` / `url` 条目：modelcontextprotocol.io 和帮助中心都只给了 stdio 示例，没有明确说明
- Claude Desktop 的说法引用了 support.claude.com（Anthropic 官方帮助中心），但它不在任务给定的来源白名单里
- 凭据变量读成空串的完整名单：文档只举了例子（ANTHROPIC_API_KEY、NPM_TOKEN、HTTPS_PROXY 等），并说 `API_KEY` 会正常展开；ARK_MCP_TOKEN 这样的自定义名会不会正常展开，是按文档推断的，没有实测
- 本机 Claude Code 2.1.220 低于 v2.1.232（v2 运行时 / 2026-07-28 协议版本）、v2.1.265（自动退回 SSE）、v2.1.283（MCP 图片存成文件），实际会走哪个运行时、协商出哪个协议版本，没有实测（不允许运行可能联网或改配置的 claude mcp 命令）
- node:sqlite 从哪个版本起不再打印 ExperimentalWarning，官方文档没有明文写；只实测到 v25.9.0 不打印
- process.versions.sqlite（3.53.0）和 sqlite_version()（3.53.4）为什么不一致，没有查到官方解释
- better-sqlite3 13.0.3 在 Node 25.9.0 上能否实际加载没有验证（禁止安装）；npm 页面上没有写明 Node 25 的支持情况，README 只要求使用仍受支持的 Node 版本，而 Node 25 已经 EOL