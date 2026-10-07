# Seedream 图像生成 API：请求和响应合约（BytePlus ModelArk），核查修订版

> 只读核查，没有带 API Key 调用任何生成接口。文档 revision 265。凡标【未核实】的，表示原文没有读到依据。
> 来源代号：
> - **[A]** 图像生成 API 参考：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api （14 个 chunk 全部读完）
> - **[B]** 流式响应事件：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses
> - **[C]** 图像生成教程：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0
> - **[D]** Seedream 5.0 pro / flash 教程：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-5-0-pro
> - **[E]** 交互式编辑指南：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-5-0-pro-editing-guide
> - **[F]** 错误码：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes
> - **[G]** Base URL 与鉴权：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication
> - **[H]** 区域可用性：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/region-availability
> - **[I]** 模型列表·图像生成：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#9df4d9fd
> - **[J]** OpenAPI `image-generation-ImageGenerations_generate`（`arkcli docs apis spec`；externalDocs https://ai.byteplus.com/ark/region:ap-southeast-1/docs/ModelArk/image-generation-api ）
> - **[K]** FAQ：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq

---

## 1. 接口基本信息

| 项 | 内容 | 来源 |
|---|---|---|
| HTTP 方法 | `POST` | [A][J] |
| 完整 URL（AP 区） | `https://ark.ap-southeast.bytepluses.com/api/v3/images/generations` | [A][J] |
| Base URL | AP 区（柔佛，Region ID `ap-southeast-1`）：`https://ark.ap-southeast.bytepluses.com/api/v3`，见 [G][H]。EU 区（都柏林，`eu-west-1`）：`https://ark.eu-west.bytepluses.com/api/v3`，只见于 [H]。OpenAPI [J] 的 servers 只有 AP 区域名 | [G][H][J] |
| EU 区 | [H] 的 "APIs supported in the EU region" 里有 Image generation API，但 "Models supported in the EU region" 只列了 `seed-2-0-lite`。EU 区能不能调用 Seedream，【未核实】 | [H] |
| 区域隔离 | API Key 和模型开通状态按区域隔离。在某区域创建的推理接入点只能用该区域的 Base URL 调用。请求优先路由到本区域，但可能溢出到另一区域 | [H] |
| 鉴权 | [A] 原文："This API only supports API Key authentication"。请求头：`Authorization: Bearer $ARK_API_KEY`，加 `Content-Type: application/json` | [A][G] |
| 鉴权补充 | [G] 说数据面也支持 Access Key 鉴权，此时 `model` 必须填 Endpoint ID，和 [A] 的说法不一致。OpenAPI 本接口的 security 只有 `BearerAuth`（http bearer）；components 里虽然定义了 `VolcSignatureV4`，但本接口没有引用 | [A][G][J] |
| SDK 示例 | cURL、Python（`arkruntime`）、Java、Go、OpenAI SDK。OpenAI SDK 下：`image`、`watermark`、`sequential_image_generation`、`sequential_image_generation_options`、`layer_decomposition`、`optimize_prompt_options` 放进 `extra_body`；`size`、`output_format`、`response_format`、`stream` 作为顶层参数。`background` 的 OpenAI 写法没有示例 | [A][C] |
| 速率限制 | IPM 指同一账号下同一模型版本每分钟可生成的图片数，五个模型都是 500，超限报错。图层分解每次请求先预扣 17 IPM（1 张底图 + 16 个图层），生成完后按实际出图数退回多扣的部分 | [C][D][I] |
| 模型开通 | 先在控制台开通模型，`model` 才能填 Model ID。也可以填 Endpoint ID，以获得限流、付费方式、运行状态、监控、安全等能力 | [A] |

### 模型 ID 与能力矩阵（[C] 能力表、[D]、[I]）

| 模型 | Model ID | 文生图 | 文生组图 | 单/多图生图 | 单/多图生组图 | 交互式编辑 | 图层分解 | 流式 | `size` 档位 | `output_format` | 提示词优化模式 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Seedream 5.0 pro | `dola-seedream-5-0-pro-260628` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | 1K / 1.5K / 2K | png, jpeg | standard, fast |
| Seedream 5.0 flash | `dola-seedream-5-0-flash-260915` | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ | 1K / 1.5K / 2K | png, jpeg | standard |
| Seedream 5.0 lite | `seedream-5-0-260128`（也支持 `seedream-5-0-lite-260128`） | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | 2K / 3K / 4K | png, jpeg | standard |
| Seedream 4.5 | `seedream-4-5-251128` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | 2K / 4K | jpeg（[C]：不支持自定义） | standard |
| Seedream 4.0 | `seedream-4-0-250828` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | 1K / 2K / 4K | jpeg（[C]：不支持自定义） | standard, fast |

- 5.0 pro/flash：[A] 原文 "Sequential image generation, web search, and streaming output are not currently supported"，也不支持 `sequential_image_generation`。
- 参考图张数 [A]：
  - 5.0 pro/flash：不传图（文生图）、1 张（单图生图）、2–10 张（多图生图），上限 10。
  - 5.0 lite/4.5/4.0：上限 14 张，多图场景写作 2–14 张。组图时"输入图数 + 输出图数 ≤ 15"；单图 + 文本最多出 14 张，纯文本最多出 15 张。
