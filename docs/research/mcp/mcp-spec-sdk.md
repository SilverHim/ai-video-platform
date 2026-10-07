## MCP 规范与 TypeScript SDK 调研报告（核查修正版，截至 2026-10-08，只读）

说明：以下每条都回到官方原文核过。标注 **[修正]** 的是对原报告的更正，**[补充]** 是原报告没写、但与本平台设计直接相关的官方事实，**[推断]** 不是官方原文。

---

### 0. 结论速览

- **规范版本**：当前版本是 **2026-07-28**，上一版是 2025-11-25。这一版取消了 `initialize` 握手和 `Mcp-Session-Id` 会话，协议改为无状态。其他主要变化：
  - 新增 `server/discover`，服务器 MUST 实现。
  - 服务器向客户端发起的请求改为 MRTR 模式（`InputRequiredResult`）。
  - Tasks 移出核心协议，改为扩展 `io.modelcontextprotocol/tasks`。
  - 来源：https://modelcontextprotocol.io/specification/versioning ，https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **TS SDK 有两条线**：
  - v2：`@modelcontextprotocol/server` 2.3.1（2026-10-05 发布），Apache-2.0，Node >=20，依赖 zod ^4.2.0，实现 2026-07-28。
  - v1：`@modelcontextprotocol/sdk` 1.32.1，MIT，Node >=18，只实现到 2025-11-25。
  - 来源：`npm view`；https://github.com/modelcontextprotocol/typescript-sdk
- **接 Hono**：首选 MCP 官方的 `@modelcontextprotocol/hono` 2.0.2，配合 `createMcpHandler`。hono 第三方中间件 `@hono/mcp` 0.3.2 基于 v1 SDK，是 2025 代的 Streamable HTTP。
- **本机 Claude Code**：PATH 上的 `claude --version` 是 **2.1.220**，低于默认启用 v2 运行时的版本（会拉取 feature flag 的会话需 v2.1.232+，其余需 v2.1.274+）。所以它默认很可能用 v1 运行时，走 2025 代握手。
  - **[修正]** `createMcpHandler` 默认 `legacy: 'stateless'`，能无会话地处理旧客户端的 `initialize` 和普通调用。但旧客户端的取消（单独 POST `notifications/cancelled`）和 elicitation（legacy shim）在无状态 HTTP 下是否生效，官方没有说明。所以只能说“基本调用已覆盖”。

---

### 1. 规范版本、关键变化、传输方式

**版本与协商**（来源：https://modelcontextprotocol.io/specification/versioning ）
- 原文："The **current** protocol version is **2026-07-28**"。
- 版本号格式为 `YYYY-MM-DD`，表示最后一次出现不向后兼容改动的日期。
- 每个请求都在 `_meta` 的 `io.modelcontextprotocol/protocolVersion` 中声明版本，服务器逐个请求决定接受或拒绝。
- 版本不支持时返回 `UnsupportedProtocolVersionError`，错误码 -32022（来源：changelog 次要变化第 12 条）。

**相对 2025-11-25 的主要变化**（来源：https://modelcontextprotocol.io/specification/2026-07-28/changelog ，已逐条核对）
1. 删除协议层会话和 `Mcp-Session-Id`（SEP-2567）。需要跨调用保存状态时，由服务器生成显式 handle，作为普通工具参数传回。
2. 删除 `initialize` / `notifications/initialized`（SEP-2575）。每个请求的 `_meta` 都带 `protocolVersion` 和 `clientCapabilities`。客户端 SHOULD 带 `clientInfo`；服务器 SHOULD 在每个结果的 `_meta` 里带 `serverInfo`。
3. 新增 `server/discover`，服务器 MUST 实现。
4. 删除 HTTP GET 端点和 `resources/subscribe`，改用 `subscriptions/listen`。`notifications/progress` 仍然走它所属请求的响应流。
5. 删除 `ping`、`logging/setLevel`、`notifications/roots/list_changed`。日志级别改为每个请求在 `_meta` 的 `io.modelcontextprotocol/logLevel` 中设置。
6. Tasks 改为扩展（SEP-2663）：用 `tasks/get` 轮询，新增 `tasks/update`，删除 `tasks/list`。
7. 引入 MRTR（SEP-2322）：服务器返回 `InputRequiredResult`（`resultType: "input_required"`），客户端带上 `inputResponses` 重试原请求。
8. 所有结果都必须带 `resultType`。
9. 删除 `Last-Event-ID` 断点续传，流断了要用新的请求 ID 重发。

**次要变化**
- `inputSchema` / `outputSchema` 可以使用任意 JSON Schema 2020-12 关键字，`structuredContent` 可以是任意 JSON 值（SEP-2106）。
- **[修正]** Streamable HTTP 的 POST 一律必须带 `Mcp-Method`；`Mcp-Name` 只在 `tools/call`、`resources/read`、`prompts/get` 上必须带。另外新增 `x-mcp-header`（SEP-2243）。
- `tools/list`、`prompts/list`、`resources/list`、`resources/read`、`resources/templates/list` 的结果必须带 `ttlMs` / `cacheScope`。
- 删除 `notifications/elicitation/complete`。

**弃用项**
- Roots、Sampling、Logging 弃用（SEP-2577）。
- HTTP+SSE 旧传输正式标为 Deprecated（SEP-2596）。
- DCR 弃用，改推 Client ID Metadata Documents。

**传输方式**
- **stdio**（来源：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio ）
  - 消息按换行分隔，MUST NOT 内嵌换行。
  - 原文："MUST NOT write anything to its `stdout` that is not a valid MCP message"。
  - 取消请求时，客户端 MUST 发送 `notifications/cancelled`。
  - stdin 收到 EOF 时，服务器 SHOULD 尽快退出。
  - 同时支持新旧两代的客户端 SHOULD 先用 `server/discover` 探测。
