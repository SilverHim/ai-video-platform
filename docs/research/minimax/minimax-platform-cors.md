> **核查说明（2026-10-07 UTC）**
> - **复核范围**：报告中的事实已逐条回到国际站原文 platform.minimax.io/docs（各 .md 页、llms-full.txt、OpenAPI JSON）复核；CORS 部分用 curl 不带 Key 重新实测。
> - **未复核的部分**：Browser pane 导航被拒，所有"浏览器内实测"的结论本次都没能复现，文中标为【未复核】。
> - **标注约定**：【推论】表示不是文档事实。

# MiniMax 国际站：平台通用事实与浏览器直连可行性（核查修订版）

## 0. 结论摘要

### 0.1 基础域名
- 视频（V1/V2）、图像、文件的 OpenAPI `servers` 都只写了 `https://api.minimax.io`。
- `api-uw.minimax.io` 只作为"同步 TTS 的美西推荐域名"出现。实测它的 `/v1/video_generation`、`/v1/image_generation`、`/v2/video_generation`、`/v1/files/retrieve` 都返回 404（`/v1/t2a_v2` 返回 200）。
- 文档里还有一个主机 `www.minimax.io`，只用于 M Plan 额度查询 `GET /v1/token_plan/remains`。
- 来源：
  - https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md
  - https://platform.minimax.io/docs/llms-full.txt（同步 TTS 段）
  - https://platform.minimax.io/docs/m-plan/faq.md

### 0.2 鉴权
- 写法：`Authorization: Bearer <API_key>`（securitySchemes 为 `type: http, scheme: bearer, bearerFormat: JWT`）。
- 国际站 llms-full.txt 和 8 个视频/图像/文件 OpenAPI JSON 里，`GroupId`/`group_id` 出现 0 次。

### 0.3 Key 类型（报告原写"两种"，不完整）
- **pay-as-you-go API Key**：前缀 `sk-api-...`，支持全部模态。
- **M Plan Subscription Key**：前缀 `sk-cp-...`，和按量 Key "cannot be used interchangeably"。
- **Token Plan Subscription Key**（老订阅）：不支持 MiniMax H3。
- **Video Packages**：只覆盖 Hailuo，不支持 H3。

### 0.4 视频接口分两代
- **V1** `/v1/video_generation`：Hailuo 和 T2V-01/I2V-01/S2V-01 系列，按量价格页把 Hailuo 放在 "Legacy Models" 折叠栏。
- **V2** `/v2/video_generation`：`MiniMax-H3`、`MiniMax-H3-Max`。
- **图像**：`/v1/image_generation`，t2i 用 `image-01`，i2i 的 enum 是 `image-01`、`image-01-live`。

### 0.5 浏览器直连（CORS 实测，文档没有承诺）
- **V1 全族**（含 `/v1/files/*`）：
  - 所测约 20 个 Origin 的预检全部是 200，包括 `null`、127.0.0.1、[::1]、example.com、*.localhost 和 localhost 各端口；
  - 固定返回 `ACAO: *`，ACAH 里显式列出了 `Authorization` 和 `Content-Type`；
  - 结论：浏览器可以直接调用。（报告原写"任意 Origin"，是夸大。）
- **V2 全族**（`/v2/*`）：预检带一份文档里没写的 Origin 白名单。
  - **通过**：`http://localhost`（也就是浏览器里的 http://localhost:80）、`http://localhost:3000/3001/5173/8000/8888`、`https://platform.minimax.io`、`https://www.minimax.io`，以及字面量 `file://`。
  - **403**（只带 `ACAO: *`，没有 Allow-Methods/Headers，浏览器判定预检失败）：127.0.0.1、[::1]、*.localhost、https://localhost、localhost 的其他端口（4173/4200/5000/5174/8080/8081/9000/3002/65535）、`null`、https://example.com、https://minimax.io。不带 Origin 的预检也是 403。
- **官方立场**：About APIs FAQ 明确说不要在浏览器或客户端代码里暴露 API Key，公开泄露的 Key 可能被自动禁用。

### 0.6 结果媒体
- 文档 schema 示例里的 V2 输出 URL 在 `video-product.cdn.minimax.io`（AliyunOSS）上：没有 CORS 头，并且带 `content-disposition: attachment` 和 `x-oss-force-download: true`。
- `cdn.hailuoai.com` 那条示例是演示素材（路径含 `hailuo_demo/testsets/.../inputs/`），`your-cdn.example.com` 是占位符，两者都不能证明生产域名。
- 图片结果 URL 的域名文档没有给出。

## 1. 域名与鉴权

| 项目 | 核实后的事实 | 来源 |
|---|---|---|
| API 基础域名 | 视频 V1/V2、图像、文件的 OpenAPI `servers` 都只有 `https://api.minimax.io` | video-generation-v2-create.md、video-generation-t2v.md、image-generation-t2i.md、file-management-upload.md |
| OpenAI / Anthropic 兼容 Base URL | `https://api.minimax.io/v1` / `https://api.minimax.io/anthropic` | https://platform.minimax.io/docs/guides/quickstart-preparation.md |
| `api-uw.minimax.io` | 原文："All three synchronous TTS APIs support the following domains. For US West, `api-uw.minimax.io` is recommended"。只列了 t2a_v2 的 HTTP/WS 和 t2a_v2_bidi；实测视频、图像、文件路径都是 404 | llms-full.txt；实测 |
| `www.minimax.io` | M Plan 额度查询 `GET https://www.minimax.io/v1/token_plan/remains`（Bearer）；实测预检 200、`ACAO: *` | https://platform.minimax.io/docs/m-plan/faq.md；实测 |
| 中国区域名 | 国际站文档也提到中国用户用 `https://api.minimax.cn/...`；国际站 Speech-to-Text 指南的示例也写的是 api.minimax.cn（属于跨站混用，和本方向无关） | llms-full.txt |
| 鉴权头 | `Bearer API_key`，Key 在 Account Management > API Keys 获取；`bearerFormat: JWT` 只是 schema 标注，实际 Key 前缀是 sk-api-/sk-cp-，不要按 JWT 校验【推论】 | 各 OpenAPI 页 |
| 无 Key 时的提示 | `login fail: Please carry the API secret key in the 'Authorization' field of the request header`；V1 是 HTTP 200 加 `base_resp.status_code=1004`，V2 是 HTTP 401 加 `(1004)`；带无效 Bearer 实测结果相同 | 实测；V2 Err401 示例 |
| GroupId | 国际站文档里没有出现；服务端 ACAH 里有 `X-Group-Id`，用途无文档 | 全文检索；实测 |
| Content-Type | V1 视频、图像、V2 create、files/delete 都是 required，枚举 `application/json`（default 同值）；upload 是 `multipart/form-data` | 各 OpenAPI 页 |
| 区域 Key | M Plan FAQ 区分 Global API Key 和 Mainland China API Key（mmx `region global/cn`）；CLI 文档写着 "The region follows the platform where your API service was purchased" | https://platform.minimax.io/docs/m-plan/faq.md ；llms-full.txt |

