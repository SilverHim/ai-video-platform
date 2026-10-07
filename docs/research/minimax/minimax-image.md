我核对了调研员的 MiniMax 图像生成报告，大部分内容和国际站官方原文一致；有 8 处需要更正或补出处，另有十几项对表单设计有用的内容报告里漏了。下面是更正后的完整报告。

# MiniMax 国际站：图像生成 API 合约与模型能力（核查修订版）

**核查范围**：只用 platform.minimax.io 官方文档，包括：
- T2I 和 I2I 的 API Reference（.md 页及其内嵌 OpenAPI，并用原始 JSON 交叉比对）
- 图像生成指南（Guide）
- API Overview
- MCP Guide
- Rate Limits、Pay as You Go、Pricing Overview
- Error Codes、About APIs FAQ
- M Plan FAQ、Token Plan 定价页
- Release Notes（APIs、Models）
- llms.txt 与 llms-full.txt 全文检索

没有用国内站内容，也没有发出任何带 Key 或会计费的请求。文中【推断】表示官方没有明文、由原文推导得出；【未说明】表示文档没写。

**主要来源**
- T2I：https://platform.minimax.io/docs/api-reference/image-generation-t2i.md （原始 JSON：https://platform.minimax.io/docs/api-reference/image/generation/api/text-to-image.json ）
- I2I：https://platform.minimax.io/docs/api-reference/image-generation-i2i.md （原始 JSON：https://platform.minimax.io/docs/api-reference/image/generation/api/image-to-image.json ）
- 指南：https://platform.minimax.io/docs/guides/image-generation.md
- 总览：https://platform.minimax.io/docs/api-reference/api-overview.md
- 另外 https://platform.minimax.io/docs/api-reference/image/generation/api/openapi.json 的 paths 和 schemas 都是空的，只有 securitySchemes，没有额外信息。

---

## 1. 接口方法与 URL

| 项 | 内容 | 来源 |
|---|---|---|
| 方法 + URL | `POST https://api.minimax.io/v1/image_generation`。T2I 和 I2I 两份 OpenAPI 的 servers.url（`https://api.minimax.io`）、path（`/v1/image_generation`）、operationId（`imageGeneration`）完全相同。【推断】实际是同一个端点，I2I 模式靠请求体里的 `subject_reference` 体现 | T2I / I2I OpenAPI |
| 鉴权 | `Authorization: Bearer <API_key>`。securityScheme 为 http bearer，bearerFormat 标为 `JWT`。Key 在 Account Management > API Keys 获取 | T2I / I2I OpenAPI securitySchemes |
| 必需请求头 | `Content-Type: application/json`（header 参数 required: true，enum 只有 `application/json`，default `application/json`） | T2I / I2I OpenAPI |
| 返回方式 | 200 响应体直接包含 `data.image_urls` 或 `data.image_base64`。图像文档里没有任务查询、回调或下载端点。Guide 示例直接取 `response.json()["data"]["image_base64"]`。但 API Overview 原文写的是 "You can generate images by creating an image generation task"，用了 task 一词，同时没有给出任务 ID 或查询接口。【推断】可以按直接返回结果来实现 | Guide；API Overview |
| HTTP 响应定义 | OpenAPI 只定义了 `200`。业务成败看 `base_resp.status_code`。非 200 的 HTTP 状态：【未说明】 | T2I / I2I 原始 JSON |

**安全提示（原文）**：About APIs FAQ 写明，不要分享 API Key，也不要 "expose it in the browser or other client-side code"；公开泄露的 Key 可能被自动禁用。本机浏览器前端在设计上需要考虑这一点，比如走本地代理。来源：https://platform.minimax.io/docs/faq/about-apis.md
CORS：文档【未说明】。llms-full.txt 全文搜索 CORS / cross-origin 没有结果。

---

## 2. 请求体参数表

T2I schema 的字段：model, prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer。两份 schema 的 required 都只有 `prompt` 和 `model`。
I2I schema 在 T2I 基础上多了 `subject_reference`，`model` 的 enum 多了 `image-01-live`。
两份 schema 都没有 `style`（及 style_type、style_weight）、`aigc_watermark`、`negative_prompt`。在 llms-full.txt 全文搜索这些词也没有结果。

