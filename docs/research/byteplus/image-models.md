> **核查说明**：我回到原文，逐条核对了原报告的字段名、类型、必填、默认值、范围、枚举、适用模型和限制，覆盖以下来源：image-generation-api、image-generation-streaming-responses、seedream-4-0-5-0、seedream-5-0-pro、seedream-5-0-pro-editing-guide、model-list#9df4d9fd、model-pricing#c02be6ee、error-codes，以及 OpenAPI `image-generation-ImageGenerations_generate`。所有页面都在同一快照 revision 265 下读取，查询日期 2026-10-08。另外运行了 `arkcli models search seedream / seededit`（带 `--include-deprecated`）和 `arkcli models get`，都是只读操作，没有 activate，也没有调用生成接口。
> 原报告的绝大多数字段、数值和映射表与原文一致。修正主要有三类：措辞过重的 ✗，把推导写成原文的地方，以及对 flash 文档覆盖情况的误判。另外补充了 SSE 帧格式、响应字段、错误码等对前端重要的遗漏。
> 标记约定：【推导】是根据原文推算或归纳的结论；【arkcli 元数据】来自 CLI 实时目录，不是官方文档正文，前端不应依赖；【未核实】是原文没有读到的内容。

# Seedream 各模型能力差异矩阵（前端按模型动态显示、隐藏、限制参数）

**接口基本信息**
- 接口：`POST https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`
- 鉴权：原文是 "This API only supports API Key authentication"。代码示例用 `Authorization: Bearer $ARK_API_KEY`；OpenAPI 的 operation security 是 `BearerAuth`（http bearer）。
- 来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api ；OpenAPI `image-generation-ImageGenerations_generate`

---

## 1. 当前可用的 Seedream 模型 ID

| 模型 | 精确 Model ID | 生命周期【arkcli 元数据】 | 来源 |
|---|---|---|---|
| Seedream 5.0 pro | `dola-seedream-5-0-pro-260628` | Published | model-list#9df4d9fd；seedream-5-0-pro |
| Seedream 5.0 flash | `dola-seedream-5-0-flash-260915` | Published | 同上 |
| Seedream 5.0 lite | `seedream-5-0-260128`（原文注明 "also supports: `seedream-5-0-lite-260128`"；定价表用的是后者） | Published | model-list；seedream-4-0-5-0；model-pricing |
| Seedream 4.5 | `seedream-4-5-251128` | Published | 同上 |
| Seedream 4.0 | `seedream-4-0-250828` | Published | 同上 |
| Seedream 3.0 t2i | `seedream-3-0-t2i-250415` | **Retiring**（退役中，还没有完全退役） | 只出现在 arkcli；官方 model-list 和 API 文档都没有 |
| SeedEdit 3.0 i2i | `seededit-3-0-i2i-250628` | **Shutdown** | 只出现在 arkcli；model-pricing 仍列了价格 |

- `model` 也可以填 Endpoint ID。模型要先在 Model activation 页面开通才能调用。来源：image-generation-api。
- 建议前端只提供前 5 个模型。3.0 t2i 和 SeedEdit 3.0 在当前 API 文档里都没有参数说明。

---

## 2. 模型 × 能力矩阵

| 能力 | 5.0 pro | 5.0 flash | 5.0 lite | 4.5 | 4.0 | 来源 |
|---|---|---|---|---|---|---|
| 文生图 | ✓ | ✓ | ✓ | ✓ | ✓ | seedream-4-0-5-0 Model capabilities |
| 单图/多图生成单图 | ✓ | ✓ | ✓ | ✓ | ✓ | 同上 |
| 多图参考张数 | 2-10 | 2-10 | 2-14 | 2-14 | 2-14 | image-generation-api |
| **最大参考图数** | **10** | **10** | **14** | **14** | **14** | image-generation-api `image`；seedream-4-0-5-0 Usage limitations |
| 组图 `sequential_image_generation` | ✗（"is not supported"） | ✗ | ✓ | ✓ | ✓ | image-generation-api；能力表 |
| 流式 `stream` | ✗ | ✗ | ✓ | ✓ | ✓ | image-generation-api；seedream-4-0-5-0#e5bef0d7 |
| 交互式编辑（坐标、框、箭头、手绘标记） | ✓ | ✓ | ✗ | ✗ | ✗ | seedream-4-0-5-0 能力表 |
| 图层拆分 `layer_decomposition`（1 张底图加最多 16 层） | ✓ | ✓ | ✗ | ✗ | ✗ | image-generation-api（Supported model 只列了 pro 和 flash）；能力表 |
| 透明背景 `background` | ✓ | ✓ | ✗ | ✗ | ✗ | image-generation-api（Supported model 只列了 pro 和 flash） |
| 提示词语言 | 中、英，另加 14 种 | 中、英，另加 14 种 | 中、英 | 中、英 | 中、英 | image-generation-api `prompt` Note |
| 原生多语言图中文字生成（另加 14 种语言） | ✓ | ✓ | 文档未列出【推导为不支持】 | 同左 | 同左 | seedream-5-0-pro Featured capabilities |
| 联网搜索 web search | ✗（"not currently supported"） | ✗ | 文档未说明 | 文档未说明 | 文档未说明 | image-generation-api |
| Max IPM（张/分钟） | 500 | 500 | 500 | 500 | 500 | model-list#9df4d9fd |