- fast 模式：[C] 正面写了 5.0 pro 和 4.0 支持。[A] 只列了不支持的模型：5.0 flash、5.0 lite、4.5。[D] 写 "Only Seedream 5.0 pro supports this mode"，语境是 pro/flash 对比。
- [A] 的延迟建议：对延迟敏感的应用，用 5.0 pro 的 `fast` 模式，或者直接用 5.0 flash。

---

## 2. 请求体字段（`application/json`）

OpenAPI [J] 的 `required` 只有 `model`。[J] 里只有 `background` 带 enum；带 default/min/max 的只有 `layer_decomposition`、`background`、`stream`、`watermark`、`max_images`。其余字段的枚举和默认值都来自 [A] 正文。

| 字段 | 类型 | 必填 | 默认值 | 取值 | 适用模型 | 说明 | 来源 |
|---|---|---|---|---|---|---|---|
| `model` | string | 必填 | — | Model ID 或 Endpoint ID | 全部 | 需要先开通模型 | [A][J] |
| `prompt` | string | 图像生成场景必填；图层分解场景可选（[J] 不是 required） | 未说明 | 建议 ≤ 300 汉字或 600 英文单词 | 全部 | 见下方 prompt 说明 | [A][D][E] |
| `image` | string 或 string[]（[J]：oneOf） | 图像生成场景可选；`layer_decomposition=true` 时必填且只能 1 张 | — | URL，或 `data:image/<小写格式>;base64,<数据>` | 全部 | 上限：pro/flash 10 张，lite/4.5/4.0 14 张 | [A][C][D][J] |
| `layer_decomposition` | boolean | 可选 | `false` | true/false | 仅 5.0 pro、flash | 见下方图层分解说明 | [A][D][J] |
| `size` | string | 可选 | 按模型和场景不同（见下） | 档位（如 `"2K"`）或像素（`"宽x高"`），两种不能同时用 | 全部（取值因模型而异） | 用档位时，宽高比等用自然语言写在 prompt 里，由模型决定最终尺寸 | [A][C][D] |
| `optimize_prompt_options` | object | 可选 | 未说明 | 含 `mode` | 全部 | 提示词优化配置 | [A][J] |
| `optimize_prompt_options.mode` | string | 可选 | `standard` | `standard`、`fast` | `fast` 仅 5.0 pro、4.0 | standard 质量更高但更慢；fast 更快但质量可能略低 | [A][C][D] |
| `output_format` | string | 可选 | `jpeg` | `png`、`jpeg` | 5.0 pro、flash、lite | 见下方 output_format 说明 | [A][C] |
| `background` | string | 可选 | `opaque` | `transparent`、`opaque`（[J] enum） | 仅 5.0 pro、flash | 见下方 background 说明 | [A][D][J] |
| `response_format` | string | 可选 | `url` | `url`、`b64_json` | 全部（文档没写模型限制） | url 有效期 24 小时 | [A] |
| `sequential_image_generation` | string | 可选 | `disabled` | `auto`、`disabled` | 仅 5.0 lite、4.5、4.0 | auto：由模型根据 prompt 决定是否出多张、出几张；disabled：只出 1 张 | [A] |
| `sequential_image_generation_options` | object | 可选 | 未说明 | 含 `max_images` | 仅 5.0 lite、4.5、4.0 | 只在 `sequential_image_generation=auto` 时生效 | [A][J] |
| `sequential_image_generation_options.max_images` | integer | 可选 | `15` | `[1, 15]` | 同上 | 实际张数受"输入参考图数 + 生成图数 ≤ 15"约束 | [A][J] |
| `stream` | boolean | 可选 | `false` | true/false | 仅 5.0 lite、4.5、4.0 | true 时每张图生成完就推送，单图和组图都适用 | [A][B][C][J] |
| `watermark` | boolean | 可选 | `true` | true/false | 全部 | true 时右下角加 "AI-generated" 水印 | [A][D][J] |
| `tools` | array of `{type: string}`（type 必填） | 可选 | 未说明 | 未说明 | 未说明 | 只在 [J] 出现，[A] 正文没有。【未核实】可能和 web search 有关（推测） | [J] |

字段补充说明：

- **`prompt`**
  - 全部模型支持中英文。5.0 pro/flash 另外支持 14 种语言：俄、阿、菲、泰、土、韩、马来、西、葡、印尼、法、德、越、日 [A]。
  - 图层分解时：不传 prompt，模型会自动识别并分解主要元素。cURL/Java/Go 可以省略 prompt，但 Python 和 OpenAI SDK 要求传 prompt [D]。
  - 交互式编辑：可以在 prompt 里写 `<point>x y</point>` 或 `<bbox>x1 y1 x2 y2</bbox>` [D][E]。
- **`layer_decomposition`**
  - 输出 1 张底图加最多 16 个图层，每个图层是带 alpha 通道的 PNG。
  - 多传图片会报错。任一图层失败则整个请求失败，不支持部分成功。prompt 要求的图层数超过上限时，部分图层信息可能丢失 [A]。