- **Streamable HTTP**（来源：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http ）
  - 只有一个 POST 端点，每个 JSON-RPC 消息一个 POST。
  - 服务器可以按请求选择回 `application/json` 或 `text/event-stream`；客户端的 `Accept` MUST 同时列出两者。
  - 只支持本版的服务器收到旧流量时 SHOULD 这样处理：GET/DELETE 回 405；忽略 `Mcp-Session-Id`；忽略 `Last-Event-ID`。
- **HTTP+SSE（2024-11-05）**：自 2025-03-26 起已弃用，现在正式列为 Deprecated。原文："New implementations **SHOULD NOT** adopt it"。

---

### 2. Streamable HTTP 的安全、会话、无状态与授权

**安全要求原文**（来源：Streamable HTTP 规范页，已逐字核对）
1. "Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks. If the `Origin` header is present and invalid, servers **MUST** respond with HTTP 403 Forbidden."
2. "When running locally, servers **SHOULD** bind only to localhost (127.0.0.1) rather than all network interfaces (0.0.0.0)."
3. "Servers **SHOULD** implement proper authentication for all connections."

**请求头**
- 每个 POST MUST 带 `MCP-Protocol-Version`，值 MUST 与 body 中 `_meta` 的版本一致，否则回 400 加 `HeaderMismatch`（-32020）。
- 规范允许支持 2025-06-18 之前客户端的服务器，把不带这个头的请求当作 2025-03-26 处理（MAY）。

**取消**："Closing the SSE response stream **MUST** be treated by the server as cancellation of that request"。这种情况下不需要 `notifications/cancelled`。

**会话与无状态**
- 2026-07-28 没有会话。只有 2025-03-26 到 2025-11-25 有 `Mcp-Session-Id`，用 DELETE 结束会话。
- SDK 原文："`createMcpHandler` builds a fresh server instance from your factory for every HTTP request and holds nothing between requests, so a v2 server is stateless and scales horizontally by default"。来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/sessions-state-scaling.md
- **[推断]** 无状态模式完全可行，也是协议本身的设计方向。

**Stateful Tools**（来源：https://modelcontextprotocol.io/specification/2026-07-28/server/tools ）
- **[修正]** 这一节原文标明是 **non-normative**（非规范性）。
- 对**已认证**的服务器，handle 只是名字，每次调用都要校验调用者对这个 handle 的授权。
- 对**未认证**的服务器，handle 就等于 bearer token，应当足够高熵（例如 UUIDv4），并设定有限寿命。
- handle 要不透明；保留策略写进创建工具的描述里；handle 过期或未知时，返回工具执行错误。
- 安全最佳实践原文："MCP servers **MUST NOT** treat possession of a state handle as authentication"；并且 SHOULD 在服务端把 handle 绑定到已认证用户（例如以 `<user_id>:<handle>` 作为键）。来源：https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices

**Authorization（OAuth）**（来源：https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization ）
- 原文："Authorization is **OPTIONAL** for MCP implementations."
- 实现授权时：HTTP 传输 SHOULD 遵循本规范；STDIO 传输 SHOULD NOT 遵循，而应从环境变量获取凭证。
- 一旦实现，服务器 MUST 实现 RFC9728 Protected Resource Metadata、MUST 校验 token 的 audience，token 无效或过期时 MUST 回 401。
- 规范没有为 localhost 单独规定 OAuth 豁免。
- **[修正]** "Binding to 127.0.0.1 is not an authentication boundary: such components need real authentication and origin validation" 这句出自**文档教程** Local Server Security，不是规范条文。来源：https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security
- 安全最佳实践原文："MCP servers intending for their servers to be run locally **SHOULD** … Use the `stdio` transport…; Restrict access if using an HTTP transport, such as: Require an authorization token; Use unix domain sockets…"
- **[推断]** 本机 HTTP 服务器不强制实现 OAuth，但至少应加授权 token，或者改用 stdio。

---

### 3. 工具定义与相关原语

**Tool 字段**（来源：tools 规范页，以及 https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts ）
- 字段：`name`、`title`、`description?`、`icons`、`inputSchema`、`outputSchema?`、`annotations?`、`_meta?`。
- schema.ts 原文："`type: \"object\"` is required at the root"，默认按 JSON Schema 2020-12 解释。
- 没有参数时推荐 `{ "type": "object", "additionalProperties": false }`。
- 工具名 SHOULD 为 1–128 个字符，只用 `A-Za-z0-9_-.`。
- `tools/list` SHOULD 按确定顺序返回。

**outputSchema / structuredContent**
- "Servers **MUST** provide structured results that conform to this schema. Clients **SHOULD** validate"。
- 为了向后兼容，SHOULD 同时在 TextContent 中放一份序列化后的 JSON。

**ToolAnnotations 默认值**（schema.ts 原文）
- `readOnlyHint`：默认 false。
- `destructiveHint`：默认 true，仅在 `readOnlyHint == false` 时有意义。
- `idempotentHint`：默认 false，仅在 `readOnlyHint == false` 时有意义。
- `openWorldHint`：默认 true。
- 规范原文："clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers"。

**返回内容类型**
- `text`
- `image`（`data` 为 base64，带 `mimeType`）
- `audio`
- `resource_link`
- `resource`（嵌入资源）
- 以上都支持 `annotations`（audience / priority / lastModified）。

**错误**
- 未知工具等协议错误走 JSON-RPC error，示例错误码为 -32602。
- 业务和输入错误用 `isError: true`。

**安全**
- 服务器 MUST：校验输入、做访问控制、对调用限流、清洗输出。
- 客户端 SHOULD：对敏感操作弹出确认。

**进度**（来源：https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress ）
- 客户端在 `_meta.progressToken` 中提供 token，值为 string 或 integer，在所有进行中的请求里必须唯一。
- 服务器 MAY 发送 `notifications/progress`，字段为 `progressToken`、`progress`、`total?`、`message?`。
- `progress` MUST 单调递增；操作完成后 MUST 停止发送。
- 进度通知只能引用当前进行中请求所提供的 token。

