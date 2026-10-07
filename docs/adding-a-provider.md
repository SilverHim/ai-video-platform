# 新增一个服务商 / 模型

所有服务商与模型知识都写成**声明**（`src/shared/catalog/types.ts`），网页表单、提交校验、请求构建、MCP 工具与测试共用同一份。新增服务商时，服务端路由、参数表单、调度器、历史、MCP 工具都不用改。

## 步骤

1. **新建目录** `src/shared/providers/<provider>/`：
   - `index.ts`：`ProviderDef`
     - `baseUrls`：允许的 Base URL 白名单（只能按 id 选择，防 SSRF）
     - `endpoints`：每个操作的方法、路径、超时、是否可重试（创建类请求一律 `retry: 'none'`）、代理侧限速 `rps`
     - `keyTest`：免费校验 Key 用的请求（一般是任务列表接口）
     - `polling`：异步任务的轮询节奏
     - `limits.maxRequestBytes`、`normalizeError`
   - `errors.ts`：把服务商错误归一化成 `NormalizedError`（分类、错误码、request id、是否可重试、提示文案）
   - `<family>/`：每个模型家族一个子目录，导出 `ModelDef[]`
2. **模型声明**（`ModelDef`）：
   - `modes`：每个模式的素材槽（数量、格式、大小、宽高、像素、时长、fps、透明通道）、提示词规则、锁定值与原因、固定写入请求体的片段
   - `fields`：类型（enum / int / bool / text / seed / size）、默认值、范围、条件显隐、禁用原因、`wire` 路径或 `fragment`
   - `constraints`：跨字段校验（error / warn / info，可带一键修复）
   - `wireGuards`：对最终请求体的最后检查（服务端转发前必跑），用来拦住"违反了会异步失败"的组合
   - `adapter`：`compose`（组装 model / prompt / 素材数组）、`normalizeSubmit`、`normalizeTask`（异步）、`parseStreamEvent`（流式）
   - `estimateCost`：按官方标价估算，拿不到价格就返回 `null`，不要编数
   - `docs`：用 `doc(url)` 写上核对过的官方文档链接（带核对日期）
3. **注册**：在 `src/shared/providers/registry.ts` 的 `PROVIDERS` 里加一行。
4. **测试**（放在家族目录的 `__tests__/`，fixture 放 `__fixtures__/`，原样摘录官方文档示例）：
   - 每个模型默认请求体的黄金快照（精确断言）
   - 每个模式、每条约束与 wireGuard 的命中 / 不命中
   - 响应解析：成功、部分失败、错误、各任务状态
5. **mock**（可选）：在 `src/server/mock/upstream.ts` 加上该服务商的假接口，`npm run dev:mock` 不需要 Key 也能演示。
6. **文案**：模型、字段、约束的文案直接写在声明里（`T(zh, en)`）；只有界面通用文案才放 `src/web/i18n/locales/`。

## 原则

- **事实只来自官方文档**：文档冲突或未写明的地方取保守做法（不暴露或只给 warn），标 `experimental: true`，并在代码里注释 `// 文档冲突：…` / `// 未核实：…`。
- **不支持的字段不要写进该模型的声明**：可见字段一律显式发送，避免依赖服务商默认值。
- **素材顺序**：`content[]` 等数组的顺序必须用 `orderedAssets` / `computeRefOrder`，保证提示词里的"Image n"和第 n 个素材一致。
- **大整数 ID**（例如 MiniMax 的 file_id）一律按字符串处理。