- **`output_format`**
  - 图层分解时只控制底图格式，图层固定 png [A][C]。
  - [C] 写 4.5/4.0 默认 jpeg、不支持自定义；但 [C] 自己的 fast 示例给 4.0 传了 `output_format: png`，文档不一致。前端对 4.x 不要发送这个字段。
- **`background`**
  - 只用于"恰好 1 张带 alpha 通道的输入图"的图生图。
  - transparent 时输出默认 png，设 `output_format=jpeg` 会报错。
  - 输入图是 jpeg 这类不支持 alpha 的格式，也会报错 [A][D]。

> 以下字段在 [A]、[C]、[D]、[J] 里都没有：`seed`、`guidance_scale`、`n`、`negative_prompt`。没有依据，页面不要提供。

### `size` 规则（按模型）

**5.0 pro / 5.0 flash，图像生成场景** [A][D]
- 方式 1（档位）：`1K`、`1.5K`、`2K`，默认 `2K`。`1.5K` 和 `1K` 同价，画质更好。
- 方式 2（像素）：两个条件必须同时满足：
  - 总像素在 [921,600（1280x720）, 4,624,220（2048x2048x1.1025）] 内；
  - 宽高比在 [1/16, 16] 内。
  - 例：`2048x1024` 合法，`512x512` 不合法。
- 不传 size 时的默认值有冲突：[A][D] 写方式 1 默认 `2K`；[C] 的方式 2 参数表写 seedream-5-0-pro 默认 `1024x1024`。【未核实】实际默认是哪一个。[C] 方式 2 表里没有 flash 一列。
- 参考尺寸：
  - 1K：1024x1024、1152x864、864x1152、1424x800、800x1424、1248x832、832x1248、1568x672
  - 1.5K：1536x1536、1792x1344、1344x1792、2048x1152、1152x2048、1872x1248、1248x1872、2352x1008
  - 2K：2048x2048、2368x1776、1776x2368、2816x1584、1584x2816、2496x1664、1664x2496、3136x1344
  - 以上宽高比依次为 1:1、4:3、3:4、16:9、9:16、3:2、2:3、21:9。

**5.0 pro / 5.0 flash，图层分解场景** [A][C][D]
- 只支持档位：`1K`、`1.5K`、`2K`、`auto`，默认 `auto`。
- 底图分辨率和 `size` 一致，保持原图宽高比；每个图层接近 `size` 的分辨率，保持其在原图中对应区域的宽高比。
- `auto` 规则：原尺寸在 [921,600, 4,624,220] 内的按原尺寸输出；小于 1K 的按 1K；大于 2K 的按 2K。

**5.0 lite** [A][C]
- 方式 1：`2K`、`3K`、`4K`，默认值未说明。
- 方式 2：默认 `2048x2048`，总像素 [3,686,400, 16,777,216]，宽高比 [1/16, 16]。例：`3750x1250` 合法，`1500x1500` 不合法。

**4.5** [A][C]
- 方式 1：`2K`、`4K`，默认值未说明。
- 方式 2：默认 `2048x2048`，总像素 [3,686,400, 16,777,216]，宽高比 [1/16, 16]。

**4.0** [A][C]
- 方式 1：`1K`、`2K`、`4K`，默认值未说明。
- 方式 2：默认 `2048x2048`，总像素 [921,600, 16,777,216]，宽高比 [1/16, 16]。例：`1600x600` 合法，`800x800` 不合法。
- 1K 档参考尺寸冲突：[A] 写 16:9=1280x720、9:16=720x1280、21:9=1512x648；[C] 写 1312x736、736x1312、1568x672。

> 实际输出尺寸不一定等于参考表。[A] 样例中，5.0 lite `2K` 返回 2720x1536，5.0 pro `2K` 返回 1760x2368；[C] 也写明不限于表中标准值。显示以 `data[].size` 为准。

---

## 3. 输入图片限制 [A][C][D]

| 限制项 | 图像生成场景 | 图层分解场景 |
|---|---|---|
| 格式 | jpeg, png, webp, bmp, tiff, gif, heic, heif | png, jpeg |
| 总像素（单张宽×高的乘积） | [196, 36,000,000] | [262,144（512×512）, 36,000,000] |
| 宽、高 | 都要 > 14 px | 不适用 |
| 宽高比 | [1/16, 16] | [1/16, 16] |
| 单图大小 | ≤ 30 MB | ≤ 30 MB |
| 张数 | pro/flash ≤ 10；lite/4.5/4.0 ≤ 14 | 只能 1 张 |

- 传入方式：
  - 可访问的 URL；
  - Base64 data URI `data:image/<image format>;base64,<...>`，其中格式名必须小写 [A][C][D]。