## 2. API Key 与计费形态

### 2.1 Pay-as-you-go API Key
- 获取位置：API Keys > Create new secret key。
- 原文 "Pay-as-you-go supports all modality models, including language, Video, Speech, and Image"。
- 来源：https://platform.minimax.io/docs/guides/quickstart-preparation.md

### 2.2 M Plan Subscription Key
- **获取位置**：Billing > M Plan（API Overview / Prerequisites 的写法）；M Plan FAQ 和 Quickstart 写的是 Plan Details（console/plan）。
- **与按量 Key 的关系**：原文 "Subscription Keys are separate from standard pay-as-you-go API Keys and cannot be used interchangeably"。只消耗 M Plan 额度和 credit pack，不扣账户余额。
- **模型范围**：三档（Go/Explore/Build）都包含图像；Explore 和 Build 包含 H3 视频，Go 不包含视频。
- **额度窗口**：视频只有周窗口；其他模态是 5 小时窗口加周窗口。
- **限流**：原文 "Requests may be throttled when exceeded, typically recovering within about one minute. Limits may tighten during peak traffic"。
- **能否调 REST**：FAQ 写着 "API endpoints with pay-as-you-go pricing deduct from included M Plan usage at the corresponding endpoint price"。
- 来源：
  - https://platform.minimax.io/docs/m-plan/faq.md
  - https://platform.minimax.io/docs/m-plan/intro.md
  - https://platform.minimax.io/docs/m-plan/quickstart.md

### 2.3 Key 前缀
- 原文："Subscription Keys (`sk-cp-...`) and pay-as-you-go API Keys (`sk-api-...`) are billed separately"。
- 来源：https://platform.minimax.io/docs/m-plan/minimax-cli.md

### 2.4 Token Plan Subscription Key（老订阅，报告遗漏）
- 原文说 Token Plan "extends upon our former Coding Plan"。
- 原文 "A small number of special models (MiniMax H3, voice design, rapid voice cloning, etc.) are not currently supported"，覆盖 image/speech。
- 与按量 Key 不可互换。
- 来源：
  - https://platform.minimax.io/docs/token-plan/intro.md
  - https://platform.minimax.io/docs/guides/pricing-token-plan.md

### 2.5 Video Packages（报告遗漏）
- 原文 "Video packages support Hailuo video models. MiniMax H3 is not supported yet"，支持 "Video Generation API"。
- 各档 RPM：Standard 20、Pro 30、Scale 40、Business 50；Custom 档写的是 "Unlimited RPM/TPM"。
- 失败任务不扣点。
- 用哪种 Key 调用：文档未说明。
- 来源：
  - https://platform.minimax.io/docs/guides/pricing-video.md
  - https://platform.minimax.io/docs/pricing/overview.md

### 2.6 文档之间的张力
- 视频指南和 V2 Create 页写着 "To use MiniMax H3 or MiniMax H3 Max, please select the Pay-as-you-go API"；M Plan 又说 Explore/Build 包含 H3。
- M Plan CLI 页说订阅后可以用 `mmx video generate` 和 `mmx image generate`，但没有点名 REST 路径。
- 所以 Subscription Key 能否直接调 `/v2/video_generation` 仍未明确，见 gaps。

## 3. 限流（Rate Limits 页）

页面原文是 "The rate limits applied to your account depend on the model and interface you use"。

| API | 模型 | RPM | Max inflight tasks |
|---|---|---|---|
| Video Generation | Hailuo series | 20 | — |
| Video Generation V2 | MiniMax-H3 | 300 | 30 |
| Image Generation | image-01 | 10 | 未列 |

补充说明：
- 表里没有单列 MiniMax-H3-Max。
- "Hailuo series" 是否包含 T2V-01/I2V-01/S2V-01，未说明。
- files、query、retrieve 端点的限流未说明。
- Video Packages 的 RPM 是 20 到 50，和本表是什么关系，未说明。
- 视频指南的示例代码注释建议每 10 秒轮询一次。

来源：
- https://platform.minimax.io/docs/guides/rate-limits.md
- https://platform.minimax.io/docs/guides/video-generation.md

## 4. 错误码

### 4.1 通用表（原文）

| 错误码 | 原文 |
|---|---|
| 1000 | unknown error |
| 1001 | request timeout |
| 1002 | rate limit |
| 1004 | not authorized / token not match group / cookie is missing, log in again |
| 1008 | insufficient balance |
| 1024 | internal error |
| 1026 | input new_sensitive |
| 1027 | output new_sensitive |
| 1033 | system error / mysql failed |
| 1039 | token limit |
| 1041 | conn limit |
| 1042 | invisible character ratio limit |
| 1043 | The asr similarity check failed |
| 1044 | clone prompt similarity check failed |
| 2013 | invalid params / glyph definition format error |
| 20132 | invalid samples or voice_id |
| 2037 | voice duration too short / voice duration too long |
| 2039 | voice clone voice id duplicate |
| 2042 | You don't have access to this voice_id |
| 2045 | rate growth limit |
| 2048 | prompt audio too long（解决办法写 < 8s） |
| 2049 | invalid API Key |
| 2056 | usage limit exceeded（解决办法写等下一个 5 小时窗口） |

- `1013 Internal service error` 出现在 Files Retrieve 页和 Video Download 页，通用表里没有；这两页把 1039 写成 "TPM limit triggered"。
- 来源：
  - https://platform.minimax.io/docs/api-reference/errorcode.md
  - https://platform.minimax.io/docs/api-reference/video-generation-download.md