**取消**（来源：https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation ）
- HTTP 上关闭响应流即为取消。
- stdio 上发送 `notifications/cancelled`，参数为 `requestId`、`reason?`。
- 服务器 SHOULD 停止处理；无法取消时 MAY 忽略。
- 双方 MUST 能正确处理竞态。

**Tasks 扩展**（来源：https://modelcontextprotocol.io/extensions/tasks/overview ，https://github.com/modelcontextprotocol/ext-tasks ）
- 扩展标识 `io.modelcontextprotocol/tasks`，其 2026-07-28 schema 标为 Stable。
- 返回 `CreateTaskResult`（`resultType: "task"`），包含 `taskId`、状态、`ttlMs`、`pollIntervalMs`。
- 状态值：`working`、`input_required`、`completed`、`failed`、`cancelled`。
- 方法：`tasks/get`、`tasks/update`、`tasks/cancel`（协作式取消）。
- ext 规范原文："A server **MUST NOT** return `CreateTaskResult` to a client that did not include the extension capability on its request"。
- **[修正] 支持现状**：
  - TS 包 `@modelcontextprotocol/ext-tasks` 0.2.2 只 peer 依赖 `@modelcontextprotocol/client` ^2.0.0。
  - 它的 `/receiver` 是 "2025-11-25 Tasks sampling and elicitation receiver"，挂在 Client 上，是**客户端**组件。
  - 所以目前**没有**官方 TS 服务端实现能让 v2 McpServer 返回 task。
  - SDK v2 已删除实验性的 `registerToolTask` 等 API。来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md
  - 官方扩展支持矩阵中没有 Tasks 列，也没有 Claude Code 行；只有 Claude (web) 和 Claude Desktop 两行，且只标了 MCP Apps。来源：https://modelcontextprotocol.io/extensions/client-matrix

**Elicitation**（来源：https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation ，https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr ）
- 下发方式：在 `InputRequiredResult.inputRequests` 中放入 `elicitation/create`。
- 客户端在每个请求的 `_meta.io.modelcontextprotocol/clientCapabilities` 中声明 `elicitation: { form: {}, url: {} }`。
- form 模式只能是扁平对象，属性为原始类型或枚举（含多选枚举数组）。
- 原文："Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials"。
- 响应动作为 `accept` / `decline` / `cancel`。
- **requestState 的规范要求**：
  - MUST 把它视为攻击者可控的输入。
  - 如果它影响授权、资源访问或业务逻辑，MUST 做完整性保护（例如 HMAC 或 AEAD），并 MUST 拒绝校验失败的状态。
  - SHOULD 在其中绑定主体、短 TTL 和原请求摘要。
  - **[补充]** 原文："Servers for which a given `requestState` must be consumed at most once (e.g., one-time redemptions) **MUST** enforce that invariant server-side"。
- 重试时 JSON-RPC `id` MUST 与原请求不同。
- Elicitation 本身**没有**被弃用（被弃用的是 Roots、Sampling、Logging）。
- Claude Code 原文："On connections that use protocol revision 2026-07-28, Claude Code declares `elicitation: {form: {}, url: {}}`"。来源：https://code.claude.com/docs/en/mcp

---

### 4. 官方 TypeScript SDK、Hono 集成与 stdio

**npm 包**（`npm view` 实测）

| 包 | 最新版 | 许可 | Node | 依赖 / peer |
|---|---|---|---|---|
| `@modelcontextprotocol/server` | 2.3.1（2026-10-05） | Apache-2.0 | >=20 | 依赖 zod ^4.2.0、@modelcontextprotocol/core 2.3.1 |
| `@modelcontextprotocol/hono` | 2.0.2（2026-10-02） | Apache-2.0 | >=20 | peer hono ^4.11.4、server ^2.3.0 |
| `@modelcontextprotocol/node` | 2.1.1 | Apache-2.0 | >=20 | 依赖 hono ^4.11.4、@hono/node-server ^1.19.9 |
| `@modelcontextprotocol/sdk`（v1） | 1.32.1 | MIT | >=18 | peer zod ^3.25 \|\| ^4.0 |
| `@hono/mcp` | 0.3.2 | MIT | 未声明 | peer @modelcontextprotocol/sdk ^1.29.0、hono *、hono-rate-limiter ^0.5.3、zod |
| `@modelcontextprotocol/ext-tasks` | 0.2.2 | Apache-2.0 | 未声明 | peer @modelcontextprotocol/client ^2.0.0 |

- v2 README 原文："v2 of the SDK … the stable release line, implementing the 2026-07-28 MCP spec"。
- v1.x README 原文："implements the MCP spec up to 2025-11-25. Support for the 2026-07-28 spec is not planned for v1.x"。v1.x 在 v2 发布（2026-07-27）后至少还有六个月的修复。
- **[修正] zod 要求**（来源：upgrade-to-v2.md）：
  - v2 要求 Node 20+。原文："Zod v3 is no longer supported"。
  - 推荐用 Zod ≥4.2.0 编写 schema；4.0–4.1 也能用，但会退回内置转换并打印一次警告。
  - 也可以用 Valibot、ArkType 等 Standard Schema 库。
  - 项目整体锁在 zod@3 时，v2 包会装自己的嵌套 zod@4；可以用 `"zod-v4": "npm:zod@^4.2.0"` 别名，只给 MCP 相关代码使用。
- 本机 Node 是 v25.9.0，用 `node -e` 实测 `Request`、`Response`、`ReadableStream`、`AbortSignal.any`、`crypto.randomUUID`、`crypto.subtle` 均可用。