- 交互式编辑坐标 [E]：
  - 把点或框换算成相对单张图的归一化整数，范围 0–999（左上 0,0，右下 999,999）。
  - 公式：`x = round(x_px / width * 1000)`，`width`/`height` 是图片在画布上的显示宽高。
  - demo 代码用 `clamp1000` 把结果截断到 [0, 999]，框的坐标还会先限制在图片显示区域内。
  - 写法：点 `<point>x y</point>`，框 `<bbox>x1 y1 x2 y2</bbox>`。多图时用 "Image 1"、"Image 2" 指明是哪张。demo 会按 `image` 数组顺序重新编号。
  - TouchEdit demo 的架构是"前端 fetch `/api/generate` → 后端 Python arkruntime 读环境变量 `ARK_API_KEY` 调用 API"。后端把 data URL 作为 `image` 传入：1 张传字符串，多张传数组。
- FAQ [K]（只在视觉理解语境，【未核实】是否适用于图像生成）：
  - 图片 URL 默认下载超时 5 秒；图源可能 403；
  - jpg/png/gif/webp/bmp 等按内容前 512 字节识别格式，TIFF 等依赖 URL 的 Content-Type。

---

## 4. 非流式响应 [A]

示例（摘自 [A] 交互式编辑样例；其中 usage 数值和公式对不上，只用于演示）：

```json
{ "model": "dola-seedream-5-0-pro-260628", "created": 1757323224,
  "data": [ { "url": "https://...", "size": "2048x2048" } ],
  "usage": { "generated_images": 1, "output_tokens": 18000, "total_tokens": 18000 } }
```

| 字段 | 类型 | 说明 | 适用模型 |
|---|---|---|---|
| `created` | integer | 请求创建时间，Unix 秒 | 全部 |
| `model` | string | 使用的模型 ID（`model name-version`） | 全部 |
| `data[]` | object[] | 通用字段：`url`、`b64_json`、`size`、`output_format` | 全部 |
| `data[].url` | string | `response_format=url` 时返回，24 小时内过期 | 全部 |
| `data[].b64_json` | string | `response_format=b64_json` 时返回 | 全部 |
| `data[].size` | string | `<width>x<height>` | 全部 |
| `data[].output_format` | string | `png`/`jpeg` | [A] 标注 5.0 pro、flash（lite 是否返回，【未核实】） |
| `data[].z_index` | integer | 底图 0，图层从 1 递增，越大越靠上 | pro/flash（图层分解） |
| `data[].name` / `.description` | string | 图层名称 / 语义描述（颜色、状态、材质等） | pro/flash（图层分解） |
| `data[].bounding_box.absolute` | int[4] | `[left, top, right, bottom]`，输出底图坐标系下的像素。只有图层返回 | pro/flash（图层分解） |
| `data[].bounding_box.normalized` | int[4] | 同上，归一化到 `[0, 1000]` 的整数 | pro/flash（图层分解） |
| `data[].error{code,message}` | object | 组图中单张失败时返回。审核拒绝时继续下一张；内部错误（500）时不再继续 | 5.0 lite、4.5、4.0 |
| `error{code,message}` | object | 一张图都没生成成功时的顶层错误 | 全部 |
| `usage.generated_images` | integer | 成功张数，只对成功出的图计费 | 全部 |
| `usage.input_images` | integer | 输入图数 | 5.0 pro、flash |
| `usage.output_tokens` | integer | round(sum(宽×高)/256) | 全部 |
| `usage.total_tokens` | integer | 目前不计输入 token，等于 output_tokens | 全部 |

- 图层分解样例 [A]：底图 `output_format: jpeg`、`z_index: 0`；图层 `png`；`usage.generated_images: 8`（底图和图层合计）。
- 图层还原 [A][D]：
  - 用 absolute：把图层缩放到 `(right-left)×(bottom-top)`，放在底图的 `(left, top)`。
  - 用 normalized 还原到 W×H 画布：`x = left/1000×W`、`w = (right-left)/1000×W`，y、h 同理。
  - 多个图层按 `z_index` 升序叠放。
- URL 有效期 24 小时，过期自动清除 [A][B][C][D]。
- HTTP 成功状态为 200（[J]）。[J] 的响应 schema 只是占位（`__response_json__`/`__response_stream__`），字段以 [A][B] 正文为准。

---

## 5. 流式 SSE（`stream: true`）[A][B][C]

适用模型：5.0 lite、4.5、4.0（5.0 pro/flash 不支持）。

- [B] 只说明用 Server-Sent Events 推送，并定义了事件 schema。
- 帧格式只能从 [A]/[C] 的示例看出：`event: <type>`、`data: <JSON>`，最后 `data: [DONE]`。示例里的 JSON 是多行格式化的，线上是否单行没有说明。前端应按 SSE 规范解析，多行 data 要拼接。
- 响应 Content-Type 没有说明。

| 事件 | 字段 | 说明 |
|---|---|---|
| `image_generation.partial_succeeded` | `type`、`model`、`created`、`image_index`（从 0 开始）、`url`（response_format=url）/`b64_json`（b64_json）、`size` | 单张成功，URL 24 小时有效 |
| `image_generation.partial_failed` | `type`、`model`、`created`、`image_index`、`error.code`、`error.message` | 单张失败，例如 `OutputImageSensitiveContentDetected` |
| `image_generation.completed` | `type`、`model`、`created`、`usage{generated_images, output_tokens, total_tokens}` | 汇总。[B] 标注 `input_images` 只有 5.0 pro/flash 返回，但这两个模型不支持流式，文档自相矛盾，前端按可选字段处理 |
| 顶层 `error` | 字段路径 `error.error.code` / `error.error.message` | 整个请求失败，例如缺少必填参数、鉴权失败。[B] 示例 code 是 `"BadRequest"`。SSE 帧里是否有 `event: error` 行、HTTP 状态码，【未核实】 |
| `image_generation.partial_image` | `partial_image_index`、`b64_json` | 只出现在 Python SDK 示例里，[B] 没有定义，【未核实】 |