### 4.2 V1 与 V2 的错误形态不同

**V1**
- 响应体：`base_resp.status_code`/`status_msg`，0 表示成功。OpenAPI 只定义了 HTTP 200 响应。
- 缺 Key 时实测 HTTP 200。
- 例外：`/v1/files/upload` 文档写着规格不合规 "rejected with 400"，所以前端两者都要处理。

**V2**
- 原文 "On error the HTTP status is the real error code (401/400/429/402/422/500…)"。
- 响应体：`{"type":"error","error":{"type","message","http_code"},"request_id"}`，`message` 结尾括号里是内部码。
- `error.type` 取值：`authorized_error`(401)、`bad_request_error`(400)、`rate_limit_error`(429)、`insufficient_balance_error`(402)、`unprocessable_entity_error`(422)、`overloaded_error`(529)、`server_error`(500)。
- 任务失败时：`task.status=failed`，`task.error.code` 为 **string**（例如 '1026'）。

来源：
- https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md
- https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md

### 4.3 状态枚举

| 场景 | 取值 |
|---|---|
| V1 Query | `Preparing` / `Queueing` / `Processing` / `Success` / `Fail` |
| V1 callback | `processing` / `success` / `failed` |
| V2 Query 与 callback | `queued` / `running` / `succeeded` / `failed` / `cancelled` |

- V2 只能查最近 7 天（窗口 `[T-7d, T)`），超出返回 `invalid task_id`。

## 5. 文件上传与参考素材

### 5.1 上传接口
- `POST /v1/files/upload`，`multipart/form-data`。
- 必填：`purpose`、`file`。
- `purpose` 枚举：`voice_clone`、`prompt_audio`、`t2a_async_input`、`video_understanding`、`video_generation_input`。
- List Files 的 `purpose` 枚举里没有 `video_understanding`。

### 5.2 `video_generation_input`
- **用途**：首帧图、参考图、参考视频、参考音频。
- **引用方式**：在生成请求 content 的 `url` 里写 `mm_file://{file_id}`。
- **有效期**：7 天，过期后生成会返回 file expired。
- **校验**：上传时校验规格，不合规返回 400 且文件不保留。
- **heic/heif**：由服务端解析。
- **格式与单文件上限**：

  | 类型 | 格式 | 单文件上限 |
  |---|---|---|
  | 图片 | jpg/jpeg/png/webp/heic/heif | 30 MB |
  | 参考视频 | mp4/mov | 50 MB |
  | 参考音频 | wav/mp3 | 15 MB |

### 5.3 上传响应
- `file.file_id`（int64）、`bytes`、`created_at`、`filename`、`purpose`，以及 `base_resp`。

### 5.4 各接口参考素材的写法

| 接口 | 写法 | 限制 |
|---|---|---|
| V2 content `image_url.url` / `video_url.url` / `audio_url.url` | 公网 URL、`mm_file://{file_id}`、`data:<mime>;base64,...` | 请求体 ≤ 64 MB，Base64 约膨胀 33%；图片的 `mm_file` 可以是上传文件，也可以是 "a previous output's file_id" |
| V1 i2v `first_frame_image`（required） | 公网 URL 或 Base64 Data URL | JPG/JPEG/PNG/WebP，<20MB，短边 >300px，宽高比 2:5–5:2 |
| V1 FL2V `first_frame_image` / `last_frame_image`（required：`model`、`last_frame_image`；只有 `MiniMax-Hailuo-02`；768P/1080P） | 公网 URL 或 Base64 Data URL | 同上；分辨率跟随首帧，尾帧尺寸不同会被裁剪 |
| V1 S2V `subject_reference[].image`（string 数组） | 传入方式未说明 | JPG/JPEG/PNG/WebP，<20MB；只支持 1 张；`type` 只有 `character` |
| image-01 i2i `subject_reference[].image_file` | 公网 URL 或 Base64 Data URL | JPG/JPEG/PNG，<10MB；每次请求只支持 1 张参考图；`type` 只有 `character` |

- V1 的 t2v/i2v/fl2v/s2v 页和 image t2i/i2i 页里，`mm_file` 都出现 0 次。
- **结论**：`files/upload` 只在文档中明确用于 V2（H3）的参考素材。

来源：
- https://platform.minimax.io/docs/api-reference/file-management-upload.md
- https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md
- https://platform.minimax.io/docs/api-reference/video-generation-i2v.md
- https://platform.minimax.io/docs/api-reference/video-generation-fl2v.md
- https://platform.minimax.io/docs/api-reference/video-generation-s2v.md
- https://platform.minimax.io/docs/api-reference/image-generation-i2i.md
- https://platform.minimax.io/docs/guides/image-generation.md

## 6. CORS 实测（不带 Key，不计费；2026-10-07 UTC 复测）

### 6.1 预检响应头
- 请求：`Origin: http://localhost:5173`，方法 POST，请求头 `authorization,content-type`。
- 测过的端点：`/v1/video_generation`、`/v1/image_generation`、`/v1/query/video_generation`、`/v1/files/retrieve`、`/v1/files/upload`、`/v1/files/retrieve_content`、`/v2/video_generation`、`/v2/query/video_generation/1`。
- 结果：全部 HTTP 200，body 是 `{"status_code":0,"status_msg":"success"}`。响应头如下：

```
access-control-allow-origin: *
access-control-allow-methods: GET,POST,OPTIONS,PUT,DELETE
access-control-allow-headers: request-id,Trace-Id,DNT,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,Token,Userid,Origin,Accept,X-Requested-With,X-Request-From-Mark,X-Group-Id,X-Traffic-Tag,bedrock-lane,bedrock_lane,language
access-control-allow-credentials: true
access-control-expose-headers: *,Authorization,Content-Disposition,X-Request-From-Mark
```

- 不回显 Origin；没有 `Access-Control-Max-Age`，也没有 `Vary: Origin`。

### 6.2 不同 Origin 的预检状态码