**McpServer / registerTool（v2）**（来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md ，源码 packages/server/src/server/mcp.ts）
- **[修正]** 签名：`registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, icons?, scopeChallenge?, _meta? }, cb)`。
- SDK 会从 schema 生成 JSON Schema、校验入参，参数不合法时返回 `isError: true`；同时校验 `structuredContent` 是否符合 `outputSchema`。
- SDK 原文："Annotations never change how the SDK runs the tool"。
- `new McpServer(info, { maxToolInputElements })` 默认关闭。
- 请求体默认上限 `maxRequestBodySize` 为 4 MiB，超出回 413。
- 进度：在 `ctx.mcpReq._meta?.progressToken` 存在时，调用 `ctx.mcpReq.notify({ method: 'notifications/progress', … })`。
- 取消：`ctx.mcpReq.signal` 在收到 `notifications/cancelled` 或连接关闭时 abort，可以直接传给 `fetch`。
- 来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/logging-progress-cancellation.md

**确认流程**（来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md ）
- 首轮返回 `inputRequired({ inputRequests: { confirm: inputRequired.elicit({...}) } })`，下一轮用 `acceptedContent(ctx.mcpReq.inputResponses, 'confirm', schema)` 读取结果。
- `ctx.mcpReq.elicitInput` 在 2026 版请求上会抛错。
- **[补充]** `createRequestStateCodec`：HMAC-SHA256，密钥至少 32 字节，可设 `ttlSeconds`。通过 `new McpServer(info, { requestState: { verify } })` 接入，被篡改或过期的状态回 `-32602`。它只签名、不加密。
- legacy shim 原文："On a connection that predates 2026-07-28, the SDK's legacy shim — on by default — fulfils an `input_required` return by pushing real `elicitation/create`…"

**挂到 Hono**（来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/hono.md ，https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md ）
```ts
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
const handler = createMcpHandler(() => { const s = new McpServer({ name, version }); /* s.registerTool(...) */ return s; });
const app = createMcpHonoApp();
app.all('/mcp', (c: Context) => handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }));
```
- **factory**：每个请求运行一次，要求轻量、无副作用；连接池放在模块作用域。factory 会收到 `era`、`authInfo`、`requestInfo`。
- **[补充]** factory 必须每次 new 一个新的 McpServer。按 hono 2.0.2 的 CHANGELOG，`createMcpHandler(() => server)` 共用一个实例时，并发请求会回 500（-32603）。来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/middleware/hono/CHANGELOG.md
- **返回值**：`{ fetch, close, notify, bus }`。
- **响应形态**：先回单个 JSON；如果处理过程中在结果之前发出通知，自动升级为 SSE。`responseMode` 可选 `'auto' | 'sse' | 'json'`，其中 `'json'` 会丢弃过程中的通知（已在已发布的 2.3.1 类型定义中确认）。另外，hono.md 官方示例对一个不带 `_meta` 的 `tools/list`（旧协议形态）回的是 SSE。
- **认证**：`handler.fetch(req, { authInfo })` 只负责透传，handler 内用 `ctx.http.authInfo` 读取。HTTP handler 本身不校验 Host、Origin 或 token。
- **`createMcpHonoApp` 的默认行为**（源码：packages/middleware/hono/src/hono.ts）：
  - 默认 `host='127.0.0.1'`，此时自动启用 `localhostHostValidation()` 和 `localhostOriginValidation()`，非 localhost 的 Host/Origin 回 403。
  - 不带 `Origin` 的请求一律放行。
  - 该函数只是 `new Hono()` 加中间件，**不负责绑定端口**。
- **[修正]** Origin/Host 校验"port-agnostic"（端口无关）是**文档明文**，不是推断，所以 localhost 任意端口的网页都能通过。已发布的 2.0.2 单独导出四个中间件：`hostHeaderValidation`、`localhostHostValidation`、`originValidation`、`localhostOriginValidation`，可以挂到已有的 app 上。
- **兼容旧客户端**：`createMcpHandler` 默认 `legacy: 'stateless'`，每个旧协议请求由新实例无会话处理，旧协议的 GET/DELETE 回 405；`'reject'` 则只接受新协议。来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md
- **[修正] hono 官方的情况**：hono.dev 第三方中间件页的 Utilities 分类下列有 "MCP"，链接到 honojs/middleware/packages/mcp（`@hono/mcp`）。来源：https://hono.dev/docs/middleware/third-party
  - 它的 README 示例是 v1 `McpServer` 加上一个共用的 `new StreamableHTTPTransport()`。这个类接受 v1 的 `StreamableHTTPServerTransportOptions`，会话是可选的，不是“必然有会话”。
  - 结论：要支持 2026-07-28，应该用 `@modelcontextprotocol/hono`。
- **[修正] 端口绑定**：`serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 })`。`hostname` 是 `@hono/node-server` 的 Options 字段（来源：https://github.com/honojs/node-server/blob/main/src/types.ts ），hono.dev 的 Node 页只示例了 `port`。

**stdio（v2）**（来源：https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md ）
- 用法：`serveStdio(() => new McpServer(...))`，从 `@modelcontextprotocol/server/stdio` 导入。也可以用 `StdioServerTransport` 加 `server.connect`。
- 日志只能用 `console.error`；stdin EOF 时自动关闭；`handle.close()` 用于退出。
- 默认 `legacy: 'serve'`，按连接决定协议代际。
- 调试：`npx @modelcontextprotocol/inspector node ./build/server.js`。

---

### 5. Claude Code 客户端侧（来源：https://code.claude.com/docs/en/mcp ，https://code.claude.com/docs/en/env-vars ，https://code.claude.com/docs/en/permissions ）

**添加服务器**（本次只查文档，未执行）
- HTTP：`claude mcp add --transport http <name> <url> --header "Authorization: Bearer …"`。
- stdio：`claude mcp add --transport stdio <name> -- <cmd>`。
- 文档原文："The SSE (Server-Sent Events) transport is deprecated"。
- **[补充] `.mcp.json` 注意事项**：
  - 只写 `url` 不写 `type` 会报配置错误，必须写 `"type": "http"`（也接受 `streamable-http`）。
  - `url` 和 `headers` 支持 `${VAR}` / `${VAR:-default}` 展开。
  - 但 Claude Code 认定为凭证的变量会被读成空串（例如 `ANTHROPIC_API_KEY`、`NPM_TOKEN` 等）。应该用自定义变量名，并按文档用 debug 日志里的 "never expanded toward a remote server" 确认是否被拦截。