另加的 14 种语言是：俄、阿、菲、泰、土、韩、马来、西、葡、印尼、法、德、越、日。

---

## 3. 模型 × 参数矩阵

### 3.1 请求体参数总表

OpenAPI 请求体共 14 个字段：model、prompt、image、layer_decomposition、size、optimize_prompt_options、output_format、background、response_format、sequential_image_generation、sequential_image_generation_options、stream、tools、watermark。下表全部覆盖。

| 字段 | 类型 | 必填 | 默认值 | 取值范围/枚举 | 适用模型 | 说明 / 来源 |
|---|---|---|---|---|---|---|
| `model` | string | **是**（schema 里唯一的 required） | — | Model ID 或 Endpoint ID | 全部 | image-generation-api；OpenAPI |
| `prompt` | string | 图像生成场景：Required；图层拆分场景：Optional（schema 层面不是 required） | 未说明 | 建议不超过 300 个汉字或 600 个英文单词 | 全部 | 图层拆分时不传 prompt，模型会自动拆出主要元素 |
| `image` | string 或 string[] | 图像生成场景：可选；图层拆分场景：必填，且只能 1 张 | 未说明 | URL，或 `data:image/<小写格式>;base64,...` | 全部 | 数量上限：pro/flash 10，lite/4.5/4.0 14 |
| `size` | string | 否 | pro/flash 生成场景：`2K`；pro/flash 图层拆分：`auto`；lite/4.5/4.0：像素写法默认 `2048x2048` | 见 3.2 | 全部（各模型取值不同） | 档位写法与 `宽x高` 写法二选一 |
| `layer_decomposition` | boolean | 否 | `false` | true / false | **pro、flash** | image-generation-api；OpenAPI default false |
| `background` | string | 否 | `opaque` | `transparent` / `opaque`（OpenAPI 中唯一带 enum 的字段） | **pro、flash** | 限制见 5.3 |
| `output_format` | string | 否 | `jpeg`（透明背景模式下默认 `png`） | `png` / `jpeg` | **pro、flash、lite** | 4.5/4.0 固定 jpeg，原文是 "does not support custom settings"。图层拆分时只控制底图格式，图层固定 png |
| `optimize_prompt_options.mode` | string | 否 | `standard` | `standard` / `fast` | `fast` 只有 **pro、4.0** 支持 | flash、lite、4.5 "do not currently support" fast；来源 image-generation-api、seedream-4-0-5-0#6b32fe21 |
| `response_format` | string | 否 | `url` | `url` / `b64_json` | 全部 | URL 在生成后 24 小时内有效 |
| `sequential_image_generation` | string | 否 | `disabled` | `auto` / `disabled` | **lite、4.5、4.0** | `auto` 时由模型根据 prompt 决定是否出多张、出几张 |
| `sequential_image_generation_options.max_images` | integer | 否 | `15` | `[1, 15]` | **lite、4.5、4.0** | 只在 `auto` 时生效；**参考图数 + 生成图数 ≤ 15**。OpenAPI 为 min 1、max 15、default 15 |
| `stream` | boolean | 否 | `false` | true / false | **lite、4.5、4.0** | SSE 推送，单图和组图都适用 |
| `watermark` | boolean | 否 | **`true`** | true / false | 全部 | `true` 时在右下角加 "AI-generated" 水印 |
| `tools` | array of `{type}`（type 必填，类型是 string） | 否 | 未说明 | 正文未说明 | 正文未说明 | 只出现在 OpenAPI schema【未核实】 |

> 注意：OpenAPI 中 `output_format`、`response_format`、`optimize_prompt_options.mode`、`sequential_image_generation`、`size` 都只是 `type: string`，没有 enum。上表的枚举值来自文档正文。前端校验要按正文硬编码，不能靠 schema 自动生成。

### 3.2 `size` 档位与像素范围

| | 5.0 pro / flash（生成场景） | 5.0 lite | 4.5 | 4.0 |
|---|---|---|---|---|
| 方式 1：分辨率档位 | `1K`、`1.5K`、`2K` | `2K`、`3K`、`4K` | `2K`、`4K` | `1K`、`2K`、`4K` |
| 方式 1 默认值 | `2K` | 文档未说明 | 文档未说明 | 文档未说明 |
| 方式 2：`宽x高` 总像素 | [921,600（1280x720）, 4,624,220（2048x2048x1.1025）] | [3,686,400（2560x1440）, 16,777,216（4096x4096）] | 同 lite | [921,600, 16,777,216] |
| 方式 2 默认值 | 文档矛盾（见 gaps） | `2048x2048` | `2048x2048` | `2048x2048` |
| 宽高比 | [1/16, 16] | [1/16, 16] | [1/16, 16] | [1/16, 16] |

- 方式 2 需要同时满足总像素和宽高比两个条件。总像素是单张图的宽×高。
- pro/flash 的档位和像素范围在 API 文档的 "Seedream 5.0 pro / Seedream 5.0 flash" 段落里合并写明。教程能力表的 flash 列也写了 1K、1.5K、2K。
- pro 的 `1.5K` 与 `1K` 同价，且生成质量更好（原文 Warning/Note）。
- 来源：image-generation-api `size`；seedream-4-0-5-0#034e4a46；seedream-5-0-pro#pro-output-spec。