SDK 示例逻辑：收到 `partial_failed` 且 `error.code == "InternalServiceError"` 时停止处理（Python 用 break，Java 抛异常，Go 退出）[A]。

---

## 6. 错误码 [F][A][B]

- 错误体：`{"error": {"code": "...", "message": "..."}}`，message 里常带 `Request ID: {id}` [A][B][F]。
- [F] 的表格列是 HTTP 状态码、Type、Code、Message。[B] 示例里 code 填的是 `BadRequest`（这是 [F] 的 Type 列），[F] 里同一条 message 对应的 Code 是 `MissingParameter`。实际 `error.code` 返回 Type 还是 Code，【未核实】。

| HTTP | 相关错误码 |
|---|---|
| 400 | `MissingParameter`、`MissingParameter.{Parameter}`、`InvalidParameter`、`InvalidParameter.{Parameter}`、`SensitiveContentDetected`、`InputTextSensitiveContentDetected`、`InputTextSensitiveContentDetected.PolicyViolation`、`InputImageSensitiveContentDetected`、`InputImageSensitiveContentDetected.PolicyViolation`、`InputImageSensitiveContentDetected.PrivacyInformation`、`OutputImageSensitiveContentDetected`、`OutputImageSensitiveContentDetected.DeepFake`、`InvalidImageURL.EmptyURL`、`InvalidImageURL.InvalidFormat`、`InvalidEndpoint.ClosedEndpoint` |
| 401 | `AuthenticationError`（API key 或 AK/SK 缺失或无效）、`InvalidAccountStatus` |
| 403 | `AccountOverdueError`、`AccessDenied`、`OperationDenied.ServiceNotOpen`、`OperationDenied.ServiceOverdue` |
| 404 | `InvalidEndpointOrModel.NotFound`、`ModelNotOpen`、`InvalidEndpointOrModel.ModelIDAccessDisabled`（需改用 Endpoint ID） |
| 429 | `ModelAccountIpmRateLimitExceeded`、`ModelAccountRpmRateLimitExceeded`、`APIAccountRpmRateLimitExceeded`、`RateLimitExceeded.EndpointRPMExceeded`、`QuotaExceeded`（免费试用额度用完、排队任务数超限等多种含义）、`ServerOverloaded`、`RequestBurstTooFast`、`SetLimitExceeded`（达到安全体验模式设定额度）、`InflightBatchsizeExceeded`、`AccountRateLimitExceeded` |
| 500 | `InternalServiceError` |

[F] 是 ModelArk 推理通用错误码表。上表哪些码一定适用于图像生成 API，没有专门说明。

---

## 7. 对前端页面的含义（基于上文事实；标"建议"的是推断）

1. **区域选择**：AP 区为 `https://ark.ap-southeast.bytepluses.com/api/v3`，EU 区为 `https://ark.eu-west.bytepluses.com/api/v3`。API Key 按区域隔离。EU 区是否提供 Seedream，【未核实】，建议默认 AP。
2. **按模型动态显示控件**：
   - `size` 档位：pro/flash 1K/1.5K/2K（图层分解再加 auto）；lite 2K/3K/4K；4.5 2K/4K；4.0 1K/2K/4K。
   - 像素写法：同时校验总像素区间和宽高比 [1/16, 16]。
   - `output_format`：只对 5.0 pro/flash/lite 显示，对 4.x 不发送。
   - `background`、`layer_decomposition`：只对 pro/flash 显示。
   - `sequential_image_generation`、`max_images`、`stream`：只对 lite/4.5/4.0 显示。
   - `fast`：只对 5.0 pro、4.0 开放。
3. **联动校验**：
   - `layer_decomposition=true`：强制 1 张 png/jpeg 图，总像素 ≥ 262,144，size 只能选档位或 auto。
   - `background=transparent`：强制恰好 1 张带 alpha 的输入图，且 `output_format` 不能是 jpeg。
4. **参考图**：上限 pro/flash 10 张，其余 14 张。单张 ≤ 30 MB，宽高 > 14 px，总像素 [196, 36,000,000]。本地文件转成 `data:image/<小写格式>;base64,...`。组图时"输入图数 + 实际生成数 ≤ 15"；请求里 max_images 超出时是否报错，【未核实】，建议只做软提示。
5. **交互式编辑**：坐标归一化到 0–999 并截断（同 [E] demo 的 clamp1000）；多图时提示词里的 Image N 要和 `image` 数组顺序对应。
6. **结果展示**：
   - 处理 `url`（24 小时有效，提醒用户下载）或 `b64_json`，尺寸以 `data[].size` 为准；
   - 组图要处理 `data[].error`；
   - 流式要按 SSE 规范解析，并处理 `[DONE]`；
   - 图层分解按 `z_index` 和 `bounding_box` 叠加渲染。