| Origin | V1（video/image/query/files 各端点） | V2 |
|---|---|---|
| http://localhost、:3000、:3001、:5173、:8000、:8888 | 200 | 200 |
| http://localhost:4173 / 4200 / 5000 / 5174 / 8080 / 8081 / 9000 / 3002 / 65535 | 200（8080、4173 已测 V1 全部端点） | **403** |
| https://localhost、https://localhost:5173 | 200 | **403** |
| http://127.0.0.1、:5173；http://[::1]:5173；http://myapp.localhost:5173 | 200 | **403** |
| null | 200 | **403** |
| 字面 `file://` | 200 | 200 |
| https://platform.minimax.io、https://www.minimax.io | 200 | 200 |
| https://example.com、https://minimax.io | 200 | **403** |
| 不带 Origin | — | **403** |

- **关于 :80 的修正**：报告原来把 `http://localhost:80` 列为 403。浏览器序列化 Origin 时会省略默认端口，实际发送 `http://localhost`，而它是 200。
- **V2 其他端点**：`/v2/h3_context_ir`、`/v2/video_regeneration`、`GET /v2/query/video_generation`（列表）、`DELETE /v2/video_generation/{id}` 从 localhost:5173 预检都是 200，从 localhost:8080 都是 403。
- **V2 的 403 响应**：`content-length: 0`，只带 `access-control-allow-origin: *`。

### 6.3 不带 Key 的实际请求
- **V1**（POST video/image、GET query/files/retrieve/retrieve_content，以及 multipart POST files/upload）：
  - 返回 HTTP 200 加 `base_resp.status_code=1004`，带 `ACAO: *`；
  - Origin 为 null 时也一样。
- **V2**（POST create、GET query）：
  - 返回 HTTP 401 加 OpenAI 风格错误体，带 `ACAO: *`；
  - Origin 为 127.0.0.1 时实际请求也带 ACAO，说明白名单只卡预检。
  - 但带 Authorization 的请求必然先发预检，所以白名单外的 Origin 实际上调不了 V2。

### 6.4 浏览器内复核【未复核】
- 调研员称：在 Chromium 里从 https://filecdn.minimax.chat 发起请求，V1 可以读到 1004，V2 报 `Failed to fetch`。
- 本次 Browser pane 导航被拒，没能复现。但这一结论和 curl 结果一致：filecdn 不在 V2 白名单里。

### 6.5 判断
- **V1 与文件接口**：预检通过，Authorization 是显式允许的。
- **V2（H3）**：只有白名单 Origin 能直连。file:// 页面发出的 Origin 实际是 `null`，会失败。
- **凭据模式**【推论，按 Fetch 规范】：`ACAO: *` 加 `ACAC: true` 时，`credentials:'include'` 的请求会被拒绝，前端应保持默认 credentials。
- **预检频率**【推论】：没有 Max-Age 时，规范缺省只缓存 5 秒，轮询时可能反复预检。
- **请求头**【推论】：ACAH 是固定列表，前端不要加列表外的自定义请求头。

## 7. 结果 URL 与浏览器展示/下载

### 7.1 image-01
- `response_format` 取值 `url`（default）或 `base64`。
- 原文 "url expires in 24 hours"。
- 返回字段：url 模式是 `data.image_urls[]`，base64 模式是 `data.image_base64[]`；另有 `metadata.success_count`/`failed_count`。
- 示例里 URL 写的是 `XXX`，**域名未给出**。
- 来源：https://platform.minimax.io/docs/api-reference/image-generation-t2i.md

### 7.2 V1 视频
- Query 成功后返回 `file_id`（**string**），同时返回 `video_width` 和 `video_height`。
- 再调 `GET /v1/files/retrieve?file_id=`（参数类型 int64）拿到 `file.download_url`，原文 "valid for 1 hour"。
- 示例里是占位符 `www.downloadurl.com`，**真实域名未给出**。
- `GET /v1/files/retrieve_content?file_id=` 原文是 "Download the contents of a generated file"，响应为 binary。它是否适用于视频输出没有逐字写明，但 CORS 预检和无 Key GET 都带 `ACAO: *`。
- 来源：
  - https://platform.minimax.io/docs/api-reference/video-generation-query.md
  - https://platform.minimax.io/docs/api-reference/video-generation-download.md
  - https://platform.minimax.io/docs/api-reference/file-management-retrieve-content.md

### 7.3 V2 视频
- `task.content.url` 原文是 "Time-limited download URL… query again to obtain a new URL after it expires"，**具体时长未说明**。
- 示例域名：
  - `video-product.cdn.minimax.io`（schema 示例）；
  - `cdn.hailuoai.com`（演示素材路径）；
  - `your-cdn.example.com`（占位）。
- 来源：https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md

### 7.4 结果媒体 CDN 实测

文档没有提到结果媒体的 CORS，也没有提到能否在 `<img>`/`<video>` 中直接显示。下面是 curl 实测：

| 域名 | 实测结果 |
|---|---|
| `video-product.cdn.minimax.io` | AliyunOSS；HEAD 200、GET Range 206；没有 ACAO；带 `content-disposition: attachment` 和 `x-oss-force-download: true`；OPTIONS 403。【推论】`fetch` 读取或 canvas 抽帧会受 CORS 阻止；`<video src>` 不设 crossOrigin 时一般可以播放（调研员称已在 Chromium 验证，本次【未复核】） |
| `cdn.hailuoai.com` | 206，带 `ACAO: *`、`access-control-allow-methods: *` |
| `filecdn.minimax.chat` | 206，带 `ACAO: *`、ACAM `*`、ACAH `*` |

## 8. 对集成平台的工程建议（均为【推论】）

1. **运行地址**：
   - 如果要直连 V2，前端放在 `http://localhost:5173` / `3000` / `8000`，或 `http://localhost`。
   - 主机名必须是 localhost，不能是 127.0.0.1，也不能用 https。
   - 白名单是未公开的行为，更稳妥的做法是用 Vite `server.proxy` 或本地小代理，把请求同源转发到 `https://api.minimax.io`。
2. **按接口代际分别处理错误**：
   - V1：同时看 HTTP 状态码（upload 可能返回 400）和 `base_resp.status_code`；
   - V2：看 HTTP 状态码和 `error` 对象；`task.error.code` 按字符串处理。
3. **ID 一律按字符串保存**：V1 Query 的 `file_id` 本来就是字符串。
4. **Key 管理**：
   - 用前缀 `sk-api-` / `sk-cp-` 提示用户 Key 类型；
   - Token Plan 和 Video Packages 不支持 H3；
   - Key 只放内存或 sessionStorage，不写进代码，也不放进 URL；
   - 官方明确反对在浏览器里暴露 Key。