**档位写法对应的参考宽高**（官方给出的常见比例示例，原文写明 "not limited to these standard values"）：

| 比例 | 1K（pro/flash） | 1.5K（pro/flash） | 2K（pro/flash） | 2K（lite/4.5/4.0） | 3K（lite） | 4K（lite/4.5/4.0） | 1K（4.0） |
|---|---|---|---|---|---|---|---|
| 1:1 | 1024x1024 | 1536x1536 | 2048x2048 | 2048x2048 | 3072x3072 | 4096x4096 | 1024x1024 |
| 4:3 | 1152x864 | 1792x1344 | 2368x1776 | 2304x1728 | 3456x2592 | 4704x3520 | 1152x864 |
| 3:4 | 864x1152 | 1344x1792 | 1776x2368 | 1728x2304 | 2592x3456 | 3520x4704 | 864x1152 |
| 16:9 | 1424x800 | 2048x1152 | 2816x1584 | 2848x1600 | 4096x2304 | 5504x3040 | 1280x720（API 文档）或 1312x736（教程） |
| 9:16 | 800x1424 | 1152x2048 | 1584x2816 | 1600x2848 | 2304x4096 | 3040x5504 | 720x1280（API 文档）或 736x1312（教程） |
| 3:2 | 1248x832 | 1872x1248 | 2496x1664 | 2496x1664 | 3744x2496 | 4992x3328 | 1248x832 |
| 2:3 | 832x1248 | 1248x1872 | 1664x2496 | 1664x2496 | 2496x3744 | 3328x4992 | 832x1248 |
| 21:9 | 1568x672 | 2352x1008 | 3136x1344 | 3136x1344 | 4704x2016 | 6240x2656 | 1512x648（API 文档）或 1568x672（教程） |

> **实际尺寸以响应为准**：官方示例中 pro 用 `size=2K` 返回了 `1760x2368`，lite 用 `2K` 返回了 `2720x1536`，都不在上表中。前端预览要读 `data[].size`，不要按档位硬编码。来源：image-generation-api 代码示例的响应。

**图层拆分场景的 `size`**（pro、flash）：
- 只支持档位：`1K`、`1.5K`、`2K`、`auto`，默认 `auto`。原文是 "Only resolution levels are supported"，所以【推导】不能填 `宽x高`。
- 底图按 `size` 指定的分辨率输出，并保持原图宽高比。每个图层的分辨率接近 `size`，并保持它在原图中对应区域的宽高比。
- `auto` 规则：原尺寸在 [921,600, 4,624,220] 之间的按原尺寸输出；小于 1K 的按 1K 输出；大于 2K 的按 2K 输出。各自保持原宽高比。
- 来源：image-generation-api；seedream-5-0-pro。

### 3.3 输入图片约束

| 约束 | 图像生成场景（全部模型） | 图层拆分场景（pro/flash） |
|---|---|---|
| 格式 | jpeg、png、webp、bmp、tiff、gif、heic、heif | **只有 png、jpeg** |
| 总像素 | [196, 36,000,000（6000×6000）] | [262,144（512×512）, 36,000,000] |
| 宽、高 | 都 > 14px | 不适用 |
| 宽高比 | [1/16, 16] | [1/16, 16] |
| 单张大小 | ≤ 30 MB | ≤ 30 MB |
| 张数 | pro/flash ≤ 10；lite/4.5/4.0 ≤ 14 | **只能 1 张**，传多张会报错 |

- Base64 写法必须是 `data:image/<格式>;base64,<编码>`，`<格式>` 要小写。用 URL 时要保证 URL 可访问。
- 来源：image-generation-api；seedream-4-0-5-0#31037d05；seedream-5-0-pro#pro-limits。

### 3.4 组图张数规则（lite、4.5、4.0）

- 多张参考图（2-14）加 prompt：参考图数 + 输出图数 ≤ 15。
- 单张参考图加 prompt：最多输出 14 张。
- 只有文本：最多输出 15 张。
- 单张被内容审核拒绝时，会继续生成后面的图。遇到 `500` 内部错误时，不再继续生成后续图片。
- 失败的那张在 `data[i].error` 中返回 `code` 和 `message`，`data.error` 的 Supported models 只有 lite、4.5、4.0。一张都没生成时返回顶层 `error`。
- seedream-4-0-5-0 能力表的 "Number of generated images" 一行，4.5 和 4.0 两列是空的（应是合并单元格）。三个模型共用这条规则，以 API 文档为准。
- 来源：image-generation-api。

---

## 4. 计费（官方标价，USD/张）

| Model ID | 输入图 | 输出图 |
|---|---|---|
| dola-seedream-5-0-pro-260628 | 第 1 张免费；从第 2 张起每张 0.003 | 单图生成：≤ 261 万像素（1.5K 及以下）0.045；> 261 万像素（高于 1.5K）0.09。图层拆分：≤ 261 万像素 0.0225；> 261 万像素 0.045 |
| dola-seedream-5-0-flash-260915 | 免费 | 0.018 |
| seedream-5-0-lite-260128 | 免费 | 0.035 |
| seedream-4-5-251128 | 免费 | 0.04 |
| seedream-4-0-250828 | 免费 | 0.03 |
| seededit-3-0-i2i-250628（arkcli 显示 Shutdown） | 免费 | 0.03 |