7. **浏览器直连**：文档没有说明 CORS 策略，也没有说明是否允许前端直接带 API Key 调用。官方 demo [E] 用的是"前端 → 后端 → API"的架构，API Key 放在后端环境变量里。

## 8. 仍未核实 / gaps

- `seed`、`guidance_scale`、`negative_prompt`、`n` 在文档和合约中都不存在，传了会怎样未知。
- `tools` 的枚举、适用模型、默认值。
- 鉴权说法冲突：[A] 说只支持 API Key，[G] 说数据面也支持 Access Key。
- 5.0 pro 不传 size 时，默认 `2K` 还是 `1024x1024`；5.0 flash 的方式 2 默认值。
- 4.0 的 1K 档参考尺寸在 [A] 和 [C] 之间冲突。
- 4.x 传 `output_format` 的实际行为（[C] 正文和示例矛盾）。
- 5.0 lite 响应中是否返回 `data[].output_format`。
- 流式顶层 error 的帧格式和 HTTP 状态码；`error.code` 返回 Type 还是 Code。
- `image_generation.partial_image` 事件的触发条件。
- [B] 中 `input_images` 和"pro/flash 不支持流式"的矛盾。
- EU 区是否提供 Seedream。
- CORS 策略。
- 请求超时、请求体大小上限（多张 Base64 合计）。
- 图片 URL 下载超时（5 秒）和 Content-Type 校验是否适用于图像生成。
- 给 pro/flash 传 `stream`/`sequential_image_generation` 时是报错还是忽略。