5. **参考图**：
   - V1 和 image-01 用 Data URL 或公网 URL；
   - V2 可以先 `files/upload`（`purpose=video_generation_input`）再用 `mm_file://`，也可以用 Data URL，但要注意 64MB 上限。
6. **结果获取**：
   - 图像用 `response_format=base64`，避开 URL 24 小时过期和 CORS 未知的问题；
   - 视频直接 `<video src>` 播放，下载用 `<a href>`（服务端 attachment 头会触发下载）或走代理；
   - V1 视频也可以带 Key 调 `retrieve_content` 拿二进制（该接口 CORS 放行）；
   - V2 URL 过期后重新 Query。
7. **任务管理**：
   - V2 有列表接口（`page_num`、`page_size`、`filter.status`/`task_ids`/`model`/`task_type`），以及 `DELETE /v2/video_generation/{task_id}`（queued 为取消，succeeded/failed 为删除，running/cancelled 报错）；
   - `MiniMax-H3-Max` 只支持 Create 接口。
   - 来源：https://platform.minimax.io/docs/api-reference/video-generation-v2-list.md 、https://platform.minimax.io/docs/api-reference/video-generation-v2-delete.md 、https://platform.minimax.io/docs/api-reference/api-overview.md
8. **回调**：V1 和 V2 的 `callback_url` 都要求公网服务在 3 秒内原样回显 `challenge`，纯前端用不了，改用轮询（建议 10 秒间隔）。

## 参数表（核实版）

| 字段名 | 类型 | 必填 | 默认值 | 取值范围/枚举 | 适用 | 说明 | 来源URL |
|---|---|---|---|---|---|---|---|
| Authorization（header） | string | 是 | — | `Bearer <API_key>` | 全部视频、图像、文件接口 | 文档无 GroupId；Key 前缀 sk-api-（按量）、sk-cp-（订阅） | https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md ；https://platform.minimax.io/docs/m-plan/minimax-cli.md |
| Content-Type（header） | string | 是 | `application/json`（OpenAPI default） | `application/json` | V1 视频、image_generation、V2 create、files/delete | — | https://platform.minimax.io/docs/api-reference/video-generation-t2v.md |
| Content-Type（header） | string | 是 | `multipart/form-data`（OpenAPI default） | `multipart/form-data` | /v1/files/upload | — | https://platform.minimax.io/docs/api-reference/file-management-upload.md |
| purpose（form） | string | 是 | 未说明 | voice_clone / prompt_audio / t2a_async_input / video_understanding / video_generation_input | /v1/files/upload | `video_generation_input` 有效 7 天，用 `mm_file://{file_id}` 引用；不合规返回 400 | 同上 |
| file（form） | binary | 是 | — | video_generation_input：图片 jpg/jpeg/png/webp/heic/heif ≤30MB；视频 mp4/mov ≤50MB；音频 wav/mp3 ≤15MB | /v1/files/upload | — | 同上 |
| file_id（query） | int64 | 是 | — | 来自视频生成或异步 TTS 的 file_id | GET /v1/files/retrieve | 返回 `download_url`，原文 valid for 1 hour | https://platform.minimax.io/docs/api-reference/video-generation-download.md |
| file_id（query） | int64 | 是 | — | — | GET /v1/files/retrieve_content | 返回 binary | https://platform.minimax.io/docs/api-reference/file-management-retrieve-content.md |
| task_id（query） | string | 是 | — | 只能查当前账号的任务 | GET /v1/query/video_generation | 返回 `status`、`file_id`（string）、`video_width`、`video_height` | https://platform.minimax.io/docs/api-reference/video-generation-query.md |
| task_id（path） | string | 是 | — | 最近 7 天 | GET /v2/query/video_generation/{task_id} | 成功后返回 `content.url`（有时效） | https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md |
| page_num / page_size / filter.status / filter.task_ids / filter.model / filter.task_type（query） | integer / integer / string / string[] / string / string | 否 | 未说明 | status：queued/running/succeeded/failed/cancelled；task_type：generation/h3_context_ir/regeneration | GET /v2/query/video_generation | 只列近 7 天的任务 | https://platform.minimax.io/docs/api-reference/video-generation-v2-list.md |
| content[].image_url.url | string | type=image_url 时必填 | — | 公网 URL / `mm_file://{file_id}` / `data:image/<format>;base64,...` | V2（MiniMax-H3 / H3-Max） | 请求体 ≤64MB；可以引用之前输出的 file_id | https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md |
| content[].video_url.url | string | type=video_url 时必填 | — | 公网 URL / mm_file:// / `data:video/mp4;base64,...` | V2 | 只用于参考场景 | 同上 |
| content[].audio_url.url | string | type=audio_url 时必填 | — | 公网 URL / mm_file:// / `data:audio/<format>;base64,...` | V2 | 只用于参考场景 | 同上 |
| first_frame_image | string | 是（i2v） | — | 公网 URL 或 Base64 Data URL；JPG/JPEG/PNG/WebP <20MB；短边 >300px；宽高比 2:5–5:2 | V1 i2v（MiniMax-Hailuo-2.3/2.3-Fast/02、I2V-01-Director/I2V-01-live/I2V-01） | 文档未提 mm_file | https://platform.minimax.io/docs/api-reference/video-generation-i2v.md |
| first_frame_image / last_frame_image | string | `last_frame_image` 是必填；`first_frame_image` 不在 required 列表 | — | 同上 | V1 FL2V（只有 MiniMax-Hailuo-02；768P/1080P） | 分辨率跟随首帧，尾帧会被裁剪 | https://platform.minimax.io/docs/api-reference/video-generation-fl2v.md |
| subject_reference[].image | string[] | 是（在 subject_reference 内） | — | JPG/JPEG/PNG/WebP <20MB；只支持 1 张 | V1 S2V-01 | 传入方式未说明 | https://platform.minimax.io/docs/api-reference/video-generation-s2v.md |
| subject_reference[].image_file | string | 是（在 subject_reference 内） | — | 公网 URL 或 Base64 Data URL；JPG/JPEG/PNG <10MB | image i2i（model enum：image-01、image-01-live） | 每次请求只支持 1 张参考图；文档未提 mm_file | https://platform.minimax.io/docs/api-reference/image-generation-i2i.md |
| response_format | string | 否 | `url` | url / base64 | image_generation | url 24 小时过期；返回字段 `image_urls` / `image_base64` | https://platform.minimax.io/docs/api-reference/image-generation-t2i.md |
| callback_url | string | 否 | 未说明 | 需要公网服务在 3 秒内原样回显 challenge | V1 视频、V2 视频 | 回调 status 枚举 V1 和 V2 不同；纯前端不可用 | https://platform.minimax.io/docs/api-reference/video-generation-t2v.md ；https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md |