- 因内容审核等原因没有成功输出的图不计费。
- pro 图层拆分时，同一请求的各层可能落在不同像素档，每层按自己的实际档位单独计费。
- lite、4.5、4.0 的组图按实际生成的张数计费。
- `usage.generated_images` 只统计成功生成的张数。`output_tokens` = round(sum(宽×高)/256)。`total_tokens` 目前等于 `output_tokens`，因为输入 token 不计。
- 【推导】pro 的 `2K` 档：映射表中所有 2K 尺寸都在 419 万到 446 万像素之间，大于 261 万，按 0.09 计。`1K` 和 `1.5K` 映射尺寸最大约 237 万像素，按 0.045 计。用 `宽x高` 写法时，按实际像素是否大于 261 万判断档位。
- 【arkcli 元数据】`models get`：pro 有 ToIPrompt 0.003、ToICompletion 0.045 和 0.09、ToILayerCompletion 0.0225 和 0.045，与文档一致。flash 有 ToICompletion 0.018，另外有 ToILayerCompletion 0.018，文档只写了一个统一价。
- 来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing#c02be6ee ；image-generation-api `usage`。

---

## 5. 前端需要实现的约束与联动

### 5.1 按模型显示或隐藏控件

| 控件 | pro | flash | lite | 4.5 | 4.0 |
|---|---|---|---|---|---|
| size 档位 | 1K / 1.5K / 2K | 1K / 1.5K / 2K | 2K / 3K / 4K | 2K / 4K | 1K / 2K / 4K |
| 自定义宽高的像素校验 | [921,600, 4,624,220] | 同 pro | [3,686,400, 16,777,216] | 同 lite | [921,600, 16,777,216] |
| 参考图上限 | 10 | 10 | 14 | 14 | 14 |
| 组图开关和 max_images | 隐藏 | 隐藏 | 显示 | 显示 | 显示 |
| stream 开关 | 隐藏 | 隐藏 | 显示 | 显示 | 显示 |
| output_format | 显示 | 显示 | 显示 | 隐藏 | 隐藏 |
| background、layer_decomposition | 显示 | 显示 | 隐藏 | 隐藏 | 隐藏 |
| fast 模式 | 可选 | 不可选 | 不可选 | 不可选 | 可选 |
| 交互式编辑画布（点、框） | 显示 | 显示 | 隐藏 | 隐藏 | 隐藏 |

- 【推导】lite、4.5、4.0 开启组图时，要保证参考图数 + `max_images` ≤ 15。
- 【未核实】把不支持的参数传给不支持的模型会怎样（报错还是忽略），文档没有说明。建议发送前直接剔除这些字段。

### 5.2 `fast` 模式

只有 5.0 pro 和 4.0 支持。pro 教程中 "Only Seedream 5.0 pro supports this mode" 这句话只是在 pro 和 flash 之间比较。

### 5.3 透明背景 `background=transparent`（pro、flash）

- 只能用于图生图，而且**恰好 1 张带 alpha 通道的输入图**。
- 此模式默认输出 `png`。如果 `output_format=jpeg`，会报错。
- 输入图是 `jpeg` 这类不支持 alpha 的格式时，会报错。
- 编辑拆分出来的透明图层时，要保留透明背景，需同时设置 `background=transparent` 和 `output_format=png`。
- 【arkcli 元数据】arkcli 写的是“仅支持单张带 alpha 的 PNG”。正文只排除了不支持 alpha 的格式（如 jpeg），没有写只允许 PNG。
- 来源：image-generation-api；seedream-5-0-pro#transparent-background。

### 5.4 图层拆分 `layer_decomposition=true`（pro、flash）

- `image` 必填，只能 1 张 png 或 jpeg，像素在 [512×512, 6000×6000] 之间。
- `prompt` 可选。原文写明 cURL、Java、Go 可以不传，Python 和 OpenAI SDK 需要传。【推导】浏览器直接发 HTTP 请求时，情况等同于 cURL。
- 可以在 prompt 里用自然语言指定要拆的元素，也可以写归一化 `<bbox>` 指定区域，或者在输入图上涂鸦、圈选标出元素。
- `size` 只能用档位或 `auto`，默认 `auto`。
- `output_format` 只控制底图格式，图层固定 png。
- 只要有一层失败，整个请求就失败，不支持部分成功。prompt 要求的层数超过 16 层上限时，可能丢失部分图层信息。
- 每个请求先预扣 17 IPM，完成后按实际生成张数退回多扣的部分。
- 响应 `data[]` 中，`z_index=0` 是底图，图层从 1 开始递增，数值越大越靠上。图层另外返回：
  - `bounding_box.absolute`：像素坐标 `[left, top, right, bottom]`，基于输出底图坐标系；
  - `bounding_box.normalized`：`[0, 1000]` 的整数；
  - `name`、`description`。
  底图不返回 `bounding_box`。
- 还原图层时，先把图层缩放到 `w=right-left`、`h=bottom-top`，放到 `(left, top)`，再按 `z_index` 升序叠放。normalized 坐标乘以 W/1000、H/1000 换算，可能有取整误差。
- 来源：image-generation-api；seedream-5-0-pro#layer-decomposition。

### 5.5 交互式编辑（pro、flash）

交互式编辑**没有专门的 API 参数**，只靠 `image` 加带坐标标签的 `prompt`。