| 字段名 | 类型 | 必填 | 默认值 | 取值范围 / 枚举 | 适用模型 | 说明 | 来源 |
|---|---|---|---|---|---|---|---|
| `model` | string | 是 | 【未说明】（API schema 无 default。MCP 工具的默认值 "image-01" 不能当作 API 默认值） | T2I enum：`image-01`。I2I enum：`image-01`、`image-01-live`，但 I2I 的 description 仍写 "Options: `image-01`."，前后不一致 | — | 模型名 | T2I / I2I |
| `prompt` | string | 是 | 【未说明】 | max length 1500 characters（多字节字符如何计数【未说明】） | 两者 | 图像的文本描述 | T2I / I2I |
| `subject_reference` | array of `ImageSubjectReference` | 否（只出现在 I2I schema，不在 required 里） | 【未说明】 | 数组，没写 maxItems。Guide 正文写 "Only a single reference image is supported per request." | I2I schema 中的 image-01 / image-01-live | "Subject reference for image-to-image generation." | I2I；Guide |
| `subject_reference[].type` | string | 是（子对象 required） | 【未说明】 | schema 没有 enum。description 写 "Currently only supports `character` (portrait)." | 同上 | 主体类型 | I2I |
| `subject_reference[].image_file` | string | 是（子对象 required） | 【未说明】 | 公网 URL，或 Base64 Data URL（原文示例为 `data:image/jpeg;base64,...`）。格式 JPG/JPEG/PNG，大小 less than 10MB | 同上 | 参考图。原文建议 "upload a single front-facing portrait photo" | I2I |
| `aspect_ratio` | string | 否 | description 写 default `1:1`（schema 没有 default 关键字） | `1:1`(1024x1024)、`16:9`(1280x720)、`4:3`(1152x864)、`3:2`(1248x832)、`2:3`(832x1248)、`3:4`(864x1152)、`9:16`(720x1280)、`21:9`(1344x576) | 两份 schema 都有 | 宽高比，括号里是原文给出的对应像素 | T2I / I2I |
| `width` | integer | 否；"Must be set together with `height`" | 【未说明】 | Range [512, 2048]，must be divisible by 8 | "Only effective for `image-01`" | 图像宽（px）。与 aspect_ratio 同时提供时 "`aspect_ratio` takes priority" | T2I / I2I |
| `height` | integer | 否；必须和 width 一起设置 | 【未说明】 | 同 width（I2I 原文写 "Same rules as `width`."） | 只对 image-01 生效 | 图像高（px） | T2I / I2I |
| `response_format` | string | 否 | `url` | `url`、`base64` | 两者 | "⚠️ Note: url expires in 24 hours." | T2I / I2I |
| `seed` | integer（format int64） | 否 | 不传则随机 | 范围【未说明】 | 两者 | 相同 seed 和参数可以复现。T2I 原文：不传时 "a random seed is generated for each image"。I2I 原文：不传时 "each of the n images will use a unique random seed" | T2I / I2I |
| `n` | integer | 否 | `1` | minimum 1，maximum 9 | 两者 | 每次请求生成几张图 | T2I / I2I |
| `prompt_optimizer` | boolean | 否 | `false` | true / false | 两者 | 是否自动优化提示词 | T2I / I2I |

### 约束与优先级
- width 和 height 必须成对，范围 [512, 2048]，能被 8 整除，只对 image-01 生效。width/height 与 aspect_ratio 同时出现时，aspect_ratio 优先（原文）。来源：T2I / I2I
- 以下错误用法会报错还是被忽略，都【未说明】：只传一个、越界、不能被 8 整除、对 image-01-live 传 width/height。前端应提前校验，或做成互斥：选自定义尺寸就不发 aspect_ratio。
- width/height 于 Apr. 25, 2025 加给 image-01（"Added width and height parameters to the image-01 model"）。来源：https://platform.minimax.io/docs/release-notes/apis.md
- 默认值不要搞混：MCP Guide 的 text_to_image 工具表把 prompt_optimizer 的默认值写成 True，model 默认写成 "image-01"。这些是 MCP 工具的默认值，HTTP API 的 OpenAPI 写的是 prompt_optimizer 默认 `false`，model 没有默认值。来源：https://platform.minimax.io/docs/guides/mcp-guide.md