## Gaps（核查后仍未解决或新增）

### 文档未说明
- **GroupId**：国际站文档里没有，是否需要未说明。服务端 ACAH 里的 `X-Group-Id` 用途无文档。
- **CORS 政策**：文档没有任何 CORS 或浏览器直连说明。V2 的 Origin 白名单只是实测行为，完整名单未知，随时可能变。
- **结果媒体**：
  - image-01 的 `image_urls` 域名和 CORS 情况未知；
  - V1 `download_url` 的真实域名未知；
  - V2 `content.url` 的有效时长和生产域名未知，没有用真实任务验证。
- **订阅 Key 调 REST**：M Plan Subscription Key 能否直接调 REST `/v2/video_generation` 和 `/v1/image_generation`，没有明确说法。
- **Video Packages**：用哪种 Key、它的 RPM 和 Rate Limits 页的关系，都未说明。
- **限流缺项**：
  - 限流表没有列 MiniMax-H3-Max；
  - 没有 files/query/retrieve 的限流；
  - image-01 没有并发或 inflight 限制；
  - "Hailuo series" 是否包含 T2V-01/I2V-01/S2V-01 未说明。
- **旧模型资料**：About APIs FAQ 链接的 "Historical Model Pricing and Rate"（https://platform.minimax.io/docs/faq/history-modelinfo）返回 Page Not Found；国内站对应页面未查找，也没有采用。T2V-01/I2V-01/S2V-01 的价格在按量价格页上没有列出。
- **mm_file 适用范围**：`mm_file://` 能否用于 V1（i2v/fl2v/s2v）和 image-01 的参考图，未说明。
- **retrieve_content**：是否适用于视频生成输出，没有逐字写明。

### 本次未验证
- 按要求没有带真实 Key，所以以下都没测：成功路径响应的 CORS 头、multipart 上传的成功响应、浏览器内 `<video>` 播放和 fetch 失败（Browser pane 导航被拒，Safari/Firefox 也没测）。

### 其他提示
- 国际站 Speech-to-Text 指南的示例用了 `api.minimax.cn` 和 `platform.minimax.cn`，存在跨站示例混用（不属于本方向）。