- 点：`<point>x y</point>`；框：`<bbox>x1 y1 x2 y2</bbox>`。
- 归一化坐标范围是 0-999，左上角是 `0,0`，右下角是 `999,999`。
- 换算公式：`x = round(x_px / 显示宽 * 1000)`，y 同理。官方 demo 再用 `clamp1000` 把结果夹到 [0, 999]。
- 注意：响应里 `bounding_box.normalized` 的范围是 [0, 1000]，两套坐标的边界不同。
- 示例：`Place the subject from Image 1 <bbox>179 283 796 986</bbox> at the position in Image 2 <bbox>118 331 933 871</bbox>.`
- 【推导，依据官方 demo 代码】prompt 里的 "Image N" 对应 `image` 数组的第 N 张。demo 按 prompt 中首次出现的顺序重新编号，并按同样的顺序组装 image 数组。
- 另一种方式是直接在参考图上手绘、涂鸦、圈选，再用自然语言描述位置。
- 多主体场景下，建议在 prompt 里加上目标描述（如 "the person on the left"）。不希望被改动的区域也可以框出来，并写明 "keep unchanged"。
- 官方 TouchEdit demo 是浏览器先请求自己的后端 `/api/generate`，再由后端用 `ARK_API_KEY` 调用 Ark，不是浏览器直接调用 Ark。
- 来源：seedream-5-0-pro-editing-guide；seedream-5-0-pro#interactive-edit。

### 5.6 流式响应（lite、4.5、4.0）

帧格式（API 文档 Streaming Output 示例）：
```
event: image_generation.partial_succeeded
data: {...}

event: image_generation.completed
data: {...}

data: [DONE]
```

事件类型：
- `image_generation.partial_succeeded`：包含 `type`、`model`、`created`、`image_index`（从 0 开始）、`url` 或 `b64_json`（由 `response_format` 决定）、`size`。
- `image_generation.partial_failed`：包含 `image_index` 和 `error{code, message}`，例如 `OutputImageSensitiveContentDetected`。
- `image_generation.completed`：包含 `usage`，其中有 `generated_images`、`output_tokens`、`total_tokens`。pro 和 flash 还有 `input_images`，但它们不支持流式。
- 顶层 `error`：整个请求失败时推送，例如缺少必填参数或鉴权失败。

【推导】`EventSource` 发不了 POST，也不能带 Authorization 头，需要用 `fetch` 加 `ReadableStream` 手动解析。文档示例中 `data:` 后的 JSON 是多行排版的，解析时要按空行分隔事件。

来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses ；image-generation-api。

### 5.7 响应字段（非流式）

- 顶层：`created`、`model`（格式为 `model name-version`）、`data[]`、`usage`、`error`。
- `data[]` 通用字段：`url` 或 `b64_json`、`size`。`output_format` 只有 pro/flash 返回。图层拆分额外返回 `z_index`、`name`、`description`、`bounding_box`。组图额外返回 `error`。
- `usage`：`generated_images`、`input_images`（只有 pro/flash）、`output_tokens`、`total_tokens`。
- 来源：image-generation-api。

### 5.8 其他

- 结果 URL 只保留 24 小时，需要及时下载或转存。
- `watermark` 默认 `true`。不想要水印时，要显式传 `false`。
- IPM 按“同一账号下同一模型版本”每分钟生成的图片数统计，超限返回 429 `ModelAccountIpmRateLimitExceeded`。
- 前端需要提示的常见错误码（error-codes）：
  - 内容审核：`InputTextSensitiveContentDetected`、`InputImageSensitiveContentDetected`、`InputImageSensitiveContentDetected.PrivacyInformation`（输入图可能含真人）、`InputImageSensitiveContentDetected.PolicyViolation`（版权）、`OutputImageSensitiveContentDetected`、`OutputImageSensitiveContentDetected.DeepFake`；
  - 图片地址：`InvalidImageURL.EmptyURL`、`InvalidImageURL.InvalidFormat`（Base64 格式错误或无法解析）。
- 来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes ；seedream-4-0-5-0#31037d05。

---

## 6. 【arkcli 元数据】与官方文档的差异（只作参考，前端不应依赖）

> 2026-10-08 补充：其中 `negative_prompt` / `seed` / `optimize_prompt` 已在 5.0 flash 实测，结果见 [catalog-params-test.md](catalog-params-test.md)。

`arkcli models search seedream` 返回的 `supported_params` 有以下问题：

- pro/flash 的 `stream` 标为 support=true，与正文“不支持”矛盾。
- pro/flash 的 `prompt` 标为 required=true，与正文“图层拆分场景可选”矛盾。
- 列出了正文没有的字段：
  - `negative_prompt`（默认 "nsfw"）
  - `seed`（[-1, 2147483647]，默认 -1）
  - `optimize_prompt`（默认 true）
  - `optimize_prompt_options.thinking`（pro 默认 auto；flash 的 enum 是 auto/enabled）
  - `layer_image`、`layer_size`
  - `guidance_scale`、`image_guidance_scale`、`inner_guidance_scale_options`（都是 support=false）