---

## 3. 文生图和图生图的区别

| 维度 | T2I | I2I（主体参考） |
|---|---|---|
| 端点 | POST /v1/image_generation | 同一个 |
| OpenAPI model enum | `image-01` | `image-01`、`image-01-live` |
| subject_reference | schema 里没有 | 有：`[{type:"character", image_file:"<URL 或 Data URL>"}]` |
| 用途（Guide 原文要点） | 按文字描述生成 | 提供一张主体清晰的参考图（可以是在线 URL），配合提示词生成新图，保留主体的关键特征。适合同一个虚拟角色放到不同场景这类需要视觉身份一致的需求 |
| 参考图数量 | — | 每次请求只支持一张（Guide） |
| 主体类型 | — | 目前只支持 character（portrait） |

来源：https://platform.minimax.io/docs/guides/image-generation.md ；I2I OpenAPI。
API Overview 对 image-01 的描述："Supports both text-to-image and image-to-image generation (with subject reference for people)."

---

## 4. 模型清单与能力

| 精确 model 字符串 | 出现位置 | 能力 / 参数子集 | 来源 |
|---|---|---|---|
| `image-01` | API Overview 模型表（唯一列出的图像模型）、T2I/I2I enum、定价、限流、Release Notes | T2I 和 I2I（人物主体参考）都支持。width/height 只对它生效 | API Overview；T2I；I2I |
| `image-01-live` | I2I OpenAPI 的 model enum；MCP Guide 的 **text_to_image** 工具表（允许 ["image-01", "image-01-live"]） | T2I OpenAPI enum 里没有它，而 MCP 的文生图工具允许它，**两处冲突**，能否用于纯文生图需要联调确认。width/height 写明只对 image-01 生效，【推断】image-01-live 不支持自定义宽高。用途和风格文档都【未说明】。API Overview、定价、限流表都没有列它 | I2I；https://platform.minimax.io/docs/guides/mcp-guide.md |

- 风格设置（style 对象、style_type、style_weight 等）：国际站图像 API 文档里没有。
- Image-01 发布于 Feb. 15, 2025，原文说它支持多尺寸文生图（"text-to-image generation in multiple sizes"）。来源：https://platform.minimax.io/docs/release-notes/models.md
- 模型总览页 https://platform.minimax.io/docs/guides/models-intro.md 没有列图像模型。

---

## 5. 参考图输入限制
- 方式：公网 URL，或 Base64 Data URL（原文示例 `data:image/jpeg;base64,...`。PNG 对应的 MIME 写法【未说明】）
- 格式：JPG、JPEG、PNG
- 大小：less than 10MB。这个限制针对原始文件还是 Base64 字符串【未说明】
- 建议：单张正面人像照
- 数量：每次请求一张（Guide 正文）。OpenAPI 里 subject_reference 是 array，没写 maxItems
- 分辨率、最小边长、宽高比、透明通道：【未说明】

来源：I2I OpenAPI 的 ImageSubjectReference；Guide。

---

## 6. 响应结构