## corrections
[
 {
  "claim": "§6.2 表格：Origin `http://localhost:80` 的 V2 预检返回 403（和 4173/5174/8080 等端口放在同一行）",
  "problem": "这是 curl 手工构造的字面值。浏览器序列化 Origin 时会省略默认端口，页面在 http://localhost:80 上实际发出的 Origin 是 `http://localhost`。把它列为'浏览器会失败'会误导读者。",
  "correct_fact": "实测 Origin `http://localhost`（无端口）的 V2 预检返回 200。对浏览器来说，页面跑在 http://localhost（80 端口）可以通过 V2 预检。`:80` 这一行应删除，或注明是人为构造。",
  "source_url": "实测 OPTIONS https://api.minimax.io/v2/video_generation（2026-10-07 UTC）"
 },
 {
  "claim": "V1 全系'对任意 Origin 的预检都返回 200'；'上传接口的 CORS 对任意 Origin 都放行'",
  "problem": "限定词夸大。实测只覆盖了有限的 Origin 样本，官方文档也没有任何 CORS 承诺，'任意'没有依据。",
  "correct_fact": "本次复测了约 20 个 Origin（包括 null、http://127.0.0.1:5173、http://[::1]:5173、https://example.com、http://myapp.localhost:5173、localhost 的多个端口）。V1 的 video_generation/image_generation/query/files/retrieve/files/upload/files/retrieve_content 预检全部是 200，固定返回 `ACAO: *`。只能说'所测 Origin 均通过'，不保证以后不变。",
  "source_url": "实测（不带 Key）https://api.minimax.io/v1/*"
 },
 {
  "claim": "`callback_url` 需要公网服务在 3 秒内回显 `challenge`（这条见 V1 文档）",
  "problem": "来源写得不完整。V2 Create 页的 `callback_url` 同样写明要在 3 秒内原样返回 `challenge`。另外 V1 和 V2 的回调 status 枚举不一样，报告没有区分。",
  "correct_fact": "V1 和 V2 都要求 3 秒内原样回显 `challenge`。V1 回调 `status` 的取值是 `processing`/`success`/`failed`，和 V1 Query 的 `Preparing`/`Queueing`/`Processing`/`Success`/`Fail` 也不同。V2 回调 `status` 的取值是 `queued`/`running`/`succeeded`/`failed`/`cancelled`。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md ；https://platform.minimax.io/docs/api-reference/video-generation-t2v.md"
 },
 {
  "claim": "V2 视频结果的文档示例域名：`video-product.cdn.minimax.io`（schema 示例），以及 `cdn.hailuoai.com`",
  "problem": "`cdn.hailuoai.com` 那条示例 URL 的路径是 `/prod/hailuo_demo/testsets/.../inputs/...`，属于演示素材。同一份 OpenAPI 里还出现了占位域名 `your-cdn.example.com`。这两者都不能作为生产输出域名的证据。",
  "correct_fact": "文档里只有 `GetVideoGenerationV2Resp` 的 schema 示例 `https://video-product.cdn.minimax.io/inference_output/rollout/...` 像真实的输出路径。`cdn.hailuoai.com` 是演示素材，`your-cdn.example.com` 是占位符。真实输出域名文档没有说明。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md ；https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md"
 },
 {
  "claim": "Key 分两种：Pay-as-you-go API Key、M Plan Subscription Key",
  "problem": "不完整。国际站文档还有 Token Plan（由原 Coding Plan 扩展而来）的 Subscription Key，以及只覆盖 Hailuo 的 Video Packages 计费形态。报告没有提到 Key 前缀。",
  "correct_fact": "文档中至少涉及：(1) pay-as-you-go API Key；(2) M Plan Subscription Key；(3) Token Plan Subscription Key，原文说 MiniMax H3 'not currently supported'，覆盖 image/speech。MiniMax CLI 页写明 Subscription Key 前缀是 `sk-cp-...`，pay-as-you-go API Key 前缀是 `sk-api-...`。Video Packages 只支持 Hailuo 视频模型、不支持 H3。",
  "source_url": "https://platform.minimax.io/docs/m-plan/minimax-cli.md ；https://platform.minimax.io/docs/token-plan/intro.md ；https://platform.minimax.io/docs/guides/pricing-video.md"
 },
 {
  "claim": "错误码 2013 = invalid params",
  "problem": "漏了原文的一部分。",
  "correct_fact": "2013 的原文是 'invalid params / glyph definition format error'。1004 原文末尾还有 'log in again'；2048 的解决办法写的是 prompt_audio 要 < 8s。",
  "source_url": "https://platform.minimax.io/docs/api-reference/errorcode.md"
 },
 {
  "claim": "Files Retrieve 页另外列了 1013，通用表没有收录",
  "problem": "不只 Files Retrieve 页。Video Download 页（同为 GET /v1/files/retrieve）也列了 1013。这两页对 1039 的表述是 'TPM limit triggered'，通用表写的是 'token limit'。",
  "correct_fact": "1013 'Internal service error' 同时出现在 file-management-retrieve.md 和 video-generation-download.md，通用错误码表里没有。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video-generation-download.md ；https://platform.minimax.io/docs/api-reference/file-management-retrieve.md"
 },
 {
  "claim": "图像接口是 `/v1/image_generation`（`image-01`）",
  "problem": "漏了模型枚举。",
  "correct_fact": "i2i 页 OpenAPI 的 `model` enum 是 `image-01`、`image-01-live`（描述文字只写了 image-01）；t2i 页 enum 只有 `image-01`。另外 `width`/`height` 原文写 'Only effective for image-01'。",
  "source_url": "https://platform.minimax.io/docs/api-reference/image-generation-i2i.md"
 },
 {
  "claim": "V1（视频、图像、文件）失败时 HTTP 仍为 200，要看 `base_resp.status_code`",
  "problem": "作为对 V1 全族的笼统结论不准确。Upload 文档明确写了规格不合规返回 400。",
  "correct_fact": "缺 Key 时实测为 HTTP 200 加 `base_resp.status_code=1004`（V1 视频、图像、query、files/retrieve、files/retrieve_content、files/upload 都是这样）。但 `/v1/files/upload` 对 `video_generation_input` 的原文是 'invalid files are rejected with 400 and not retained'。前端要同时处理 HTTP 状态码和 `base_resp`。",
  "source_url": "https://platform.minimax.io/docs/api-reference/file-management-upload.md"
 },
 {
  "claim": "§6.4 浏览器复核（从 filecdn.minimax.chat 发 fetch）；§7 `<video>` 拿到 loadedmetadata（2528×1440，8 秒），`crossOrigin` 报 error 4，fetch 报 Failed to fetch",
  "problem": "本次核查无法复现：Browser pane 导航被拒。另外，文档里该示例 URL 所在的示例任务写的是 resolution 2K、duration 5，和报告的'8 秒'对不上，说明示例 URL 和示例任务未必对应。",
  "correct_fact": "只能确认 curl 层面的事实：`video-product.cdn.minimax.io` 的 HEAD/GET（Range）返回 200/206，`server: AliyunOSS`，带 `content-disposition: attachment` 和 `x-oss-force-download: true`，没有任何 ACAO；OPTIONS 返回 403。浏览器里 `<video>` 能播、fetch 失败，属于调研员的单方实测，本次未复核。",
  "source_url": "实测 https://video-product.cdn.minimax.io/inference_output/rollout/2026-07-27/6c68f487-4b33-48cb-8c92-1631f63f6682/output.mp4"
 },
 {
  "claim": "V2 任务失败返回 `task.error{code,message}`",
  "problem": "没有写类型。",
  "correct_fact": "`VideoTaskError.code` 的类型是 string（示例 '1026'），不是整数，前端比较时要注意。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video-generation-v2-query.md"
 }
]