- pro 的 `image` 总像素写成 [512×512, 4096×4096]，与正文的 [196, 6000×6000] 不一致。
- pro/flash 的 prompt 硬上限写成 400000 字符。
- flash 的 size 注明 "3K is pending confirmation"。
- lite 的 `tools` 写着只支持 `web_search`，`output_format` 写着“只有 lite 可设置”，但两处的 `supported_models` 都是 `doubao-seedream-5-0-lite-260128`，这是 BytePlus 文档里没有的命名。
- 4.5、4.0、3.0 t2i 的 supported_params 是 null。
- `models get` 的 `api_support` 自相矛盾：pro 的 Image Generation 显示 supported=false，flash 显示 true。
- `pricing.state`：pro 是 Available，flash 是 Unavailable。含义文档没有说明，推测是调研所用账号（个人档示例）的开通状态。

---

## 7. Gaps（原文未读到或有矛盾，需要实测或向官方确认）

1. **pro 方式 2 的默认值有矛盾**：image-generation-api 和 seedream-5-0-pro 写的是档位写法默认 `2K`；seedream-4-0-5-0 的 Method 2 表里 seedream-5-0-pro 的 Default value 是 `1024x1024`。不传 size 时实际用哪个，没有说明。flash 在 Method 2 表里没有单独一列。
2. **lite、4.5、4.0 档位写法的默认值**文档没有说明，只写了像素写法默认 `2048x2048`。
3. **Seedream 4.0 的 1K 映射两处不一致**：
   - API 文档：16:9=1280x720，9:16=720x1280，21:9=1512x648；
   - 教程：16:9=1312x736，9:16=736x1312，21:9=1568x672。
4. **`tools` 字段**只出现在 OpenAPI 中，取值和适用模型都没有说明。pro/flash 明确不支持 web search。lite、4.5、4.0 是否支持，文档没有写。
5. **不支持的参数传给不支持的模型会怎样**（报错还是忽略），文档没有说明。例如给 pro/flash 传 `sequential_image_generation` 或 `stream`，给 4.5/4.0 传 `output_format`，给 flash/lite/4.5 传 `fast`。
6. **两套归一化坐标边界不同**：交互编辑输入是 [0, 999]，公式 `round(x/w*1000)` 可能算出 1000，demo 用 clamp 处理；`bounding_box.normalized` 的输出范围是 [0, 1000]。
7. **pro 的“第 2 张起每张 0.003”是否适用于图层拆分**，没有说明。flash 图层拆分的价格，文档只写了统一价 0.018。
8. **Seedream 3.0 t2i 和 SeedEdit 3.0 i2i** 在当前 API 文档里没有参数说明。
9. **浏览器能否直接跨域调用 `ark.ap-southeast.bytepluses.com`（CORS）**，文档没有说明。官方交互编辑 demo 用的是后端代理。另外，在浏览器里保存 API Key 有安全风险，文档同样没有给出浏览器端的使用指引。
10. **透明背景能否与图层拆分、坐标标签同时使用**，文档没有说明。
11. **pro/flash 非图层拆分场景下是否必须传 prompt**：正文写的是 "Image generation scenario Required"，但 OpenAPI 的 required 只有 `model`。
12. **流式 SSE 中 `data:` 是单行还是多行 JSON**：文档示例是多行排版，实际帧格式需要实测。