## corrections
[
 {
  "claim": "参考图张数：5.0 pro/flash 单图生成时可传 2–10 张",
  "problem": "写法有误导。[A] 里的 2–10 张专指多参考图生图。5.0 pro/flash 也支持单参考图生图和纯文本生图。张数上限是 10，不是只能传 2–10 张",
  "correct_fact": "5.0 pro/flash：image 可以不传（文生图），可以传 1 张（单图生图），也可以传 2–10 张（多图生图），上限 10 张。5.0 lite/4.5/4.0 上限 14 张，多图场景写作 2–14 张。组图模式下要求输入图数 + 输出图数 ≤ 15",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "Base URL 行：AP 区与 EU 区 Base URL，来源标注为 [G][H]",
  "problem": "[G]（base-url-and-authentication）只列了 AP 区数据面 Base URL https://ark.ap-southeast.bytepluses.com/api/v3，没有 EU 区",
  "correct_fact": "EU 区 Base URL https://ark.eu-west.bytepluses.com/api/v3 只出现在 [H]（region-availability）。OpenAPI [J] 的 servers 也只有 https://ark.ap-southeast.bytepluses.com",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/region-availability"
 },
 {
  "claim": "服务端用 SSE 推送，每帧格式是 `event: <type>` 加一行 `data: {json}`，最后以 `data: [DONE]` 结束",
  "problem": "原文不支持“一行”的说法。[A]/[C] 示例在 data: 后面是多行格式化 JSON，只用来演示。[B] 事件文档没有定义线上帧格式，也没有提到 [DONE]",
  "correct_fact": "[B] 只说明通过 Server-Sent Events 推送，并定义了各事件的 schema。帧以 event:/data: 开头、以 data: [DONE] 结束，这些只见于 [A]/[C] 的代码示例。JSON 是否单行没有说明，前端解析器应按 SSE 规范处理（多行 data 要拼接）",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses"
 },
 {
  "claim": "流式 image_generation.completed 的 usage 含 input_images（5.0 pro/flash）",
  "problem": "报告照抄了 [B]，但没指出这里文档自相矛盾：[B] 标注 input_images 只有 5.0 pro/flash 支持，而 [A]/[C] 明确说 5.0 pro/flash 不支持流式输出",
  "correct_fact": "能用流式的只有 5.0 lite、4.5、4.0。这三个模型的 completed 事件文档没有标注会返回 input_images（示例里也没有）。前端应当把 input_images 当作可选字段",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses"
 },
 {
  "claim": "gaps：交互式编辑坐标范围 0–999，但公式 round(x_px/width*1000) 在右边缘可能算出 1000，存在不一致",
  "problem": "[E] 的 demo 代码已经说明了处理方式，报告漏读了：clamp1000 函数把结果截断到 [0, 999]",
  "correct_fact": "[E] demo 是 `function clamp1000(value) { return Math.max(0, Math.min(999, Math.round(value))); }`，点和框的坐标都先算 (像素/显示宽高)*1000，再截断到 0–999。框的坐标还会先限制在图片显示区域内。前端照此截断即可",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-5-0-pro-editing-guide"
 },
 {
  "claim": "第 7 节：组图时前端校验“输入图数 + max_images ≤ 15”",
  "problem": "把设计建议写成了文档事实。[A] 只说实际生成张数受“输入参考图数 + 生成图数 ≤ 15”约束，没有说输入图数 + max_images > 15 会报错",
  "correct_fact": "文档约束的是实际生成张数。请求里输入图数 + max_images > 15 时是报错还是被截断，没有说明（未核实）。前端可以把它做成提示或软校验，并注明这是推断",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "fast 模式适用范围：[A] 和 [C] 说 5.0 pro 和 4.0 支持 fast",
  "problem": "[A] 没有正面写哪些模型支持 fast，只写了 “Seedream 5.0 flash, Seedream 5.0 lite, and Seedream 4.5 do not currently support this mode”，“pro 和 4.0 支持”是排除法推出来的。正面表述只在 [C]（含能力表）",
  "correct_fact": "[C] 原文：Seedream 5.0 pro 和 Seedream 4.0 支持 fast；5.0 flash、5.0 lite、4.5 只支持 standard。[A] 只列了不支持的模型。[D] 写 “Only Seedream 5.0 pro supports this mode”，语境是 pro/flash 对比",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0"
 },
 {
  "claim": "output_format：4.5 和 4.0 固定 jpeg，不能自定义",
  "problem": "[C] 有这句原文，但同一篇 [C] 的 fast 模式示例给 seedream-4-0-250828 传了 \"output_format\":\"png\"。文档自相矛盾，报告没有指出",
  "correct_fact": "[C] 写 seedream-4-5/4-0 默认 jpeg、不支持自定义，[A] 也只列了 5.0 pro/flash/lite 支持 output_format。给 4.x 传 output_format 时是忽略还是报错，没有说明（未核实）。前端对 4.x 应当不发送这个字段",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0"
 },
 {
  "claim": "OpenAI SDK 时 image、watermark、sequential_image_generation、sequential_image_generation_options、layer_decomposition 放 extra_body",
  "problem": "列表不完整",
  "correct_fact": "[C] fast 模式的 OpenAI 示例把 optimize_prompt_options（{\"mode\": \"fast\"}）也放在 extra_body 里。background 在 OpenAI SDK 下怎么传，没有示例",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0"
 },
 {
  "claim": "第 4 节非流式响应示例：size 2048x2048，usage.output_tokens 18000",
  "problem": "这个示例取自 [A] 的交互式编辑样例，数值和文档公式对不上：2048×2048/256 = 16384，不是 18000。[A] 其他样例（1760x2368→16280；3×2720x1536→48960）都符合公式",
  "correct_fact": "示例里的 usage 数值只是演示，不能拿来做前端校验。计费 token 以 usage.output_tokens = round(sum(宽×高)/256) 为准",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "OpenAPI 的 security 是 BearerAuth（http bearer）",
  "problem": "说法正确但不完整",
  "correct_fact": "OpenAPI [J] 的 components.securitySchemes 还定义了 VolcSignatureV4（type apiKey，in header，name Authorization），但这个 operation 的 security 只引用了 BearerAuth。浏览器页面用 Bearer API Key 即可",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/ModelArk/image-generation-api"
 },
 {
  "claim": "请求体字段表中 response_format/output_format/sequential_image_generation/optimize_prompt_options.mode 的枚举与默认值（部分标注 [J]）",
  "problem": "在 OpenAPI [J] 里，这几个字段都是没有 enum/default 的普通 string。[J] 里只有 background 有 enum [transparent, opaque] 和 default opaque",
  "correct_fact": "这几个字段的枚举和默认值只来自 [A] 正文：response_format 默认 url；output_format 默认 jpeg；sequential_image_generation 默认 disabled；mode 默认 standard。[J] 带 default/min/max 的只有 layer_decomposition(false)、background(opaque)、stream(false)、watermark(true)、max_images(default 15，min 1，max 15)",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/ModelArk/image-generation-api"
 },
 {
  "claim": "流式顶层 error 事件：error.code / error.message",
  "problem": "字段路径不够准确，触发方式也没说清",
  "correct_fact": "[B] 的字段路径是 error.error.code / error.error.message。SSE 帧里会不会有 `event: error` 这一行、整个请求失败时 HTTP 状态码是不是非 200，[B] 都没有说明（未核实）",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses"
 }
]