## missing_items
- Key 前缀：MiniMax CLI 页写明 Subscription Key 是 `sk-cp-...`、pay-as-you-go API Key 是 `sk-api-...`，两者分开计费。前端可以按前缀提示用户 Key 类型。https://platform.minimax.io/docs/m-plan/minimax-cli.md
- Token Plan Subscription Key（老订阅；原文称 Token Plan 'extends upon our former Coding Plan'）：MiniMax H3 'not currently supported'，覆盖 image/speech；Token Plan Credits 同样不支持 H3。https://platform.minimax.io/docs/token-plan/intro.md 、https://platform.minimax.io/docs/token-plan/faq.md
- Video Packages：只支持 Hailuo 视频模型（'MiniMax H3 is not supported yet'），支持 Video Generation API，各档 RPM 分别为 20/30/40/50（Standard/Pro/Scale/Business）；失败任务不扣点。和 Rate Limits 页的 'Hailuo series 20 RPM' 是什么关系，文档没有说明。https://platform.minimax.io/docs/guides/pricing-video.md 、https://platform.minimax.io/docs/pricing/overview.md
- 国际站文档里还有一个 API 主机 `www.minimax.io`：M Plan 额度查询 `GET https://www.minimax.io/v1/token_plan/remains`（Bearer）。实测从 localhost:5173 预检返回 200、`ACAO: *`。https://platform.minimax.io/docs/m-plan/faq.md
- 首尾帧接口 FL2V（`/v1/video_generation`，model 只有 `MiniMax-Hailuo-02`）：required 是 `model` 和 `last_frame_image`；`first_frame_image`/`last_frame_image` 都是公网 URL 或 Base64 Data URL，JPG/JPEG/PNG/WebP，<20MB，短边 >300px，宽高比 2:5–5:2；视频分辨率跟随首帧，尾帧尺寸不同会被裁剪；只支持 768P/1080P（不支持 512P）。报告的参考图写法表里漏了这个接口。https://platform.minimax.io/docs/api-reference/video-generation-fl2v.md
- image-01 的 i2i 每次请求只支持一张参考图（图像指南原文 'Only a single reference image is supported per request'）；`subject_reference[].type` 目前只有 `character`。https://platform.minimax.io/docs/guides/image-generation.md 、https://platform.minimax.io/docs/api-reference/image-generation-i2i.md
- S2V 的 `subject_reference[].image` 是字符串数组，但原文写 'only one image supported'；`type` 目前只有 `character`。https://platform.minimax.io/docs/api-reference/video-generation-s2v.md
- 图像结果字段名：url 模式返回 `data.image_urls[]`，base64 模式返回 `data.image_base64[]`；`metadata.success_count`/`failed_count`（failed 指被内容安全拦截的张数）。https://platform.minimax.io/docs/api-reference/image-generation-t2i.md
- V1 Query 返回的 `file_id` 类型是 string，而 `/v1/files/retrieve` 的 `file_id` 参数类型是 int64。前端应按字符串保存（推论）。https://platform.minimax.io/docs/api-reference/video-generation-query.md 、https://platform.minimax.io/docs/api-reference/video-generation-download.md
- V2 `image_url.url` 的 `mm_file://{file_id}` 可以引用上传文件，也可以引用 'a previous output's file_id'（之前生成结果的 file_id），可用于链式生成。https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md
- V2 列表与取消/删除接口（前端任务列表 UI 需要）：`GET /v2/query/video_generation` 参数有 `page_num`、`page_size`、`filter.status`、`filter.task_ids`、`filter.model`、`filter.task_type`，只返回近 7 天的任务；`DELETE /v2/video_generation/{task_id}`：queued 状态为取消，succeeded/failed 为删除记录，running/cancelled 返回错误。https://platform.minimax.io/docs/api-reference/video-generation-v2-list.md 、https://platform.minimax.io/docs/api-reference/video-generation-v2-delete.md
- MiniMax-H3-Max 只支持 Create Video Generation Task 接口，不支持 H3-Context-IR 和 Regeneration。https://platform.minimax.io/docs/api-reference/api-overview.md
- 视频指南：混合输入总数最多 12 个文件；Base64 会让体积膨胀约 33%，请求体总量 ≤64MB。https://platform.minimax.io/docs/guides/video-generation.md 、https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md
- M Plan 的限流原文：'Requests may be throttled when exceeded, typically recovering within about one minute. Limits may tighten during peak traffic'，高峰期有动态限流。https://platform.minimax.io/docs/m-plan/faq.md
- M Plan 订阅 Key 调用 API 的佐证：FAQ 说 'API endpoints with pay-as-you-go pricing deduct from included M Plan usage at the corresponding endpoint price'；CLI 页说订阅后可以用 `mmx video generate`、`mmx image generate`。但都没有点名 REST 路径 `/v2/video_generation`，所以这一项仍是 gap。
- About APIs FAQ 链接的 'Historical Model Pricing and Rate'（/docs/faq/history-modelinfo）在国际站返回 Page Not Found，旧模型（T2V-01/I2V-01/S2V-01 等）的价格和限流无法核实；按量价格页的 Legacy 栏只列了 Hailuo-2.3/2.3-Fast/02。
- CORS 的 `Access-Control-Allow-Headers` 是固定列表。前端如果额外加了列表外的自定义请求头，预检会失败（规范推论）。
- bearerAuth 的 `bearerFormat` 写的是 JWT，但实际 Key 前缀是 sk-api-/sk-cp-。前端不要对 Key 做 JWT 格式校验（推论）。

## gaps
- GroupId：国际站文档全文（llms-full.txt 与视频 V1/V2、图像、文件 4 个 OpenAPI JSON）都没有出现 GroupId/group_id，是否需要没有说明。实测缺 Key 时的报错只要求 Authorization；服务端 Access-Control-Allow-Headers 里有 X-Group-Id，但用途没有文档。
- V2（/v2/*，MiniMax-H3）预检有 Origin 白名单（实测通过：http://localhost、localhost:3000/3001/5173/8000/8888、https://platform.minimax.io、https://www.minimax.io、字面 file://；127.0.0.1、[::1]、*.localhost、https、null 及其他端口都返回 403）。这只是实测行为，文档未说明，完整白名单未知，随时可能变化。
- 文档没有说明任何 CORS 或浏览器直连政策；About APIs FAQ 反而明确建议不要在浏览器或客户端代码里暴露 API Key。
- image-01 返回的 image_urls 域名文档没有给出（示例是 XXX），其 CORS 情况未知；只写了 url 24 小时过期。
- V1 视频 files/retrieve 返回的 download_url 真实域名文档没有给出（示例是占位符 www.downloadurl.com），只写了有效 1 小时。
- V2 content.url 的具体有效时长没有说明（只说 time-limited，过期后重新 query）。生产环境实际域名只能从文档示例推测（video-product.cdn.minimax.io、cdn.hailuoai.com），没有用真实任务验证。
- M Plan Subscription Key 能否调用 REST /v2/video_generation 和 /v1/image_generation：M Plan FAQ 说 Explore/Build 档含 H3、三档都含图像，但视频指南写着 To use MiniMax H3 or MiniMax H3 Max, please select the Pay-as-you-go API，两处表述有张力，没有找到明确说明。
- 限流表没有单列 MiniMax-H3-Max，也没有给出 files/upload、query、retrieve 等端点的限流；image-01 没有给出并发或 inflight 限制。
- mm_file://{file_id} 能否用于 V1（Hailuo/I2V/S2V）的 first_frame_image、subject_reference，以及 image-01 的 subject_reference.image_file：文档没有说明，这些字段只写了公网 URL 或 Base64 Data URL（S2V 连传入方式都没写）。
- 通用错误码表没有收录 1013（只在 Files Retrieve 页出现）；V1 接口失败时 HTTP 状态码为 200 是实测结果，文档没有明确写。
- 按要求没有带真实 Key 测试成功路径（带 Authorization 的 200 响应）的 CORS 头和 multipart 上传的实际响应；Content-Disposition: attachment 不影响 <video> 播放只在 Chromium 内核里验证过，Safari/Firefox 未测。
- 国际站 Speech-to-Text 页的代码示例用的是 api.minimax.cn（国内站域名），说明文档存在跨站示例混用（不属于本方向，仅提示）。本方向所需的国际站页面都能正常读取，没有用国内站页面替代。