**运行时**
- v1 运行时基于 SDK 1.x；v2 运行时基于 SDK 2.0，增加了 2026-07-28 支持。
- 会拉取 feature flag 的会话，v2.1.232+ 默认用 v2；不拉取 feature flag 的几类会话（Bedrock 等平台、关闭遥测等），v2.1.274+ 默认用 v2。
- v2 运行时会询问 HTTP 服务器是否支持新版协议；stdio 服务器默认按旧方式连接（v2.1.285+ 在逐步灰度）。
- **[修正] 手动指定**：`MCP_SDK_GENERATION`（v1/v2）需要 v2.1.218+；`MCP_PROTOCOL_NEGOTIATION`（auto/legacy）需要 **v2.1.221+**，本机的 2.1.220 不支持。

**超时**
- **[修正] 首字节计时器**：对 HTTP 服务器，每个请求都有一个到首字节的计时器，取值为三者最大：60 秒、该服务器的工具超时（per-server `timeout` 或已设置的 `MCP_TOOL_TIMEOUT`）、`MCP_TIMEOUT`。未设置 `MCP_TOOL_TIMEOUT` 时的 28 小时默认值不参与比较。
- 空闲超时：HTTP 默认 5 分钟、stdio 默认 30 分钟，期间收到 progress 不算空闲。per-server `timeout`（≥1000）会作为空闲窗口的下限。
- `MCP_TOOL_TIMEOUT` 默认约 28 小时，progress 不会延长这个上限。
- 主对话里的调用超过 2 分钟会自动转为后台任务（`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`，需要 v2.1.212+）。
- `MCP_TIMEOUT` 是启动超时，默认 30 秒。

**输出**
- `MAX_MCP_OUTPUT_TOKENS` 默认 25000，超过 10000 时显示警告。
- 不含图片的文本结果超过 50,000 字符会存成文件。
- 工具可以声明 `_meta["anthropic/maxResultSizeChars"]` 提高阈值，上限 500,000。
- 图片（PNG/JPEG/GIF/WebP）会内联显示，原图存到 tool-results 目录（需要 v2.1.283+，本机版本不满足），并且仍受 token 上限约束。
- `isError` 的文本超过约 11,000 字符时，只保留首尾各 5,000 字符。

**强制确认**：工具声明 `_meta["anthropic/requiresUserInteraction"]: true` 后，即使在 `acceptEdits`、`auto`、`bypassPermissions` 模式下，每次调用都会弹出确认，allow 规则也跳不过。
- **[补充]** 在 `dontAsk` 模式下，Claude Code 直接拒绝这类调用。
- **[补充]** 非交互模式下，`--permission-prompt-tool` 返回的 allow 会被转成 deny。只有 Agent SDK 的 `canUseTool` 能批准。

**[补充] Schema 兼容**
- 顶层属性名必须为 1–64 个字符，只用 ASCII 字母、数字和 `_ . -`；schema 必须通过 JSON Schema 2020-12 元 schema 校验，否则该工具会被排除（依赖 feature flag）。
- 根上的 `anyOf` / `oneOf` / `allOf` 会被拍平成单一对象，`anyOf` / `oneOf` 各分支的 `required` 只写进描述、不再强制。所以服务端仍要自己校验参数组合。

**命名与 elicitation**
- 工具名为 `mcp__<server>__<tool>`；插件提供的服务器是 `mcp__plugin_<plugin>_<server>__<tool>`。
- 支持 form 和 url 两种 elicitation，可以用 `Elicitation` hook 自动应答。

---

### 6. 对本平台的设计含义（[推断]，依据上文官方事实）

**1. 选型**
- 用 `@modelcontextprotocol/server` 2.x 加 `@modelcontextprotocol/hono` 2.x，挂在现有 Hono 的 `/mcp` 路由下。
- 挂在已有 app 上时，用导出的 `localhostHostValidation()` / `localhostOriginValidation()`。
- hono 需要 ≥4.11.4 且 <5；工具 schema 用 Zod ≥4.2.0（或其他 Standard Schema 库）编写。
- 仍由 `serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 })` 负责绑定。
- factory 每次都要 new McpServer。

**2. 鉴权**
- 原因：Origin 校验与端口无关，本机任意 localhost 页面都能通过；而且 Local Server Security 教程明说绑定 127.0.0.1 不等于鉴权。
- 做法：在 Hono 中间件里校验一个本机随机 Bearer token，再交给 `handler.fetch`。
- Claude Code 侧在 `.mcp.json` 写 `"type": "http"`，`headers` 中写 `"Authorization": "Bearer ${自定义变量名}"`。
- 不需要实现 OAuth。另一个选择是做一个 stdio 入口转发到 8787。

**3. 长任务**
- 视频任务用 `create_video_task` 立即返回 `task_id`（放进 `structuredContent`），再配 `get_task` / `cancel_task`，即 Stateful Tools 的 handle 模式（handle 要绑定调用方）。
- 理由：空闲 5 分钟；2 分钟后自动转后台；HTTP 关闭流就算取消；Tasks 扩展没有官方 TS 服务端实现，Claude Code 是否支持也没有文档。
- 同步生图可能超过 60 秒时，可以在 `.mcp.json` 设置该服务器的 `"timeout"` 来抬高首字节限制。发 progress 让 SDK 升级为 SSE 的前提是客户端带了 `progressToken`（见 gaps）。

**4. 计费确认**
- annotations 建议：
  - 生成类：`readOnlyHint:false`、`destructiveHint:false`、`idempotentHint:false`、`openWorldHint:true`。
  - 查询、校验、预览类：`readOnlyHint:true`。
  - 取消类：`destructiveHint:true`、`idempotentHint:true`。