## corrections
[
 {
  "claim": "第 1 节：建议前端只提供前 5 个模型，因为“3.0 和 SeedEdit 已退役或下线”",
  "problem": "措辞不准。arkcli models search 返回的状态是 seedream-3-0-t2i=Retiring（退役中），seededit-3-0-i2i=Shutdown。3.0 还没有退役完成。另外这两个状态都只来自 arkcli 元数据，官方 model-list 的图像生成表里根本没有这两个模型，文档没写它们的生命周期状态。",
  "correct_fact": "seedream-3-0-t2i-250415 在 arkcli 中是 Retiring，seededit-3-0-i2i-250628 是 Shutdown。官方 model-list#9df4d9fd 图像生成表只列了 5 个模型：pro、flash、lite、4.5、4.0。model-pricing 仍保留 seededit-3-0-i2i-250628 一行价格（输入免费，输出 0.03）。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list"
 },
 {
  "claim": "第 2 节能力矩阵：“原生多语言文字生成（另外 14 种语言）”一行，lite/4.5/4.0 标为 ✗",
  "problem": "这一行把两件事混在了一起，而且 ✗ 下得过重。API 文档 prompt Note 讲的是提示词语言：“All models support Chinese and English prompts”，pro/flash “also support” 另外 14 种语言。pro 教程讲的是图中文字原生生成 14 种语言。对 lite/4.5/4.0，文档只是没有列出这项能力，没有写“不支持”。seedream-4-0-5-0 的能力表里也没有多语言这一行。",
  "correct_fact": "提示词语言：全部模型支持中英文，pro/flash 另外支持俄、阿、菲、泰、土、韩、马来、西、葡、印尼、法、德、越、日 14 种。原生多语言图中文字生成：只有 pro/flash 的教程列为特色能力。lite/4.5/4.0 应标为“文档未列出（推导为不支持）”，不能当作原文明确写了 ✗。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "gaps：seedream-4-0-5-0 教程的 size 档位和像素表只列了 seedream-5-0-pro，没有单独列 flash；flash 的数据来自 pro/flash 合写段落",
  "problem": "只说对一半。同一教程顶部的 Model capabilities 表有独立的 seedream-5-0-flash 列，写明 Resolution 为 1K、1.5K、2K，Output format 为 png、jpeg，Prompt optimization mode 为 standard mode。API 文档 size 小节的标题也明确是“Seedream 5.0 pro / Seedream 5.0 flash (image generation scenario)”。所以 flash 的档位和像素范围有直接原文支撑，不只是推导。",
  "correct_fact": "flash 的档位 1K/1.5K/2K（默认 2K）和像素范围 [921,600, 4,624,220] 在 image-generation-api 中按 pro/flash 合并写明。flash 的档位和输出格式也在 seedream-4-0-5-0 能力表的 flash 列中写明。只有 Method 1 的枚举列表和 Method 2 约束表只写了 seedream-5-0-pro。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0"
 },
 {
  "claim": "gaps：seedream-4-0-5-0 的 output_format 段只写 pro 和 lite 可设置、没提 flash，与 API 文档 Supported models 冲突",
  "problem": "这不是实质冲突，只是那一段漏写了 flash。同一页的 Model capabilities 表中 flash 的 Output format 是 png, jpeg，API 文档 output_format 的 Supported models 也列了 Seedream 5.0 flash。",
  "correct_fact": "output_format 支持 pro、flash、lite，有 API 文档和教程能力表两处支撑。4.5 和 4.0 固定为 jpeg，原文是“defaults to jpeg and does not support custom settings”。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "第 5.5 节：prompt 里用 \"Image 1\"、\"Image 2\" 指代 image 数组里的第几张图",
  "problem": "正文没有明确写“Image N 对应 image[N-1]”。这个对应关系来自 TouchEdit demo 的 buildModelInputFromPrompt 代码：标签按 prompt 中首次出现的顺序重新编号，同时按这个顺序组装 images 数组。报告把它写成了原文结论。",
  "correct_fact": "应标为【推导，依据官方 demo 代码】。demo 让 inputImages 的顺序和 prompt 中 Image 1、Image 2 的编号一致，后端把这个数组原样作为 image 传入；单张时传字符串，多张时传数组。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-5-0-pro-editing-guide"
 },
 {
  "claim": "第 3.1 节：fast 只有 pro 和 4.0 支持（结论正确，但没说明 pro 教程里有一句看似矛盾的话）",
  "problem": "结论本身有原文支撑。不过 seedream-5-0-pro 教程写的是“Only Seedream 5.0 pro supports this mode”，这句只在 pro/flash 两个模型的范围内成立。如果不加说明，读者可能误以为 4.0 不支持 fast。",
  "correct_fact": "API 文档：flash、lite、4.5 “do not currently support this mode”。seedream-4-0-5-0 教程：“Seedream 5.0 pro and Seedream 4.0 support … fast”。pro 教程中的 “Only Seedream 5.0 pro” 只是 pro 与 flash 之间的比较。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0"
 },
 {
  "claim": "第 3.1 节参数表中 output_format、response_format、optimize_prompt_options.mode、sequential_image_generation 的枚举值（隐含来自 schema）",
  "problem": "OpenAPI 合约 image-generation-ImageGenerations_generate 里，只有 background 带 enum [transparent, opaque]（default opaque）。OutputFormat、ResponseFormat、OptimizePromptMode、SequentialImageGenerationMode 都只是 type:string，没有 enum。size 也只是 string。这些枚举只来自文档正文，前端不能指望用 schema 自动生成下拉选项。",
  "correct_fact": "schema 中带约束的只有：model required；background enum 加 default opaque；layer_decomposition default false；stream default false；watermark default true；max_images 的 min 1、max 15、default 15；Tool.type required。其他枚举值以正文为准。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 }
]

## missing_items
- 流式 SSE 帧格式：每个事件是 `event: <type>` 加 `data: {...}`，流以 `data: [DONE]` 结束（API 文档 Streaming Output 示例）。浏览器端需要用 fetch 加 ReadableStream 自己解析，因为 EventSource 发不了 POST，也不能带 Authorization 头。后一点是【推导】。
- 流式事件里 image_index 从 0 开始。partial_succeeded 只在 response_format=url 时带 url，只在 b64_json 时带 b64_json。整个请求失败时（如缺少必填参数、鉴权失败）推送顶层 error 事件（image-generation-streaming-responses）。
- 响应字段 usage.input_images（只有 pro/flash 返回）和 data[].output_format（只有 pro/flash）。报告没有列出。
- 非流式响应：data[].error 只出现在组图场景（lite/4.5/4.0），表示单张失败。一张图都没生成时返回顶层 error。响应中的 model 格式是 `model name-version`。
- 实际输出尺寸不一定等于档位映射表里的值。官方示例：pro 用 size=2K 返回 1760x2368，lite 用 2K 返回 2720x1536，都不在映射表中。文档也写了映射“not limited to these standard values”。前端应以 data[].size 为准，不要按档位硬编码预览尺寸。
- 图层拆分的 prompt 里也可以写归一化 `<bbox>` 指定要拆的区域（0-999 坐标），或者在输入图上涂鸦、圈选标出元素（seedream-5-0-pro Prompt tips）。
- 编辑拆分出来的透明图层时，要保留透明背景，需同时设置 background=transparent 和 output_format=png（seedream-5-0-pro “Edit a transparent layer” Warning）。
- IPM 的统计口径是“同一账号下同一模型版本”每分钟生成的图片数，超限报错（seedream-4-0-5-0 Usage limitations）。对应错误码是 429 ModelAccountIpmRateLimitExceeded（error-codes）。
- 与图像相关、需要在前端提示用户的错误码（error-codes）：InputTextSensitiveContentDetected、InputImageSensitiveContentDetected、InputImageSensitiveContentDetected.PrivacyInformation（输入图可能含真人）、InputImageSensitiveContentDetected.PolicyViolation（版权）、OutputImageSensitiveContentDetected、OutputImageSensitiveContentDetected.DeepFake、InvalidImageURL.EmptyURL、InvalidImageURL.InvalidFormat（Base64 格式错误或无法解析）。
- OpenAPI 的 Tool schema：tools 是数组，元素为 {type}，type 必填且 ToolType 只是 string。正文没有说明取值和适用模型。arkcli 元数据声称只有 lite 支持 web_search，未经证实。pro/flash 正文明确写了 web search “not currently supported”。
- arkcli 元数据里还有 optimize_prompt_options.thinking 子字段（pro 默认 auto；flash 的 enum 是 auto/enabled），以及 guidance_scale、image_guidance_scale、inner_guidance_scale_options（都是 support=false）。pro/flash 的 prompt 标为 required=true，与正文“图层拆分场景 prompt 可选”冲突。这些都不应采信。
- 把不支持的参数传给不支持的模型会怎样（报错还是忽略），文档都没有说明。例如给 pro/flash 传 sequential_image_generation 或 stream，给 4.5/4.0 传 output_format，给 flash/lite/4.5 传 fast。前端应在发送前直接剔除这些字段。

## gaps
- 5.0 pro 的 size 默认值两处文档不一致：image-generation-api 和 seedream-5-0-pro 写档位写法默认 `2K`，但 seedream-4-0-5-0 的 Method 2 表里 seedream-5-0-pro 的 Default value 写的是 `1024x1024`。不传 size 时实际按哪个默认值，没有读到说明。
- lite、4.5、4.0 只写了像素写法默认 `2048x2048`，档位写法（2K/3K/4K 等）的默认值文档未说明。
- Seedream 4.0 的 1K 档宽高映射两处文档不一致：API 文档 16:9=1280x720、9:16=720x1280、21:9=1512x648；教程表 16:9=1312x736、9:16=736x1312、21:9=1568x672。
- seedream-4-0-5-0 教程的 size 档位和像素表只列了 seedream-5-0-pro，没有单独列 flash。flash 的 1K/1.5K/2K 和像素范围来自 5.0 pro/flash 教程和 API 文档里 pro/flash 合写的段落。
- `tools` 字段只在 OpenAPI schema 里出现（数组，元素是 {type}，type 必填），API 文档请求体正文没有描述它的取值和适用模型。只能确定 pro/flash 不支持 web search；lite、4.5、4.0 是否支持 web_search，官方文档里没有读到（arkcli 元数据说只有 lite 支持，但用的是 doubao- 前缀的 ID，未证实）。
- arkcli models search 的 supported_params 与官方文档有多处冲突（pro/flash stream=true，negative_prompt、seed、optimize_prompt、layer_image、layer_size 这些字段，image 像素上限 4096×4096，prompt 硬上限 400000 字符，flash 3K 待确认）。正文里没有这些参数，没有采信。
- 交互式编辑坐标：指南写范围是 [0,999]，但给的公式 round(x_px/width*1000) 可能算出 1000，官方 demo 代码把结果夹到 999；响应里 bounding_box.normalized 用的是 [0,1000]。两套坐标的边界定义不同。
- pro 的“第 1 张输入图免费，从第 2 张起 0.003/张”是否也适用于图层拆分场景，没有说明；flash 图层拆分是否同为 0.018/张，文档只写了一个统一价，arkcli 里的 ToILayerCompletion 是 0.018。
- 定价是官方标价（USD/张），没有考虑账号折扣。arkcli models get 返回的 pricing.state（Available/Unavailable）的含义文档未说明，推测是调研所用账号（个人档示例）的开通状态。
- Seedream 3.0 t2i（seedream-3-0-t2i-250415，Retiring）和 SeedEdit 3.0 i2i（seededit-3-0-i2i-250628，arkcli 显示 Shutdown，但定价表里仍列着）在当前 API 文档里没有参数说明（例如 guidance_scale、seed），我没有读到它们的参数。
- seedream-4-0-5-0 能力表的 'Number of generated images' 一行，只有 lite 列写了“参考图+生成图≤15”，4.5 和 4.0 两列是空的（应该是合并单元格）。三者共用这条规则以 image-generation-api 为准。
- pro/flash 在非图层拆分场景下 prompt 是否必须传：API 文档写 'Image generation scenario Required'，但 OpenAPI schema 的 required 只有 model。
- 浏览器能否直接跨域调用 ark.ap-southeast.bytepluses.com（CORS），我读的文档里没有说明；官方交互编辑 demo 用的是后端代理。
- 透明背景能否和图层拆分、交互式编辑坐标同时使用，文档没有说明，只写了“仅图生图且恰好 1 张带 alpha 输入图”。
- seedream-4-0-5-0 的 output_format 段写的是“seedream-5-0-pro 和 seedream-5-0-lite 可以设置”，没有提 flash；但 API 文档的 output_format Supported models 列了 5.0 pro、5.0 flash、5.0 lite。