```
{
  "id": "<Trace ID>",
  "data": {
    "image_urls":   [string],   // response_format=url 时返回
    "image_base64": [string]    // response_format=base64 时返回
  },
  "metadata": {
    "success_count": integer,   // Number of successfully generated images
    "failed_count":  integer    // Number of images blocked due to content safety
  },
  "base_resp": { "status_code": integer, "status_msg": string }
}
```

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id` | string | Trace ID for request tracking | T2I / I2I |
| `data.image_urls` | string[] | response_format = url 时返回 | T2I / I2I |
| `data.image_base64` | string[] | response_format = base64 时返回 | T2I / I2I |
| `metadata.success_count` | integer | 成功生成的数量 | T2I / I2I |
| `metadata.failed_count` | integer | 因内容安全被拦截的数量 | T2I / I2I |
| `base_resp.status_code` | integer | 0 表示成功，其余见第 8 节 | T2I / I2I |
| `base_resp.status_msg` | string | 状态详情 | T2I / I2I |

- 类型不一致：schema 写 integer，但官方 example 返回的是字符串（`failed_count: '0'`、`success_count: '3'`）。前端解析时建议统一做一次 `Number()`。
- 【推断】有 failed_count 说明一次请求可能只成功一部分，返回数组的长度可能小于 n。文档没有明说。

---

## 7. 结果 URL 有效期与输出格式
- url 24 小时后过期（"url expires in 24 hours"）。来源：T2I / I2I 的 response_format 描述。
- 输出图片的编码格式（jpeg/png）【未说明】。Guide 示例把结果存成 `output-{i}.jpeg`，这只是示例。
- base64 模式下单张图或整个响应的大小上限【未说明】。

---

## 8. 错误码

### 图像 API schema 里列出的 base_resp.status_code
| 码 | 原文要点 |
|---|---|
| 0 | Request successful |
| 1002 | Rate limit triggered, please try again later |
| 1004 | Account authentication failed, please check if the API Key is correct |
| 1008 | Insufficient account balance |
| 1026 | Sensitive content detected in prompt |
| 2013 | Invalid input parameters |
| 2049 | Invalid API Key |

来源：T2I / I2I OpenAPI 的 BaseResp。

### 通用错误码页（全平台通用，不针对图像 API）
| 码 | Message | Solution（原文要点） |
|---|---|---|
| 1000 | unknown error | 稍后重试 |
| 1001 | request timeout | 稍后重试 |
| 1004 | not authorized / token not match group / cookie is missing, log in again | 检查 API Key |
| 1024 | internal error | 稍后重试 |
| 1026 | input new_sensitive | 修改输入内容 |
| 1027 | output new_sensitive | 修改输入内容 |
| 1033 | system error / mysql failed | 稍后重试 |
| 1039 | token limit | 稍后重试 |
| 1041 | conn limit | 问题持续则联系官方 |
| 1042 | invisible character ratio limit | 检查输入里的不可见或非法字符 |
| 2013 | invalid params / glyph definition format error | 检查请求参数 |
| 2045 | rate growth limit | 避免请求量骤增骤减 |
| 2056 | usage limit exceeded | "wait for the resource release in the next 5-hour window"。原文没有写适用于哪种 Key。【推断】和 M Plan / Token Plan 的 5 小时窗口有关 |

来源：https://platform.minimax.io/docs/api-reference/errorcode.md

---

## 9. 限流、价格与 Key 类型
- 限流：Rate Limits 页说 "The rate limits applied to your account depend on the model and interface you use"。Image Generation / image-01 为 10 RPM（图像部分没有 Max inflight tasks 列）。来源：https://platform.minimax.io/docs/guides/rate-limits.md
- 按量付费：image-01 每张 $0.0035。来源：https://platform.minimax.io/docs/guides/pricing-paygo.md ；https://platform.minimax.io/docs/pricing/overview.md
- image-01-live 的价格和限流：【未说明】。
- Key 类型：按量付费 API Key 和 Subscription Key 是分开的，"cannot be used interchangeably"。M Plan FAQ 写："API endpoints with pay-as-you-go pricing deduct from included M Plan usage at the corresponding endpoint price"。三个档位都包含 image 生成，图像与文本、音频共用额度，受 5 小时窗口和周窗口限制。Token Plan 定价页写 "Supported text, image, and speech resources share one quota"。但这些页面都没有明确点名 /v1/image_generation 能否用 Subscription Key 调用，需要联调确认。来源：https://platform.minimax.io/docs/m-plan/faq.md ；https://platform.minimax.io/docs/guides/pricing-token-plan.md ；https://platform.minimax.io/docs/api-reference/api-overview.md

---

## 10. 请求示例（未实际调用）

T2I（官方 example 原样）：
```json
{"model":"image-01","prompt":"...","aspect_ratio":"16:9","response_format":"url","n":3,"prompt_optimizer":true}
```

I2I（官方 example 原样）：
```json
{"model":"image-01","prompt":"A girl looking into the distance from a library window","aspect_ratio":"16:9","subject_reference":[{"type":"character","image_file":"https://cdn.hailuoai.com/prod/2025-08-12-17/video_cover/1754990600020238321-411603868533342214-cover.jpg"}],"n":2}
```

自定义尺寸（**自拟示例，官方没有**，按规则构造：只用 image-01，不同时发 aspect_ratio）：
```json
{"model":"image-01","prompt":"...","width":1024,"height":1536}
```

---

## 11. 前端实现建议（由上述事实推出，属于设计选择）
- 模型下拉：保守做法是 T2I 只放 image-01，I2I 放 image-01 和 image-01-live。但 MCP 文生图工具允许 image-01-live，可以把它在 T2I 中做成「实验/需验证」选项。选了 image-01-live 就禁用 width/height。
- 尺寸控件：「预设比例」和「自定义宽高」二选一。自定义宽高要成对、在 512–2048 之间、能被 8 整除。都不填时按 description 默认 1:1（1024x1024）。
- 参考图：限 1 张，JPG/JPEG/PNG，小于 10MB。可以填公网 URL，或转成 Data URL。type 固定为 character，并提示用户「仅人像主体」。
- 结果：url 模式要提示 24 小时过期，建议立即下载或缓存。用 metadata.failed_count 提示被安全拦截的张数，计数字段先做 Number() 转换。
- 错误：以 base_resp.status_code 为准，HTTP 200 不代表成功。按码给出可读提示。
- Key：区分按量付费 API Key 和 Subscription Key。建议走本地代理，不把 Key 暴露在浏览器里（FAQ 原文的建议）。

---

## 12. Gaps（未核实、文档未写）
- image-01-live：T2I OpenAPI enum 没有它，MCP 的 text_to_image 工具却允许它，能否文生图有冲突。用途、风格、价格、限流都【未说明】。
- 没有 style、aigc_watermark、negative_prompt 等字段。
- 没有写明的默认值和范围：model 默认值、width/height 默认值、seed 取值范围。prompt 1500 字符的计数方式。
- width/height 错误用法（只传一个、越界、非 8 倍数、用于 image-01-live）是报错还是被忽略，未说明。
- 参考图的分辨率、宽高比、透明通道限制；PNG 的 Data URL MIME 写法；10MB 针对原始文件还是 Base64 字符串，都未说明。
- 输出编码格式、base64 响应大小上限，未说明。
- 非 200 的 HTTP 状态码会不会出现、长什么样，未说明。
- metadata 计数字段的实际类型（schema 写 integer，example 是字符串），需要联调。
- 部分成功时返回数组的长度行为，未说明。
- CORS 未说明。
- Subscription Key 能否调用 /v1/image_generation，没有点名说明。
- API Overview 用了 "task" 一词，但没有任务查询接口，含义未说明。
- 国际站 /docs/faq/history-modelinfo（About APIs FAQ 链接的历史模型价格与限流页）返回 404。猜测的国内站对应页 https://platform.minimaxi.com/docs/faq/history-modelinfo.md 也返回 404，未使用国内站任何内容。

## corrections
[
 {
  "claim": "错误码 2056 usage limit exceeded：等下一个 5 小时窗口释放（订阅 Key 场景）",
  "problem": "括号里的「订阅 Key 场景」在错误码页原文里没有，是调研员根据 M Plan FAQ 中的 5 小时窗口概念自己加上去的关联。",
  "correct_fact": "错误码页原文只有一句：Please wait for the resource release in the next 5-hour window. 没有说明这个码适用于哪种 Key 或哪个 API。5 小时窗口的概念出现在 M Plan FAQ 中，两者的关联属于推断。",
  "source_url": "https://platform.minimax.io/docs/api-reference/errorcode.md"
 },
 {
  "claim": "image-01-live 只出现在 I2I schema 的 model enum 和 MCP Guide 的工具表里（报告第 11 节据此建议：T2I 模式只放 image-01）",
  "problem": "出处本身没错，但漏了关键细节：image-01-live 出现在 MCP Guide 的 text_to_image（文生图）工具表里，可选值为 [\"image-01\", \"image-01-live\"]，默认 \"image-01\"。这与 T2I OpenAPI 的 enum（只有 image-01）互相冲突，报告没有揭示。所以「T2I 只放 image-01」只是按 OpenAPI 做的保守选择，不能当作文档定论。",
  "correct_fact": "T2I OpenAPI 的 model enum 只有 image-01。I2I OpenAPI 的 enum 是 image-01 和 image-01-live，但 description 仍写 Options: image-01。MCP Guide 的 text_to_image 工具允许 image-01-live。image-01-live 能否用于纯文生图，各文档说法冲突，需要联调确认。",
  "source_url": "https://platform.minimax.io/docs/guides/mcp-guide.md"
 },
 {
  "claim": "调用方式：图片直接在响应里返回，文档没有出现「同步」这个词",
  "problem": "漏掉了相反方向的措辞：API Overview 原文写的是 \"You can generate images by creating an image generation task\"，用了 task 一词。同步返回的结论只来自 schema 和 Guide 示例的推断。",
  "correct_fact": "OpenAPI 的 200 响应直接包含 data.image_urls/image_base64，图像文档中没有任何查询任务的端点。API Overview 用了 \"image generation task\" 的说法，但没有给出任务 ID 或查询接口。可以按直接返回结果来实现，同时应注明这是推断。",
  "source_url": "https://platform.minimax.io/docs/api-reference/api-overview.md"
 },
 {
  "claim": "T2I 和 I2I 共用一个端点，靠是否传 subject_reference 区分",
  "problem": "文档没有明文说「靠是否传 subject_reference 区分」。原文只能看出两份 OpenAPI 的 path 和 operationId 相同，而 I2I schema 多了 subject_reference 字段。",
  "correct_fact": "两份 OpenAPI 的路径都是 POST /v1/image_generation，operationId 都是 imageGeneration。subject_reference 只出现在 I2I schema 中，且不是 required（required 只有 prompt 和 model）。「是否传 subject_reference 决定模式」属于合理推断，并非原文。",
  "source_url": "https://platform.minimax.io/docs/api-reference/image-generation-i2i.md"
 },
 {
  "claim": "failed_count 只解释为因内容安全被拦截，意味着一次请求可能部分成功，返回数组长度可能小于 n",
  "problem": "「可能部分成功、数组长度小于 n」是推断，原文没写，报告也没标成推断。",
  "correct_fact": "原文只写 failed_count: Number of images blocked due to content safety，success_count: Number of successfully generated images。部分成功时数组长度如何变化，文档未说明。",
  "source_url": "https://platform.minimax.io/docs/api-reference/image-generation-t2i.md"
 },
 {
  "claim": "第 10 节「最小请求示例（按官方示例整理）」中的自定义尺寸示例 {\"model\":\"image-01\",\"prompt\":\"...\",\"width\":1024,\"height\":1536}",
  "problem": "官方文档没有 width/height 的示例。这个示例是调研员按规则自己构造的，却被归在「按官方示例整理」里。",
  "correct_fact": "T2I 和 I2I 的官方 example 都只用了 aspect_ratio，没有 width/height。1024x1536 符合 [512, 2048] 且能被 8 整除的规则，但它是自拟示例。",
  "source_url": "https://platform.minimax.io/docs/api-reference/image-generation-t2i.md"
 },
 {
  "claim": "aspect_ratio 默认 1:1；subject_reference[].type 目前只支持 character",
  "problem": "措辞需要更精确。aspect_ratio 的默认值只写在 description 文本里（\"default `1:1`\"），schema 没有 default 关键字，而 response_format、n、prompt_optimizer 都有。type 字段在 schema 里没有 enum，只在 description 里写了 Currently only supports `character`。",
  "correct_fact": "aspect_ratio：description 写 default 1:1，有 enum，无 default 关键字。type：string，无 enum，description 写目前只支持 character（portrait）。前端可以把它固定为 character，但应注明这一点来自描述文本。",
  "source_url": "https://platform.minimax.io/docs/api-reference/image-generation-i2i.md"
 },
 {
  "claim": "Subscription Key 能否直接调用 /v1/image_generation，图像 API 页没有说明",
  "problem": "这句话属实，但遗漏了 M Plan FAQ 中相关的原文，也没有提到同样使用 Subscription Key 的 Token Plan 文档。",
  "correct_fact": "M Plan FAQ 写明：Subscription Key 与按量付费 API Key \"cannot be used interchangeably\"；\"API endpoints with pay-as-you-go pricing deduct from included M Plan usage at the corresponding endpoint price\"；Subscription Key 可用于 \"Any AI tool that supports the OpenAI-compatible or Anthropic-compatible protocol\"。Token Plan 定价页写 \"Supported text, image, and speech resources share one quota\"（通过 Subscription Key）。两处都没有明确点名 /v1/image_generation，仍需联调确认。",
  "source_url": "https://platform.minimax.io/docs/m-plan/faq.md"
 }
]

## missing_items
- MCP Guide 的 text_to_image 工具表允许 model=image-01-live（默认 image-01），与 T2I OpenAPI 的 enum 冲突（https://platform.minimax.io/docs/guides/mcp-guide.md）
- API Overview 原文：This API supports images generations from text or references, allowing custom aspect ratios and resolutions；You can generate images by creating an image generation task（https://platform.minimax.io/docs/api-reference/api-overview.md）
- API Overview 的模型表只列了 image-01，描述为 Supports both text-to-image and image-to-image generation (with subject reference for people)，没有列 image-01-live
- 只传 width 或只传 height、对 image-01-live 传 width/height、width/height 超出范围或不能被 8 整除时，会报错还是被忽略：文档均未说明
- aspect_ratio 和 width/height 都不传时的输出尺寸：按 description 默认 1:1（对应 1024x1024），schema 没有 default 关键字
- PNG 参考图对应的 Data URL MIME 写法未说明（原文示例只有 data:image/jpeg;base64,...）；10MB 限制针对原始文件还是 Base64 字符串，未说明
- prompt 最长 1500 characters，中文等多字节字符如何计数未说明
- seed 只标了 format int64，取值范围和负数是否允许未说明
- Rate Limits 页说明限流按账号计（The rate limits applied to your account depend on the model and interface you use），image-01 为 10 RPM；图像部分没有 Max inflight tasks 列（视频部分有）
- Token Plan 文档（与 M Plan 并列）写图像资源与文本、语音共用额度（https://platform.minimax.io/docs/guides/pricing-token-plan.md）
- 图像 API 没有回调/webhook，没有任务查询端点，也没有结果下载端点（Retrieve Content/File 接口是否适用于图像，未说明）
- 错误码页通用表中 1004 的完整 message 为 not authorized / token not match group / cookie is missing, log in again，2013 为 invalid params / glyph definition format error，1026 为 input new_sensitive

## gaps
- image-01-live：国际站只在 I2I schema 的 model enum（而且同一字段的 description 仍写 'Options: image-01'）和 MCP 工具表里出现。它的用途、风格特点、能否用于纯文生图（T2I enum 里没有它）、价格、限流都未说明。
- 国际站图像 API 没有 style 对象或任何风格参数（style_type/style_weight 等），也没有 aigc_watermark、negative_prompt。如果其他渠道看到这些字段，国际站文档无法支撑。
- 没有写明的默认值：model 默认值、width/height 默认值、seed 取值范围。
- 参考图限制只写了格式（JPG/JPEG/PNG）和大小（<10MB）。分辨率、最小边长、宽高比、透明通道等限制未说明。
- 输出图片的编码格式（jpeg/png）没有明确规格，只有指南示例里存成 .jpeg 的写法。
- base64 模式下单张图片或整个响应的大小上限未说明。
- OpenAPI 只定义了 HTTP 200。非 200 的 HTTP 状态码（如 401/429/5xx）会不会出现、长什么样，未说明。
- metadata.success_count/failed_count 的 schema 类型是 integer，但官方 example 返回的是字符串，实际类型需要联调确认。
- api.minimax.io 是否支持浏览器跨域（CORS）直接调用，文档未说明。FAQ 反而建议不要把 API Key 暴露在浏览器里。
- M Plan 的 Subscription Key 能否直接调用 /v1/image_generation，图像 API 页未说明。
- 国际站 /docs/faq/history-modelinfo（About APIs FAQ 里提到的历史模型价格与限流页）返回 404，没读到。猜测的国内站对应 URL https://platform.minimaxi.com/docs/faq/history-modelinfo.md 也返回 404，未使用国内站任何内容。
- 每次请求只支持一张参考图，这一点出自 Guide 正文；OpenAPI 的 subject_reference 是 array，但没写 maxItems。