- annotations 只是提示，客户端不一定据此确认。
- 需要强制人工确认时用 `anthropic/requiresUserInteraction`。但它会让无人值守的 agent（`dontAsk`、`-p` 加 `--permission-prompt-tool`）无法调用，可以考虑只给“直接扣费”的工具加。
- 也可以用 `inputRequired.elicit` 做确认：
  - `requestState` 用 `createRequestStateCodec`（HMAC 加 TTL）保护。
  - 一次性消费在服务端强制执行。
  - 服务端还要用 idempotency key 去重，防止重试导致重复扣费。

**5. 上传与结果**
- 请求体默认上限 4 MiB，`createMcpHonoApp` 和 handler 各有一道。建议素材参数接收本机路径或 URL，必要时调大 `maxRequestBodySize`。
- 结果返回本地路径、`resource_link`，加上小尺寸的 `image` 预览，避免触发 25k token 上限。
- 本机 2.1.220 不会把图片原图存成文件（需要 2.1.283+）。

---

### Sources
- https://modelcontextprotocol.io/specification/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
- https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress
- https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation
- https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- https://modelcontextprotocol.io/extensions/tasks/overview
- https://modelcontextprotocol.io/extensions/client-matrix
- https://github.com/modelcontextprotocol/ext-tasks （README、specification/2026-07-28/tasks.md）
- https://modelcontextprotocol.github.io/ext-tasks/typescript/
- https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security
- https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- https://github.com/modelcontextprotocol/typescript-sdk （README，docs/serving/{hono,http,stdio,legacy-clients,sessions-state-scaling}.md，docs/servers/{tools,logging-progress-cancellation,input-required}.md，docs/protocol-versions.md，docs/migration/upgrade-to-v2.md，packages/server/src/server/mcp.ts，packages/middleware/hono/src/{hono.ts,index.ts,middleware/originValidation.ts}，packages/middleware/hono/CHANGELOG.md）
- https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
- npm 官方 registry：`npm view` 查询，以及 https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.3.1.tgz 、@modelcontextprotocol/hono 2.0.2 的 tarball（只读，解压在 scratchpad 中查看 .d.mts）
- https://github.com/honojs/middleware/tree/main/packages/mcp ，https://hono.dev/docs/middleware/third-party ，https://hono.dev/docs/getting-started/nodejs ，https://github.com/honojs/node-server/blob/main/src/types.ts
- https://code.claude.com/docs/en/mcp ，https://code.claude.com/docs/en/env-vars ，https://code.claude.com/docs/en/permissions

### gaps
- **旧协议客户端在 `legacy:'stateless'` 下的两个行为没有官方说明**：一是用单独 POST 发来的 `notifications/cancelled`（SDK era 对照表写明 2025 代用这种方式）落到新实例后，能否取消正在执行的请求；二是 `inputRequired` 的 legacy shim 在无状态 HTTP 下能否推送 `elicitation/create` 并收回响应。
- **Claude Code 是否给 MCP 工具调用带 `progressToken`**，文档没有明说（只提到后台任务会显示“the latest progress the server has reported”）。`responseMode:'sse'` 先发出的响应头是否算“首字节”，也没有文档说明。
- **Claude Code 怎样使用 `structuredContent`、`resource_link`**，以及 readOnlyHint / destructiveHint 是否影响权限提示，mcp、permissions、env-vars 页都没有写。
- **Claude Code 是否支持 `io.modelcontextprotocol/tasks`**，没有文档；扩展支持矩阵中没有这一列。
- **服务器端 Tasks 的官方实现**：没有找到能让 v2 McpServer 在 2026-07-28 下返回 `CreateTaskResult` 的官方实现或集成文档。
- **当前会话实际用的 Claude Code 版本和运行时**：本机 PATH 上是 2.1.220，但当前会话可能运行在桌面版内置的其他版本上。实际用 v1 还是 v2 运行时、以哪一代协议连接，需要连接后用 `/mcp` 确认。
- **hono.dev 没有独立的 MCP 文档页**，详细文档在 honohub.dev，不在本任务限定的官方来源范围内，未作为依据。
- **`server/discover` 和 `basic/index` 的 `_meta` 细则页没有通读**；SDK 会自动实现 `server/discover`，这一点来自 SDK 文档和 changelog。
- **项目现有依赖版本无法确认**：项目目录 中没有找到项目的 hono/zod 版本，无法确认是否满足 hono ≥4.11.4、Zod v4 的要求。
- **Origin 端口无关只核对了文档和源码**，没有实际运行验证。
- **`localhostAllowedOrigins()` 的返回值只看了 JSDoc**（localhost、127.0.0.1、[::1]），没有读 `@modelcontextprotocol/server` 内部实现逐行核对。
- **（已关闭）** 原报告“已发布版本是否与 main 一致”这条 gap 已通过 npm tarball 的类型定义核实，见修正项。