## missing_items
- 实际输出尺寸不一定等于参考尺寸表：[A] 中 5.0 lite size=2K 的样例返回 2720x1536，5.0 pro size=2K 返回 1760x2368。[C] 也写明支持的宽高比不限于表中标准值。前端展示和下载要以 data[].size 为准 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api, https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0)
- IPM 限流的统计口径：同一账号下同一模型版本每分钟可生成的图片数，各模型都是 500 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0, https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#9df4d9fd)
- Seedream 5.0 lite、4.5、4.0 用档位写法（方式 1）时没有写默认值，只写了像素写法（方式 2）默认 2048x2048。5.0 pro/flash 档位默认 2K (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api)
- 图层分解的 [A] 官方样例同时传了 layer_decomposition=true、size="2K"、output_format="jpeg"、response_format="url"、watermark=true。返回中底图 output_format=jpeg、z_index=0，图层 output_format=png。usage.generated_images=8，即底图和图层合计计数 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api)
- [C] 的输出格式小节只写 seedream-5-0-pro 和 seedream-5-0-lite 可以设置 output_format，没提 flash。[A] 和 [C] 能力表都包含 5.0 flash，这是文档内部不一致 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0)
- [E] demo 的交互实现细节：坐标截断到 0–999；提示词里的 Image N 按 image 数组顺序重新编号（demo 代码会重映射）；单张图传字符串，多张图传数组，内容是 data:URL（Base64 data URI）。这些是 demo 行为，不是 API 规范 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-5-0-pro-editing-guide)
- 遗漏的可能相关错误码：400 InputTextSensitiveContentDetected.PolicyViolation（输入文本可能涉及版权限制）；429 APIAccountRpmRateLimitExceeded；429 InflightBatchsizeExceeded；429 QuotaExceeded 有多种含义（免费试用额度用完、排队任务数超限等）。这些码是否适用于图像生成 API 没有专门说明 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes)
- FAQ 中图片 URL 的格式校验规则：jpg/png/gif/webp/bmp 等按内容前 512 字节识别；TIFF 等格式依赖 URL 的 Content-Type 元数据，必须设置正确。这和 5 秒下载超时、403 一样只出现在视觉理解语境里，没有确认适用于图像生成 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq)
- [A] 的延迟建议：对延迟敏感的应用，用 Seedream 5.0 pro 的 fast 模式，或者直接用 Seedream 5.0 flash (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api)
- 区域路由：推理请求优先路由到接入点所在区域，但可能溢出到其他区域（AP↔EU） (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/region-availability)
- OpenAPI [J] 的 200 响应 schema 只有占位（__response_json__/__response_stream__），没有为流式声明 text/event-stream 等 Content-Type。流式响应的 Content-Type 没有说明 (https://ai.byteplus.com/ark/region:ap-southeast-1/docs/ModelArk/image-generation-api)

## gaps
- seed、guidance_scale、negative_prompt、n 等字段：[A] 正文、[C]、[D] 和 OpenAPI 合约里都没有。当前五个 Seedream 模型能否接受这些字段、会被忽略还是报错，都没有依据，没有写入参数表。
- OpenAPI 合约里有 `tools`（array，元素为 {type: string}，type 必填），但 [A] 正文没有说明。[A] 只提到 5.0 pro/flash 不支持 'web search'。tools 的 type 枚举、适用模型、默认值都没读到。
- 鉴权说法不一致：[A] 说图像生成 API 只支持 API Key 鉴权；[G] 说数据面也支持 Access Key 鉴权（此时 model 要填 Endpoint ID）。
- Seedream 5.0 pro 像素写法的默认值冲突：[A] 和 [D] 写方式1默认 `2K`；[C] 的方式2参数表写 seedream-5-0-pro 默认 `1024x1024`。不传 size 时实际是哪一个无法确认。5.0 flash 在 [C] 的方式2表里没有单独一列。
- Seedream 4.0 的 1K 档参考尺寸冲突：[A] 写 16:9=1280x720、9:16=720x1280、21:9=1512x648；[C] 写 16:9=1312x736、9:16=736x1312、21:9=1568x672。
- fast 模式的适用范围：[A] 和 [C] 说 5.0 pro 和 4.0 支持 fast；[D] 说 'Only Seedream 5.0 pro supports this mode'（上下文是 pro/flash 对比）。三者合起来理解为 5.0 pro 和 4.0 支持，但措辞有冲突。
- 响应字段 data[].output_format 在 [A] 中标注仅 5.0 pro/flash 返回；但请求参数 output_format 也支持 5.0 lite。5.0 lite 的响应里是否返回 output_format 不清楚。
- 坐标范围不一致：交互式编辑 [E] 说归一化坐标范围是 0–999，但公式 `round(x_px/width*1000)` 在右边缘可能算出 1000；图层分解返回的 bounding_box.normalized 范围是 [0,1000]。
- SSE 事件 `image_generation.partial_image`（字段 partial_image_index、b64_json）只出现在 Python SDK 示例代码里，[B] 的事件文档没有定义，触发条件不明。
- 错误码不一致：[B] 的顶层 error 示例 code 是 'BadRequest'，而 [F] 中同一条 message 对应的 Code 是 'MissingParameter'。实际返回 error.code 时用的是 Type 还是 Code 无法确认。
- EU 区：[H] 说 EU 支持 Image generation API，但 EU 支持的模型只列了 seed-2-0-lite，没有 Seedream。EU 区能否调用 Seedream 不确定。
- 浏览器直连：文档没有说明 CORS 策略，以及是否允许前端直接带 API Key 调用。交互式编辑 demo [E] 用的是'前端 → 后端 → API'的架构。
- 图片 URL 下载超时（默认 5 秒）和图源 403 问题只出现在 FAQ 的'视觉理解'章节，没有明确说适用于图像生成的 image 输入。
- 请求超时时间、单次请求耗时、请求体大小上限（例如多张 Base64 合计）没有读到。
- Seedream 3.0 系列（只有提示词指南页面）不在模型列表 [I] 中，其 API 参数没有调研。
- OpenAPI 合约的响应 schema 只是占位（__response_json__ / __response_stream__），没有给出结构化字段定义。响应字段以 [A] 和 [B] 正文为准。