## corrections
[
 {
  "claim": "§6.3：暂时不依赖 Tasks 扩展，因为它在 TS 侧的服务端实现只支持 2025-11-25。",
  "problem": "对原文理解错了。ext-tasks TS 包里的 receiver 是“2025-11-25 Tasks sampling and elicitation receiver”，挂在 Client 上（bindTaskReceiver(client, …)），意思是客户端接收服务器下发的任务化 sampling/elicitation 请求。这个包的 peerDependencies 只有 @modelcontextprotocol/client ^2.0.0，不含任何服务端实现。",
  "correct_fact": "官方 TS 生态目前没有能让 v2 McpServer 返回 CreateTaskResult 的服务端实现：ext-tasks 包只服务客户端；SDK v2 删除了实验性 tasks API（registerToolTask 等）。所以“不依赖 Tasks”这个结论仍然成立，但理由要改成：服务端没有官方实现，Claude Code 也没有文档说明支持该扩展。",
  "source_url": "https://modelcontextprotocol.github.io/ext-tasks/typescript/"
 },
 {
  "claim": "§4 表格与 §6.1：v2 依赖 zod ^4.2.0（不再支持 zod v3），所以项目里的 zod 必须是 ^4.2.0。",
  "problem": "说得过严。v2 包自己依赖 zod ^4.2.0；项目如果锁在 zod@3，v2 会装一份嵌套的 zod@4，不会冲突。真正不能用的是拿 Zod v3 写工具 schema。",
  "correct_fact": "迁移指南原文：“Zod v3 is no longer supported”。推荐 Zod ≥4.2.0。Zod 4.0–4.1 也能用，但 SDK 会退回用内置 z.toJSONSchema() 转换，并打印一次 [mcp-sdk] 警告。也可以用任何 Standard Schema 库（Valibot、ArkType），或用 \"zod-v4\": \"npm:zod@^4.2.0\" 别名只给 MCP 相关代码用。",
  "source_url": "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md"
 },
 {
  "claim": "§4：Origin 校验只比对 hostname、不区分端口——“来自源码，属推断”；并称单独导出的中间件是三个：hostHeaderValidation、originValidation、localhostOriginValidation。",
  "problem": "端口无关不是推断，官方文档和 JSDoc 都写明了。导出的中间件也少列了一个。",
  "correct_fact": "hono.md 原文：“allowedHosts and allowedOrigins take hostnames, port-agnostic”。originValidation 的 JSDoc 写的是 “Validates the Origin header hostname (port-agnostic)”。所以任何端口上的 localhost、127.0.0.1、[::1] 页面都能通过校验。已发布的 2.0.2 导出四个中间件：hostHeaderValidation、localhostHostValidation、originValidation、localhostOriginValidation，另有 createMcpHonoApp。",
  "source_url": "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/hono.md"
 },
 {
  "claim": "§6.2：“规范……明确说 127.0.0.1 不是鉴权边界”。",
  "problem": "出处标错了。这句话不在规范正文里。",
  "correct_fact": "原句“Binding to 127.0.0.1 is not an authentication boundary”出自文档区教程 Local Server Security，不是规范的规范性条文。Streamable HTTP 规范本身只写了 Origin 校验（MUST）、绑定 localhost（SHOULD）和实现认证（SHOULD）。",
  "source_url": "https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security"
 },
 {
  "claim": "§2：规范对有状态工具的建议是：返回不透明、高熵的 handle（例如 UUIDv4），并设定有限的有效期。",
  "problem": "漏了限定条件，也没说明这一节是非规范性的。",
  "correct_fact": "Stateful Tools 一节自己标明是“non-normative guidance”。高熵（例如 UUIDv4）加有限寿命是针对未认证服务器的建议，因为这时 handle 就等于 bearer token。对已认证的服务器，handle 只是一个名字，每次调用都要校验调用者对这个 handle 的授权。安全最佳实践另外要求：MUST NOT treat possession of a state handle as authentication；SHOULD 在服务端把 handle 绑定到已认证用户。",
  "source_url": "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
 },
 {
  "claim": "§5 和 §6.3：HTTP 服务器的“到首字节”计时器默认 60 秒，因此同步调用超过 60 秒会出问题。",
  "problem": "60 秒只是下限，这个值可以调大。",
  "correct_fact": "Claude Code 取三者中最大的一个：60 秒、对该服务器生效的工具超时（.mcp.json 里的 per-server timeout，或已设置的 MCP_TOOL_TIMEOUT）、MCP_TIMEOUT。未设置 MCP_TOOL_TIMEOUT 时的 28 小时默认值不参与比较。所以在 .mcp.json 里给这个服务器设 \"timeout\" 大于 60000，就能放宽首字节限制。",
  "source_url": "https://code.claude.com/docs/en/mcp"
 },
 {
  "claim": "§5：可以用 MCP_SDK_GENERATION、MCP_PROTOCOL_NEGOTIATION 手动指定运行时和协议协商。",
  "problem": "没写版本要求。本机 CLI 是 2.1.220，其中一个变量还不能用。",
  "correct_fact": "MCP_SDK_GENERATION 需要 Claude Code v2.1.218 及以上，本机可用。MCP_PROTOCOL_NEGOTIATION 需要 v2.1.221 及以上，2.1.220 不支持。",
  "source_url": "https://code.claude.com/docs/en/env-vars"
 },
 {
  "claim": "§5/§6.4：需要强制确认时用 _meta[\"anthropic/requiresUserInteraction\"]，bypassPermissions 也会弹窗，allow 规则也跳不过。",
  "problem": "漏了与“让 agent 自动操作”直接冲突的限制。",
  "correct_fact": "在 dontAsk 模式下，Claude Code 会直接拒绝这类调用。非交互模式下，--permission-prompt-tool 返回的 allow 会被转成 deny（“MCP tool requires user interaction; not supported via --permission-prompt-tool”）。只有 Agent SDK 的 canUseTool 回调能批准它。所以无人值守的 claude -p 流程调不了带这个标记的工具。",
  "source_url": "https://code.claude.com/docs/en/mcp"
 },
 {
  "claim": "§0：createMcpHandler 默认 legacy: 'stateless'，已经覆盖旧协议客户端的情况。",
  "problem": "说过头了，和报告自己 gaps 里的未核实项相互矛盾。",
  "correct_fact": "官方文档只能证明：旧协议的 initialize 和普通请求可以由新实例无会话地处理，GET/DELETE 回 405。没有官方说明的有两点：2025 代客户端在 Streamable HTTP 上通过单独 POST 发 notifications/cancelled（SDK 的 era 对照表原文就是这么写的）时，能否取消正在执行的请求；legacy shim 在无状态 HTTP 下能否推送 elicitation/create 并收回响应。只能说“基本调用已覆盖”。",
  "source_url": "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md"
 },
 {
  "claim": "§4：@hono/mcp 的 README 用的是 v1 SDK 和“有会话的” StreamableHTTPTransport。",
  "problem": "不准确。README 示例里没有配置会话。",
  "correct_fact": "README 示例是 new StreamableHTTPTransport()，没有传 sessionIdGenerator，所有请求共用同一个 McpServer，只 connect 一次。这个类接受 v1 SDK 的 StreamableHTTPServerTransportOptions，会话是可选的；另提供 onsessiondisconnected 和 GET SSE / DELETE 相关语义。它属于 2025 代 Streamable HTTP。hono.dev 第三方中间件页把它放在 Utilities 分类下。",
  "source_url": "https://github.com/honojs/middleware/tree/main/packages/mcp"
 },
 {
  "claim": "gaps：没有核对已发布的 npm 2.3.1 / hono 2.0.2 是否包含 responseMode、legacy、maxToolInputElements 等选项。",
  "problem": "现在可以核对了，这条 gap 应该删掉。",
  "correct_fact": "已从 registry.npmjs.org 下载 2.3.1 和 2.0.2 的 tarball（放在 scratchpad），查看其中的 .d.mts，确认存在以下内容：responseMode?: 'auto'|'sse'|'json'；legacy?: 'stateless'|'reject'（HTTP）和 'serve'|'reject'（stdio）；maxToolInputElements；maxRequestBodySize；createRequestStateCodec、inputRequired、acceptedContent、inputResponse、isLegacyRequest、legacyStatelessFallback、serveStdio、localhostAllowedOrigins。hono 2.0.2 导出上述四个中间件和 createMcpHonoApp。",
  "source_url": "https://registry.npmjs.org/@modelcontextprotocol/server/-/server-2.3.1.tgz"
 },
 {
  "claim": "§4：registerTool(name, { title?, description, inputSchema: z.object(...), outputSchema?, annotations?, icons?, _meta? }, cb)。",
  "problem": "把 description 写成了必填，还漏了一个选项。",
  "correct_fact": "源码签名中 description 和 inputSchema 都是可选的，另外还有 scopeChallenge?: ScopeChallengeHandler。_meta?: Record<string, unknown> 确实存在，可以用来写 anthropic/requiresUserInteraction 和 anthropic/maxResultSizeChars。",
  "source_url": "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/mcp.ts"
 },
 {
  "claim": "§1 次要变化：HTTP POST 必须携带 Mcp-Method / Mcp-Name 请求头。",
  "problem": "范围说大了。",
  "correct_fact": "Mcp-Method 是所有请求都必须带的。Mcp-Name 只在 tools/call、resources/read、prompts/get 请求上必须带。缺头或头与 body 不一致时，服务器回 400 和 HeaderMismatch（-32020）。",
  "source_url": "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
 },
 {
  "claim": "§6.1：继续由 serve({ hostname: '127.0.0.1', port: 8787 }) 负责绑定。",
  "problem": "漏了必需参数 fetch；hostname 的出处也不在 hono.dev。",
  "correct_fact": "hono.dev 的 Node.js 页只给了 serve({ fetch: app.fetch, port }) 的示例，没有写 hostname。hostname?: string 是 @hono/node-server 的 Options 类型里定义的。正确写法是 serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 })。",
  "source_url": "https://github.com/honojs/node-server/blob/main/src/types.ts"
 },
 {
  "claim": "§6.4：如果 requestState 里携带费用确认信息，必须 HMAC 签名并设置 TTL。",
  "problem": "不完整：漏了规范对一次性使用的 MUST，也没提 SDK 现成的工具。",
  "correct_fact": "MRTR 规范写明：如果某个 requestState 只能被消费一次（例如一次性兑换），服务器 MUST 在服务端强制执行；HMAC 加 TTL 只能缩小重放窗口，不能保证只用一次。SDK 提供 createRequestStateCodec（HMAC-SHA256，密钥至少 32 字节，可设 ttlSeconds），通过 McpServer 的 requestState.verify 接入。它只签名、不加密，payload 里不要放机密。",
  "source_url": "https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr"
 }
]

## gaps
- SDK v2 文档读的是 GitHub main 分支的原始 markdown，没有逐项核对已发布的 npm 2.3.1 / hono 2.0.2 是否与 main 完全一致（例如 createMcpHandler 的 responseMode、legacy 选项、maxToolInputElements 在已发布版本中是否都已存在）。
- Tasks 扩展：ext-tasks 的 TS 包只声明支持 2025-11-25 的服务端（receiver）；v2 McpServer 怎样在 2026-07-28 下返回 CreateTaskResult，官方没有找到可用的集成文档。Claude Code 是否支持 io.modelcontextprotocol/tasks 也没有官方说明（扩展支持矩阵里既没有 Tasks 列也没有 Claude Code 行）。
- Claude Code 文档没有说明它怎样展示或使用 structuredContent、resource_link，以及 readOnlyHint/destructiveHint 等 annotations 是否影响权限提示（在 mcp/permissions/hooks/env-vars 页都没有找到相关内容）。
- 旧协议客户端在 createMcpHandler 默认 legacy:'stateless' 下：用单独 POST 发来的 notifications/cancelled 会落到一个新的服务器实例上，能否取消正在执行的请求没有官方说明；inputRequired 的 legacy shim 在无状态 HTTP 下能否推送 elicitation/create 也没有逐项核实。
- 本机 PATH 上的 claude CLI 是 2.1.220，但当前会话可能运行在 Claude 桌面版内置的另一个版本上；它实际用 v1 还是 v2 运行时、以哪一代协议连接，需要实际连接后用 /mcp 确认。
- hono.dev 没有独立的 MCP 文档页，只在第三方中间件列表中链接到 @hono/mcp；它的详细文档在 honohub.dev（不在任务限定的官方来源范围内，未作为依据）。
- 没有通读 server/discover 和 basic/index 的 _meta 细则页；SDK 会自动实现 server/discover，这一点来自 SDK 文档和规范 changelog。
- 项目目录 目录 ls 没有输出，无法确认项目当前的 hono/zod 版本是否满足 v2 SDK 的要求（hono ≥4.11.4、zod ^4.2.0）。
- Origin 中间件对端口不敏感这一结论来自 @modelcontextprotocol/hono 源码和文档里“port-agnostic”的表述，没有实际运行验证。