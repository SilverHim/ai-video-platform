很抱歉，这次核查没能直接写出最终报告正文，下面是修正后的完整报告（核查版）。

# Seedance 视频生成任务 API 调研报告（核查版）

**核查方式**：用 arkcli docs 逐页重读了官方原文（BytePlus ap-southeast-1，revision 265），并解析了 `docs apis spec` 的 OpenAPI 合约。全程没有带 API Key 调用任何接口。
**标注约定**：
- 【未核实】：原文没有这项内容。
- 【文档矛盾】：不同页面的说法不一致。
- 【推断】：根据原文推出，原文没有直接写。

---

## 0. 来源代号

| 代号 | URL |
|---|---|
| [C] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api |
| [G] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api |
| [L] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api |
| [D] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/cancel-or-delete-video-generation-tasks-api |
| [T] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial（锚点见下） |
| [S25] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5 |
| [S20] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-0 |
| [E] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes |
| [ML] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#7571da3f |
| [DEP] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-deprecation-notice |
| [P] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide |
| [OAS-C/G/L/D] | OpenAPI id：`content-generation-ContentGenerationTasks_create-video`、`_get-video`、`_list-video`、`_delete-video`。servers 为 `https://ark.ap-southeast.bytepluses.com`，security 为 BearerAuth |

[T] 的锚点：
- `#e7b4c498` 能力矩阵
- `#9fe4cce0` 输出规格
- `#a0badaae` 离线推理
- `#5acd28c8` Draft
- `#caf01f12` Webhook
- `#66cb028f` 限制
- `#f76aafc8` 裁剪规则

---

## 1. 接口总览

| 操作 | 方法 + URL | 来源 |
|---|---|---|
| 创建任务 | `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` | [C][OAS-C] |
| 查询单个任务 | `GET .../api/v3/contents/generations/tasks/{id}` | [G][OAS-G] |
| 任务列表 | `GET .../api/v3/contents/generations/tasks?page_num=&page_size=&filter.status=&filter.task_ids=&filter.model=&filter.service_tier=` | [L][OAS-L] |
| 取消或删除 | `DELETE .../api/v3/contents/generations/tasks/{id}` | [D][OAS-D] |

**认证**：四个接口都写着 "supports only API Key authentication"，请求头为 `Authorization: Bearer $ARK_API_KEY` 和 `Content-Type: application/json` [C][G][L][D]。

**异步流程**：创建接口只返回 `{"id":"cgt-..."}`，结果要靠轮询查询接口或者用 `callback_url` 拿 [C]。
- 官方 SDK 示例每 10 秒轮询一次，总超时 30 分钟。这只是示例写法，不是硬性规定 [C]。

**非推理接口的账号级 QPS**：查询 20、列表 **1**、取消/删除 20 [T#66cb028f][S25#2.5_rate_limits]。

**浏览器直连（CORS）**：【未核实】所读文档都没有涉及。

### 1.1 模型 ID 与状态

| 模型 | Model ID | 状态 | 来源 |
|---|---|---|---|
| Dreamina Seedance 2.5 | `dreamina-seedance-2-5-260628` | 可用 | [ML][T#e7b4c498] |
| Dreamina Seedance 2.0 | `dreamina-seedance-2-0-260128` | 可用 | 同上 |
| Dreamina Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | 可用 | 同上 |
| Dreamina Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | 可用 | 同上 |
| Seedance 1.5 pro | `seedance-1-5-pro-251215` | **Retired**，推荐替换为 `dreamina-seedance-2-0-mini-260615` | [ML][DEP] |
| Seedance 1.0 pro | `seedance-1-0-pro-250528` | 可用 | [ML] |
| Seedance 1.0 pro fast | `seedance-1-0-pro-fast-251015` | 可用 | [ML] |

**1.5 pro 的弃用时间线**（[DEP] 第四批）：
- 2026-09-08 首次通知，从这天起配额逐步下调；
- 2026-09-15 为 Deprecation Date，之后不能新建基于它的推理接入点；
- 2026-11-11 17:00（UTC+8）后停止服务，**不会自动迁移**。

**创建文档 Base64 示例里的模型** `seedance-1-0-lite-i2v-250428`：
- [DEP] 第三批列了 `bytedance-seedance-1-0-lite-i2v-250428`，已于 2026-05-13 下线；
- 两者 ID 前缀不同，【推断】是同一个模型。前端不要照抄这个示例里的 model。

**其他说明**：
- `model` 字段也可以填 Endpoint ID [C]。
- **开通前提**（[C]）：开通 2.0 / 2.5 前需要满足以下任一条件：
  - 账户余额大于 USD 30；
  - 购买 USD 30 及以上档位的 AI Savings Plan；
  - 持有还有余量的 Seedance 资源包。

### 1.2 各模型支持的任务类型（[C][T#e7b4c498]）

- **2.5、2.0 系列**：文生视频、首帧、首尾帧、全能参考（参考生视频 / 视频编辑 / 视频延长）。
- **1.5 pro、1.0 pro**：文生视频、首帧、首尾帧。
- **1.0 pro fast**：只有文生视频和首帧。

---

## 2. 创建任务：请求体

OpenAPI 的 `required` 只有 `model` 和 `content` 两个字段 [OAS-C]。

### 2.1 顶层参数

| 字段 | 类型 | 默认值 | 取值 | 适用模型 | 要点 | 来源 |
|---|---|---|---|---|---|---|
| `model` | string，必填 | — | Model ID 或 Endpoint ID | — | 用 Endpoint ID 可以使用该端点的限流、计费方式、状态和监控、安全等能力 | [C] |
| `content` | object[]，必填 | — | 见 2.2 | — | — | [C][OAS-C] |
| `omni_reference_task_type` | string | `auto` | `auto` / `reference` / `edit` / `extend` | 只列了 2.5 | 详见 3.3 | [C][OAS-C] |
| `resolution` | string | 2.5、2.0、2.0 fast、2.0 mini、1.5 pro 为 `720p`；1.0 pro、1.0 pro fast 为 `1080p` | OAS 枚举：`480p` `720p` `1080p` `4k` | 见下方分模型取值 | 2.5 的 1080p 和 2.0 的 4k 都是 10-bit + H.265/HEVC，部分播放器放不了 | [C][OAS-C] |
| `ratio` | string | 2.5、2.0 系列、1.5 pro 为 `adaptive`；1.0 pro / pro fast：文生视频 `16:9`，图生视频 `adaptive` | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` `adaptive` | 全部列出的模型 | 见下方限制 | [C] |
| `duration` | integer | 2.5 为 `-1`；其余为 `5` | 见下方分模型取值。OAS 没有 min/max | — | 与 `frames` 二选一，**`frames` 优先** | [C][T#9fe4cce0] |
| `frames` | integer | 未说明 | `[29,289]` 内满足 `25+4n`（n 为正整数）的整数；OAS 写的是 min 29 / max 289 | 只列了 1.0 pro、1.0 pro fast | 帧数 = 时长 × 24 | [C][OAS-C][T] |
| `generate_audio` | boolean | `true` | — | 2.5、2.0 系列、1.5 pro | 带音频的视频一律是单声道 | [C][OAS-C] |
| `watermark` | boolean | `false` | — | 文档未列适用模型 | true 时右下角加 "AI Generated" 水印 | [C][OAS-C] |
| `output_format` | string | `mp4` | `mp4` / `mov` | 只列了 2.5 | mov 用 H.264 + YUV 4:4:4 + PCM 音频，部分播放器不兼容 | [C][OAS-C] |
| `seed` | integer | `-1` | `[-1, 2147483647]` | 只列了 1.5 pro、1.0 pro、1.0 pro fast（2.x 的情况见 gaps） | -1 表示随机。相同 seed 只保证结果相似，不保证完全一致 | [C][OAS-C] |
| `camera_fixed` | boolean | `false` | — | 只列了 1.5 pro、1.0 pro、1.0 pro fast | 参考图场景不支持。平台会在 prompt 后追加固定镜头指令，但不保证效果 | [C] |
| `return_last_frame` | boolean | `false` | — | [C] 没写 Supported models；能力矩阵里所有模型都打 ✓ | 返回 jpeg 尾帧，尺寸与视频一致、无水印。1.5 pro 的 Draft 阶段不支持 | [C][T#e7b4c498][T#5acd28c8] |
| `draft` | boolean | `false` | — | 只列了 2.5、1.5 pro | 开启后只能生成 480p，用其他分辨率会报错 | [C] |
| `service_tier` | string | `default` | `default`（在线）/ `flex`（离线，价格为在线的 50%） | `flex` 不支持 2.5 和 2.0 系列；1.5 pro 的 Draft 也不支持离线 | 任务提交后不能修改。不支持时报 `InvalidParameter.UnsupportedParameter` | [C][T#a0badaae][E] |
| `callback_url` | string | 未说明 | URL | 文档未列适用模型 | 详见 5.3 | [C] |
| `execution_expires_after` | integer | `172800`（48 小时） | `[3600, 259200]` 秒 | 文档未列适用模型 | 从 `created_at` 开始计时，超时后任务被终止并标记为 `expired` | [C][OAS-C] |
| `priority` | integer | `0` | `[0, 9]` | 2.5、2.0 系列 | 数值越大越优先。只在同一 Endpoint 内调整 queued 任务的顺序，同优先级按 FIFO，不会打断 running 任务。`flex` 不支持 priority | [C][OAS-C] |
| `safety_identifier` | string | 未说明 | 长度不超过 64（OAS maxLength 64） | 文档未列适用模型 | 终端用户的固定唯一标识（英文字符串），建议传哈希值 | [C][OAS-C] |
| `tools` | `{type:string}[]` | 未说明 | 未说明 | 未说明 | 只出现在 OpenAPI 里，正文没有说明【未核实】 | [OAS-C] |

**`resolution` 分模型取值** [C]：

| 模型 | 支持的分辨率 |
|---|---|
| 2.5 | 480p / 720p / 1080p |
| 2.0 | 480p / 720p / 1080p / 4k |
| 2.0 fast、2.0 mini | 480p / 720p |
| 1.5 pro、1.0 pro、1.0 pro fast | 480p / 720p / 1080p |

**`ratio` 的限制** [C][S25#2.5_ratio]：
- 1.0 系列的文生视频不支持 `adaptive`。
- 2.5 的首帧、首尾帧、视频编辑、视频延长任务只支持 `adaptive`，不能指定其他比例。

**`duration` 分模型取值** [C][T#9fe4cce0]：

| 模型 | 默认值 | 取值范围 |
|---|---|---|
| 2.5 | `-1` | `[4,30]` 或 `-1` |
| 2.0 系列 | `5` | `[4,15]` 或 `-1` |
| 1.5 pro | `5` | `[4,12]` 或 `-1` |
| 1.0 pro、1.0 pro fast | `5` | `[2,12]`（文档没有列出 -1，传 -1 的行为未说明） |

- 2.5 视频编辑任务的 `duration` 只能是 `-1`（见 3.2）。

### 2.2 `content[]` 的元素类型

OAS 中 `content[]` 是 `oneOf`，以 `type` 作为 discriminator [OAS-C]。

| type | 必填子字段 | `role` 枚举 | 要点 | 来源 |
|---|---|---|---|---|
| `text` | `text` | — | 见下方说明 | [C][S25#2.5_multi_language] |
| `image_url` | `image_url.url` | `first_frame` / `last_frame` / `reference_image`（部分场景必填） | `url` 可以是公网 URL、`data:image/<小写格式>;base64,...`，或 `asset://<ASSET_ID>` | [C][OAS-C] |
| `video_url` | `video_url.url` | `reference_video`（有条件必填） | 原文只列了 URL 和 `asset://` 两种写法，没有 Base64。只有 2.5 和 2.0 系列支持 | [C][T#66cb028f] |
| `audio_url` | `audio_url.url` | `reference_audio`（有条件必填） | URL、`data:audio/<小写格式>;base64,...` 或 `asset://`。只有 2.5 和 2.0 系列支持 | [C] |
| `draft_task` | `draft_task.id` | — | 用 Draft 任务 ID 生成正式视频。只有 2.5 和 1.5 pro 支持 | [C][OAS-C] |

**`text` 的说明**：
- 建议长度不超过 500 个中文字符或 1000 个英文单词 [C]。
- 支持的提示词语言【文档矛盾】：

| 来源 | 说法 |
|---|---|
| [C] | 所有模型都支持英文；2.5 另外支持 es / id / pt / ja / ms / th / ar / vi / ko；2.0 系列另外支持 es / id / pt / ja。清单里没有中文 |
| [S25#2.5_multi_language] | 2.5 原生支持 Chinese、English 等 11 种语言 |

**提示词里引用素材** [P]：
- 要用“素材类型 + 序号”，例如 `Image 1` / `@Image1`；
- 序号是该素材在请求体同类素材中的排列顺序；
- 不要把 asset ID 写进提示词。

**`role` 规则** [C]：
- **首帧**（所有模型）：传 1 个 `image_url`，`role` 填 `first_frame` 或者不填。
  - 【文档矛盾】2.5 页的配置方法写的是 content 必须包含一张 `role` 为 `first_frame` 的图 [S25#2.5_param_constraints]。建议前端始终显式写 role。
- **首尾帧**（2.5、2.0 系列、1.5 pro、1.0 pro）：
  - 必须传 2 个 `image_url`，`role` 必填，分别为 `first_frame` 和 `last_frame`；
  - 首尾帧可以是同一张图；
  - 两张图宽高比不一致时以首帧为准，尾帧会被自动裁剪。
- **参考图**（2.5 支持 1–30 张，2.0 系列支持 1–9 张）：每张图的 `role` 都必须是 `reference_image`。
- **互斥**：首帧、首尾帧、全能参考（参考图 / 视频 / 音频）三类场景**不能混用**。
  - 想要“首尾帧 + 参考”的效果，只能在 prompt 里指定某张参考图作为首帧或尾帧，属于间接实现；
  - 要求首尾帧严格一致时，必须用 `first_frame` / `last_frame`。

### 2.3 合法组合与数量上限

**合法组合** [C]：
- Text
- Text(可选) + image
- Text(可选) + video
- Text(可选) + audio（只有 2.5 支持纯音频输入）
- Text(可选) + image + audio
- Text(可选) + image + video
- Text(可选) + video + audio
- Text(可选) + image + video + audio
- 样例任务 ID（draft_task）

**数量上限**：

| 模型 | 参考图 | 参考视频 | 参考音频 | 合计 | 来源 |
|---|---|---|---|---|---|
| 2.5 | 0–30 | 0–10，总时长 ≤ 30 秒 | 0–10，总时长 ≤ 30 秒 | 50 | [C][S25#2.5_capability_overview] |
| 2.0 系列 | 0–9 | 0–3，总时长 ≤ 15 秒 | 0–3，总时长 ≤ 15 秒 | 15 | 同上 |

- 2.0 系列不能纯音频，至少要有 1 张图或 1 段视频 [C]。
- 首帧任务传 1 张图，首尾帧任务传 2 张图 [C]。

**人脸限制**：2.5 和 2.0 系列不支持直接上传含真人人脸的参考图或视频 [C][P]。可行的替代方式：

1. **可信输出**：本账号近 30 天内生成的原始输出可以作为素材。范围：
   - 2.5 / 2.0 系列生成的含人脸视频（2026-03-11 起）；
   - 这些视频对应的尾帧（2026-04-16 起）；
   - Seedream 5.0 lite 文生图得到的含人脸图片（2026-04-16 起）。
   - 限制：只认同平台、同账号、未经二次编辑的原始输出；压缩或转发文件可能导致信任失效。
2. **预置数字人**：用 `asset://<id>`。
3. **已授权的真人素材**：经过实名认证和授权、入库后，同样得到 `asset://<id>`。

对应错误码：`InputImageSensitiveContentDetected.PrivacyInformation`、`InputVideoSensitiveContentDetected.PrivacyInformation` [E]。

### 2.4 输入素材规格

来源：[C][T#66cb028f][S25#2.5_usage_limits]

| 项目 | 图片 | 视频 | 音频 |
|---|---|---|---|
| 写法 | URL / Base64 / `asset://` | URL / `asset://` | URL / Base64 / `asset://` |
| 格式 | jpeg、png、webp、bmp、tiff、gif；heic / heif 见下方说明 | mp4、mov。视频编码 H.264/AVC 或 H.265/HEVC，音频编码 AAC 或 MP3（2.5 页的 mov 额外列了 PCM） | wav、mp3 |
| 宽高比 | `[0.4, 2.5]`（区间开闭见下方说明） | `[0.4, 2.5]` | — |
| 宽、高像素 | `[300, 6000]`（区间开闭见下方说明） | `[300, 6000]`，且宽×高在 `[407696, 8295044]` 之间 | — |
| 分辨率 / 帧率 | — | 480p / 720p / 1080p / 4k；FPS `[24, 60]` | — |
| 单个大小 | 小于 30 MB | 不超过 200 MB | 不超过 15 MB |
| 请求体 | 不超过 64 MB，大文件不要用 Base64 | — | 不超过 64 MB，大文件不要用 Base64 |
| 单个时长 | — | 见下方 | 见下方 |

**heic / heif 的支持范围**【文档矛盾】：
- [C] 写的是 1.5 pro 及以后的模型；
- [T] 写的是 1.5 Pro 和 2.0 系列；
- [S25] 对 2.5 也列了。

**图片宽高比和宽高像素的区间开闭**【文档矛盾】：[C] 和 [S25] 用闭区间，[T] 用开区间 `(0.4, 2.5)`、`(300, 6000)`。

**单个时长**：

| 模型 | 视频 | 音频 |
|---|---|---|
| 2.5 | 非编辑任务 2–30 秒，编辑任务 4–30 秒 | 2–30 秒 |
| 2.0 系列 | 2–15 秒 | 2–15 秒 |

**图生视频的裁剪规则**：`ratio` 与原图宽高比不一致时会居中裁剪，不留黑边 [T#f76aafc8]。

### 2.5 输出像素与帧率（节选，完整表见 [C]、[T#9fe4cce0]）

- 720p 16:9：1280×720，只有 1.0 系列是 1248×704。
- 1080p 16:9：1920×1080，1.0 系列是 1920×1088。2.0 fast 和 mini 不支持 1080p。
- 4k 只有 2.0 支持，16:9 为 3840×2160。
- 480p 16:9：2.5 是 854×480，2.0 和 1.5 pro 是 864×496，1.0 是 864×480。
- 输出帧率都是 24 fps [T#e7b4c498]。

**输出格式**【文档矛盾】：[T#e7b4c498] 能力矩阵里 2.5 只写了 MP4；[S25] 和 [ML] 都写 2.5 支持 mp4 / mov。

---

## 3. 参数写法与任务约束

### 3.1 旧写法：在 prompt 后追加 `--参数`

- **仍然支持**。对 `resolution`、`ratio`、`duration`、`frames`、`seed`、`camera_fixed`、`watermark` 这 7 个参数，所有模型都接受两种写法：写在请求体里，或者追加在 prompt 后面 [C][T#9fe4cce0]。
  - 这里说的是传参方式。参数本身支持哪些模型，仍以 2.1 的适用模型为准。
- 两种写法的校验方式不同：
  - 请求体字段（推荐）是**强校验**，非法值直接报错；
  - `--` 写法是**弱校验**，非法值会被忽略或报错。
- 官方示例给出的缩写：`--rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true`。
- 【未核实】：
  - `frames` 的缩写；
  - 同时用 JSON 字段和 `--` 写法时谁优先（全文检索没有找到）；
  - `generate_audio`、`output_format` 等参数不在支持 `--` 写法的清单里。

### 3.2 `duration = -1` 与返回的 duration

- **2.0 系列、1.5 pro、2.5 的非编辑任务**：模型在合法范围内自选**整秒**时长。
- **2.5 的编辑任务**：输出时长约等于被编辑的视频，可能不是整秒，最多短约 0.4 秒 [C][S25#2.5_duration]。
- **返回的 duration**：查询接口返回的值 = 实际帧数 / 24 **向下取整**。例如 133 帧实际 5.54 秒，返回 5 [C]。

### 3.3 Seedance 2.5 的任务类型约束

来源：[S25#2.5_task_type_intro][C]

| 任务类型 | 触发条件 | 约束 | 违反约束时 |
|---|---|---|---|
| 文生视频 | 只有文本 | 无 | — |
| 首帧 / 首尾帧 | `role` 为 `first_frame` 或 `last_frame` | `ratio=adaptive` | **异步失败**，错误码 `InvalidParameter.TaskTypeConstraint`（见 [S25#2.5_error_handling]） |
| 参考生视频 | 至少 1 个 `reference_*` | 无 | — |
| 视频编辑 | 至少 1 个 `reference_video`，且 prompt 表达了编辑意图 | `ratio=adaptive`，`duration=-1`，源视频 4–30 秒 | 取决于 `omni_reference_task_type`，见下方 |
| 视频延长 | 至少 1 个 `reference_video`，且 prompt 表达了延长意图 | `ratio=adaptive` | 取决于 `omni_reference_task_type`，见下方 |

**`omni_reference_task_type` 与校验时机**：
- **`auto`（或不填）**：任务开始执行后才判断类型并校验。不合规时任务异步失败，错误码 `InvalidParameter.TaskTypeConstraint`。
- **显式填写**：提交时同步校验，不合法会立即报错，任务不会被创建。
  - 【文档矛盾】[C] 写的是 `reference` / `edit` / `extend`，[S25] 写的是 `edit` / `extend`。
- **显式填写后仍会二次判断**：执行时模型还会根据 prompt 再判断一次。判断结果与指定值不一致时，任务异步失败，错误码 `InvalidParameter.TaskTypeMismatch` [C][S25][E]。

**prompt 关键词要求** [S25#2.5_param_constraints]：
- 编辑任务的 prompt 至少要含 edit the video / add / delete / remove / modify / replace / change 这类词；
- 延长任务的 prompt 至少要含 extend forward / backward / continue / continue the story 这类词。

**不确定子类型时的推荐配置**：`auto` + `ratio=adaptive` + `duration=-1`，参考视频每段 4–30 秒。

**报错时机**：2.5 的部分任务类型要等排队结束、开始消费后才会返回错误 [G][L]。

### 3.4 Draft 模式

**通用流程**：
1. `draft:true` 创建 480p 的 Draft 任务，得到 Draft 任务 ID。
2. 用 `content:[{"type":"draft_task","draft_task":{"id":"..."}}]` 再次创建任务，生成正式视频。

**Draft 任务 ID 有效期**：从 `created_at` 起 7 天 [T#5acd28c8][S25#2.5_draft_mode]。

**第一步的 resolution**【未核实】：
- 2.5 的示例显式传了 `resolution:"480p"`；
- 1.5 pro 的示例没传 resolution（1.5 pro 默认是 720p）；
- 不传时会不会自动用 480p，文档没说。建议前端显式传 480p。

#### Seedance 1.5 pro（已 Retired）

来源：[T#5acd28c8]

- **Draft 阶段**：
  - 只支持 480p；
  - 不支持返回尾帧，也不支持离线推理；
  - token 单价不变，消耗量 = 正常视频的 token × 换算系数，带音频时系数为 0.6。
- **正式视频阶段**：
  - 自动复用：`model`、`content.text`、`content.image_url`、`generate_audio`、`seed`、`ratio`、`duration`、`camera_fixed`；
  - 其他参数（resolution、watermark、是否离线、是否返回尾帧等）可以重新指定，不填就用模型默认值；
  - 按正常推理计费；
  - 【未核实】重复传入会被复用的参数会不会报错。

#### Seedance 2.5

来源：[S25#2.5_draft_mode]

- **Draft 阶段**：480p Draft 视频的 token 单价和消耗量都与正常 480p 视频相同。
- **正式视频阶段的参数规则**：
  - **固定值**：
    - `model` 必须与 Draft 任务相同；
    - `draft` 不填或填 false；
    - `resolution` 默认且只支持 `1080p`。
  - **自动复用、不能重复传入**（即使值与 Draft 一致也会报错）：`content.text`、image / video / audio、`duration`、`ratio`、`seed`、`generate_audio`、`omni_reference_task_type`。
  - **可以重新指定**：`return_last_frame`、`output_format`、`watermark`、`service_tier`、`execution_expires_after`、`priority`、`callback_url`、`safety_identifier`。不填时用模型默认值，**不会沿用 Draft 的实际值**。
- **计费**：两步分别计费。
  - 第一步按 480p 计；
  - 第二步按目标分辨率计，token 单价看第一步有没有输入视频，输入视频时长按第一步的输入视频计算。

---

## 4. 查询任务 `GET /api/v3/contents/generations/tasks/{id}`

**路径参数**：`id`（string，必填）[G][OAS-G]

**响应字段**：

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `id`、`model` | string | `model` 的格式为“模型名-版本” | [G] |
| `status` | string | 见下方 | [G][D][C][OAS-G] |
| `content.video_url` | string | 24 小时内有效。2.5 生成的 URL 最多下载 100 次 | [G] |
| `content.last_frame_url` | string | 只有设置 `return_last_frame:true` 才返回。24 小时有效，2.5 最多下载 100 次 | [G] |
| `created_at` / `updated_at` | integer | Unix 秒 | [G] |
| `duration` / `frames` | integer | 二者只返回一个：创建时传了 frames 就返回 frames，否则返回 duration | [G] |
| `framespersecond` | integer | 帧率 | [G] |
| `ratio` / `resolution` | string | 实际值。SDK 示例中 2.5 adaptive 编辑或延长后返回了 `5:4`、`7:5` 这类不在请求枚举里的比例 | [G][C 示例] |
| `seed` | integer | 实际使用的 seed | [G] |
| `generate_audio` | boolean | 2.5、2.0 系列、1.5 pro 返回 | [G] |
| `output_format` | string | `mp4` / `mov`，2.5 返回 | [G] |
| `draft` | boolean | 见下方 | [G][L] |
| `draft_task_id` | string | 基于 Draft 生成正式视频时返回 | [G] |
| `service_tier` | string | 实际使用的服务等级 | [G] |
| `execution_expires_after` | integer | 超时阈值 | [G] |
| `priority` | integer | 平台按账号和模型策略分配的执行优先级，不一定等于请求里传的值 | [G] |
| `safety_identifier` | string | 原样返回 | [G] |
| `error` | object / null | 成功时为 null；失败时为 `{code, message}`（OAS 中两者都 required） | [G][OAS-G] |
| `usage.completion_tokens` | integer | 视频输出的 token 数。2.0 系列有最低 token 用量，不足时按最低值返回并计费（最低值是多少【未核实】） | [G] |
| `usage.total_tokens` | integer | 等于 `completion_tokens`（视频模型的输入 token 为 0） | [G] |
| `usage.tool_usage.web_search`、`tools` | — | 只在 OAS 中出现【未核实】 | [OAS-G] |

**`status`**：
- 正文列出的值：`queued`、`running`、`cancelled`、`succeeded`、`failed`。只有 queued 状态能取消，取消后的任务 24 小时后自动删除。
- 【文档矛盾】`expired` 不在查询接口的枚举里，但 [D]、callback 说明和 `execution_expires_after` 的说明都提到了这个状态。
- OAS 的 TaskStatus 是 string，没有 enum。

**`draft`**：
- 正文写“只有 1.5 pro 返回”。
- 【文档矛盾】2.5 的 SDK 示例和 2.0 的示例响应里都有 `draft:false`。

**OAS 与正文的差异**：OAS 的响应 schema 里没有 `draft` 和 `draft_task_id`。

**查询窗口**：只能查近 7 天，区间为 `[T-7天, T)`，T 是请求时刻的 UTC 秒。建议配置 BytePlus TOS 数据订阅自动转存结果 [G]。

---

## 5. 列表、取消/删除、回调、保留期

### 5.1 列表 `GET /api/v3/contents/generations/tasks`

所有参数都是 Query String [L][OAS-L]。

| 参数 | 类型 | 默认 | 范围 | 说明 |
|---|---|---|---|---|
| `page_num` | integer/null | 1 | [1,500] | 页码 |
| `page_size` | integer/null | 20 | [1,500] | 每页条数 |
| `filter.status` | string/null | — | queued / running / cancelled / succeeded / failed | 能否筛 `expired`【未核实】 |
| `filter.task_ids` | string[]/null | — | — | 精确筛选，可批量。重复写参数：`filter.task_ids=id1&filter.task_ids=id2` |
| `filter.model` | string/null | — | — | Model ID 或 Endpoint ID，只能填一个。API Key 权限为 Custom 时必须填写 |
| `filter.service_tier` | string/null | `default` | `default` / `flex` | 文档顶部的 URL 模板里没有这个参数，但参数说明里有 |

- **`filter.model` 填 Model ID 时**：返回经该 Model ID 绑定的预置接入点发起的任务。【推断】通过自定义 Endpoint 发起的任务需要用 Endpoint ID 来筛。
- **`filter.service_tier` 不传时**：是否只返回 default 等级的任务【未核实】。
- **响应**：`{ total, items[] }`，`items` 中每一项的字段与查询接口相同（OAS 中 `id`、`model`、`status` 为 required）。
- **返回范围**：与所用 API Key 的权限范围一致。
- **查询窗口**：也只能查近 7 天。
- **排序方式、时间范围筛选**：【未核实】。
- **QPS**：该接口账号级 QPS 只有 **1** [T#66cb028f]。

### 5.2 取消 / 删除 `DELETE .../tasks/{id}`

来源：[D][OAS-D]

| 当前状态 | 能否 DELETE | 效果 | 之后的状态 |
|---|---|---|---|
| `queued` | 能 | 移出队列，相当于**取消** | `cancelled` |
| `running` | **不能** | — | — |
| `succeeded` | 能 | 删除记录，之后查不到 | — |
| `failed` | 能 | 删除记录 | — |
| `cancelled` | **不能** | — | — |
| `expired` | 能 | 删除记录 | — |

- 没有响应参数，示例响应为 `{}`。
- `cancelled` 状态的任务 24 小时后自动删除 [G][L]。

### 5.3 回调（Webhook）

来源：[C][T#caf01f12]

- 任务状态变化时，平台向 `callback_url` 发 POST，body 与查询接口的响应一致。
- 可能出现的状态：`queued`、`running`、`succeeded`、`failed`、`expired`（不包含 `cancelled`）。
- 对 `succeeded` 和 `failed`：5 秒内没有收到投递成功确认，会重试 3 次。
- 接收方需要自建公网可访问的服务。纯前端页面没法直接接收回调。
- 【未核实】：
  - “投递成功确认”的具体判定标准；
  - queued / running 状态的回调是否重试；
  - 回调有没有签名或鉴权。

### 5.4 保留期

- 任务记录（任务 ID）：7 天 [C][G][T][S25]。
- 视频 URL、尾帧 URL：24 小时。
- 下载次数上限 100 次【文档矛盾】：[G] 和 [L] 写只针对 2.5 生成的 URL，[T#2760a484] 写成了通用规则。

---

## 6. 限流

**规则**（[T#66cb028f]）：
- 同一主账号下，对同一模型（不分版本）有 RPM 和最大并发限制。
- 超限会返回 `429 Too Many Requests`；达到并发上限时，新任务进入排队。

**各模型数值**：

| 模型 | RPM（企业 / 个人） | 最大并发（企业 / 个人） | flex | 来源 |
|---|---|---|---|---|
| 2.5 | 600 / 180 | 10 / 3 | 不支持 | [S25#2.5_rate_limits][ML] |
| 2.0（非 4K） | 600 / 180 | 10 / 3 | 不支持 | [S20#fd30cc1a][ML] |
| 2.0（4K） | 15 / 15 | 1 / 1 | 不支持 | 同上 |
| 2.0 fast、2.0 mini | 600 / 180 | 10 / 3 | 不支持 | 同上 |
| 1.0 pro、1.0 pro fast、1.5 pro | 600（default，不区分用户类型） | 10 | TPD 500B | [ML] |

**排队数超限**：返回 429 `QuotaExceeded`，含义是“queued 状态任务数超过上限”[E]。

---

## 7. 前端常用错误码（[E]）

| 错误码 | 含义 |
|---|---|
| `InvalidParameter.{Parameter}` | 参数非法 |
| `InvalidParameter.TaskTypeConstraint` | 参数与模型识别出的任务类型不兼容（异步） |
| `InvalidParameter.TaskTypeMismatch` | 模型识别出的任务类型与指定值不一致（异步） |
| `InvalidParameter.UnsupportedParameter` | 当前模型不支持 `service_tier=flex` |
| `InvalidImageURL.EmptyURL` / `InvalidImageURL.InvalidFormat` | Base64 图片为空或格式不对 |
| `Input{Text,Image,Video,Audio}SensitiveContentDetected` 及 `.PolicyViolation` / `.PrivacyInformation` | 输入可能含敏感内容、涉及版权或含真人 |
| `Output*SensitiveContentDetected` | 输出可能含敏感内容 |
| 429 `QuotaExceeded` | 三种含义：免费额度用完；queued 任务数超限；5 小时 / 周 / 月配额超限 |

---

## 8. 对前端的直接启示（根据以上事实整理）

1. **模型下拉框**：
   - 1.5 pro 要标注 Retired，2026-11-11 停止服务；
   - 不要提供已下线的 1.0 lite。
2. **按模型显隐表单项**：

   | 表单项 | 只给这些模型 |
   |---|---|
   | `frames` | 1.0 pro / pro fast |
   | `seed`、`camera_fixed` | 文档只列了 1.5 pro / 1.0 系列 |
   | `generate_audio` | 2.5、2.0 系列、1.5 pro |
   | `output_format`、`omni_reference_task_type` | 2.5 |
   | `priority` | 2.5、2.0 系列 |
   | `draft` | 2.5、1.5 pro |

   - 2.5 和 2.0 系列要禁用 `flex`；
   - 分辨率选项按模型过滤：4k 只有 2.0，fast / mini 最高 720p。
3. **模式互斥**：首帧、首尾帧、全能参考三种模式不能混用。
   - 建议始终显式写 `role`；
   - 素材按同类顺序编号，方便在 prompt 里写 `@Image1` / `@Video1`。
4. **2.5 的本地强校验**：
   - 首帧、首尾帧、编辑、延长要锁定 `ratio=adaptive`，编辑还要锁定 `duration=-1`；
   - 原因：首帧 / 首尾帧违规只会异步失败，提交时不会报错。
5. **Draft 表单**：
   - 第一步显式传 `resolution=480p`；
   - 2.5 第二步只放 `draft_task`，`resolution` 锁定为 1080p，不能再传 text / 素材 / duration / ratio / seed / generate_audio / omni_reference_task_type。
6. **上传方式**：
   - 图片和音频可以用 Base64，但请求体不能超过 64 MB；
   - 视频只能用公网 URL 或 `asset://`；
   - 本地校验大小上限：图片小于 30 MB、视频不超过 200 MB、音频不超过 15 MB，同时校验时长和宽高。
7. **轮询与结果下载**：
   - 单任务查询 QPS 是 20，列表 QPS 只有 1，不要用列表接口高频刷新；
   - 结果 URL 24 小时失效（2.5 最多下载 100 次），要提醒用户及时下载；
   - `callback_url` 需要自建公网服务，纯前端用不了。
8. **API Key 安全与 CORS**：浏览器能否直连没有文档说明。如果被 CORS 拦截，需要加一层代理【未核实】。

---

## 9. 仍未核实 / 文档矛盾汇总

**文档矛盾**：
- `expired` 状态：查询、列表、`filter.status` 的枚举里都没有，但删除表、回调说明、超时说明里都有。
- `draft` 响应字段：正文写只有 1.5 pro 返回，但 2.5 和 2.0 的示例里都有 `draft:false`；OAS 里没有这个字段。
- 2.5 输出格式：能力矩阵只写 MP4，[S25] 和 [ML] 写 mp4 / mov。
- heic / heif 的适用范围，以及图片宽高比、宽高像素区间的开闭，三处说法不一致。
- 下载 100 次的限制：[G] 和 [L] 写只针对 2.5，[T] 写成通用规则。
- [S20] 能力表的宽高比没有列 `adaptive`，但 [C] 写 2.0 系列默认就是 `adaptive`。
- 提示词语言：[C] 的清单没有中文，[S25] 写 2.5 支持中文。
- 首帧 `role` 能不能不填：[C] 写可以，[S25] 要求显式写 `first_frame`。
- 同步校验的范围：[C] 写 `reference` / `edit` / `extend`，[S25] 写 `edit` / `extend`。

**未核实**：
- 2.0 / 2.5 请求里传 `seed`、`camera_fixed` 是被忽略还是报错。
- 1.0 系列传 `duration=-1` 的行为。
- `--` 写法中 `frames` 的缩写，以及与 JSON 字段同时出现时谁优先。
- `tools`、`usage.tool_usage.web_search` 的可用值、适用模型和计费。
- 2.0 系列的最低 token 用量具体是多少。
- 回调的确认机制、签名和重试范围。
- `filter.service_tier` 不传时的行为；列表的排序方式。
- 1.5 pro 正式视频阶段重复传入被复用参数会不会报错。
- Draft 第一步不传 `resolution` 的行为。
- 浏览器直连 API 的 CORS 策略。
- SDK 示例中出现的 `revised_prompt`、`file_url`、`subdivisionlevel`、`fileformat` 等字段，HTTP 文档都没有说明。


## corrections
[
 {
  "claim": "第 6 节限流数值（2.5 / 2.0 系列企业 RPM 600、并发 10，个人 RPM 180、并发 3；2.0 4K 为 RPM 15、并发 1）标注的来源包含 [T#66cb028f]",
  "problem": "引用错了。video-generation-tutorial 的 Limitations / Rate limits 章节只解释了 RPM、并发、TPD 的含义，具体数值写的是 see Model list，正文里没有任何数字。",
  "correct_fact": "数值本身是对的，但应该引用这三处：seedance-2-5#2.5_rate_limits（2.5：企业 600/10，个人 180/3）、seedance-2-0#fd30cc1a（2.0：非 4K 企业 600/10，个人 180/3；4K 企业和个人都是 15/1）、model-list#7571da3f（各模型逐一列出）。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#7571da3f"
 },
 {
  "claim": "1.1 模型清单把 Seedance 1.5 pro（seedance-1-5-pro-251215）当作正常可用的模型列出，没有标注状态",
  "problem": "漏了关键状态。模型列表里这个模型标着 Retired，弃用公告也已经排好了下线时间。",
  "correct_fact": "model-list 标注 seedance-1-5-pro-251215 为 Retired，推荐替换为 dreamina-seedance-2-0-mini-260615。弃用公告第四批的时间：2026-09-08 首次通知，从这天起配额逐步下调；2026-09-15 为 Deprecation Date，之后不能再新建基于它的推理接入点；2026-11-11 为 Deactivation Date，原文写明 17:00（UTC+8）后停止服务，并且不会自动迁移到新模型。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-deprecation-notice"
 },
 {
  "claim": "gaps 里写：创建文档 Base64 示例用的模型 seedance-1-0-lite-i2v-250428 不在任何清单里，是否仍可用未说明",
  "problem": "其实可以查到。弃用公告第三批有这个模型。",
  "correct_fact": "弃用公告第三批列了 bytedance-seedance-1-0-lite-i2v-250428 和 bytedance-seedance-1-0-lite-t2v-250428，Deactivation Date 为 2026-05-13，推荐替换为 bytedance-seedance-1-0-pro-fast-251015，自动替换为 dreamina-seedance-2-0-fast-260128。示例里的 ID 少了 bytedance- 前缀，推断是同一个已下线模型，前缀差异的原因未核实。前端不要照抄这个示例里的 model。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-deprecation-notice"
 },
 {
  "claim": "gaps 里写：fallback 没有读 model-list#7571da3f，1.x 系列的限流数值未核实",
  "problem": "这一页可以读到，数值能补上。",
  "correct_fact": "model-list#7571da3f 给出：seedance-1-0-pro-250528、seedance-1-0-pro-fast-251015、seedance-1-5-pro-251215 的 default 都是 Max RPM 600、Max concurrency 10，flex 为 TPD 500B（这几行没有区分企业和个人用户）。2.5、2.0、2.0 fast、2.0 mini 的 flex 都写 Not supported。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#7571da3f"
 },
 {
  "claim": "2.1 参数表中 watermark、callback_url、execution_expires_after、safety_identifier 的“适用模型”写成“全部”",
  "problem": "夸大了。创建文档在这几个参数下都没有写 Supported models，“全部”是推断出来的。",
  "correct_fact": "应改为“文档未列适用模型（未限定）”。可以补充的旁证只有 seedance-2-5 页的 Draft 规则：2.5 正式视频阶段可以重新指定 watermark、callback_url、execution_expires_after、safety_identifier。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "duration：1.0 pro 和 pro fast 为 [2,12]（不支持 -1）",
  "problem": "“不支持 -1”原文没有直接写。",
  "correct_fact": "创建文档对 1.0 pro / 1.0 pro fast 只写了 Default 5、supports [2, 12]。duration=-1 的行为表里只有 2.0 系列、1.5 pro、2.5，没有 1.0。所以只能说“文档没有列出 -1”，不能写成明确不支持；传 -1 会怎样未说明。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "3.1：resolution、ratio、duration、frames、seed、camera_fixed、watermark 这几项，所有模型都可以写进请求体，也可以写在 prompt 后面",
  "problem": "原文确实这么写，但它讲的是两种传参方式，不代表每个模型都支持这 7 个参数。不加说明的话，前端可能误以为 frames、seed、camera_fixed 对所有模型都能用。",
  "correct_fact": "这条 Note 的意思是：对这 7 个参数，所有模型都接受“请求体字段”和“--参数”两种写法。参数本身支持哪些模型，仍以各参数下的 Supported models 为准：frames 只有 1.0 pro / pro fast；seed 和 camera_fixed 只列了 1.5 pro、1.0 pro、1.0 pro fast。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "3.3 讲 2.5 首帧 / 首尾帧要求 ratio=adaptive，但没说违反约束时什么时候报错",
  "problem": "漏了一个对前端很关键的点：首帧 / 首尾帧没有提交时的同步校验。",
  "correct_fact": "seedance-2-5#2.5_error_handling 的 Asynchronous validation 写明：首帧 / 首尾帧任务如果参数不满足特殊约束，任务会异步报错，错误码为 InvalidParameter.TaskTypeConstraint。提交时的同步校验只针对 omni_reference_task_type 显式填写的情况：2.5 页写的是 edit 或 extend，创建文档写的是 reference、edit、extend，两处不完全一致。所以前端必须在本地强制 ratio=adaptive，不能指望创建接口立刻返回错误。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5#2.5_error_handling"
 },
 {
  "claim": "5.1 filter.model：填 Model ID 只返回经预置 Endpoint 发起的任务",
  "problem": "“只”字原文没有。",
  "correct_fact": "原文 Warning 的意思是：Model ID 绑定预置推理接入点，填 Model ID 时返回通过这个预置接入点发起的任务。原文没有用“仅”，不过这样理解可以推出：通过自定义 Endpoint 发起的任务需要用 Endpoint ID 来筛。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api"
 },
 {
  "claim": "2.2 text：所有模型都支持英文，2.5 另外支持 es/id/pt/ja/ms/th/ar/vi/ko，2.0 系列另外支持 es/id/pt/ja",
  "problem": "只引用了创建文档，没有对照 2.5 页，两处说法不一致。",
  "correct_fact": "创建文档的语言清单里没有中文。seedance-2-5#2.5_multi_language 写的是：Seedance 2.5 原生支持多语言的提示词输入和带音频视频生成，包括 Chinese、English、Spanish、Indonesian、Malay、Thai、Arabic、Portuguese、Vietnamese、Japanese、Korean。也就是说 2.5 支持中文，2.0 / 1.x 的中文支持在这两处都没有列出。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5#2.5_multi_language"
 },
 {
  "claim": "6. 限流：2.5 与 2.0 系列（非 4K）企业 RPM 600 / 并发 10，个人 RPM 180 / 并发 3",
  "problem": "数值对，但没写 1.x 的数值，也没交代来源是哪一页（见第 1 条）。",
  "correct_fact": "2.5、2.0、2.0 fast、2.0 mini：企业 600/10，个人 180/3，2.0 输出 4K 时为 15/1。1.0 pro、1.0 pro fast、1.5 pro：default 600/10，flex TPD 500B。数据见 model-list#7571da3f、seedance-2-5#2.5_rate_limits、seedance-2-0#fd30cc1a。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list#7571da3f"
 }
]

## missing_items
- Seedance 1.5 pro（seedance-1-5-pro-251215）已标注 Retired。2026-09-15 起不能新建推理接入点，2026-11-11 17:00（UTC+8）停止服务且不会自动迁移，推荐替换为 dreamina-seedance-2-0-mini-260615。前端的模型下拉框要标注或隐藏它（model-list#7571da3f、model-deprecation-notice）。
- Base64 示例里的 seedance-1-0-lite-i2v-250428 对应已在 2026-05-13 下线的 bytedance-seedance-1-0-lite-i2v-250428，不能作为可选模型（model-deprecation-notice 第三批）。
- 1.x 限流：1.0 pro、1.0 pro fast、1.5 pro 的 default 为 RPM 600、并发 10，flex 为 TPD 500B（model-list#7571da3f）。
- 2.5 首帧 / 首尾帧的 ratio 约束只做异步校验（任务失败，错误码 InvalidParameter.TaskTypeConstraint），提交时不会报错。前端必须本地锁定 ratio=adaptive（seedance-2-5#2.5_error_handling）。
- 首帧的 role 写法有冲突：创建文档写首帧（All models）可以填 first_frame 或不填；2.5 页的配置方法写 content must contain an image whose role is first_frame。前端建议始终显式写 role。
- 提示词里引用素材的规则：要用“素材类型 + 序号”（例如 Image 1），序号是该素材在请求体同类素材中的排列顺序。不要把 asset ID 写进提示词（例如 asset-2026**** is ... 是错误用法）（seedance-portrait-asset-guide）。前端可以按同类素材的顺序自动生成 @Image1 / @Video1 这样的标签。
- 可信输出（含人脸素材）的范围：2.5 / 2.0 系列生成的含人脸视频（2026-03-11 起）、这些视频对应的尾帧图（2026-04-16 起）、Seedream 5.0 lite 文生图得到的含人脸图片（2026-04-16 起）。有效期都是生成后 30 天，且只认 ModelArk 平台、同一账号、未经二次编辑的原始输出；压缩或转发文件可能导致信任校验失效（seedance-portrait-asset-guide）。
- asset:// 的来源有两种：一是预置数字人库，二是经过实名认证和授权、入库后的真人素材。写法是在 content.<modality>_url.url 里填 asset://<asset ID>（seedance-portrait-asset-guide）。
- 2.5 用 Draft 生成正式视频时：可以重新指定的参数如果不传，用的是模型默认值，不是 Draft 任务里的实际值（例如 Draft 用了 mov，正式视频不传 output_format 就是默认的 mp4）。正式视频的 resolution 默认且只支持 1080p（seedance-2-5#2.5_draft_mode）。
- Draft 第一步的 resolution：2.5 的示例显式传了 "resolution":"480p"；1.5 pro 的示例没传 resolution（1.5 pro 默认是 720p）。draft=true 时不传 resolution 会不会自动用 480p，文档没说。前端建议显式传 480p。
- 1.5 pro 用 Draft 生成正式视频属于正常推理，按正常视频的 token 量计费。2.5 的第二步按目标分辨率计费，token 单价看第一步有没有输入视频，输入视频时长按第一步的输入视频计算（video-generation-tutorial#5acd28c8、seedance-2-5#2.5_draft_mode）。
- 1.5 pro 的正式视频阶段，如果重复传入会被自动复用的参数，会不会报错文档没写。只有 2.5 明确写了“即使值相同也报错”。
- 回调能出现的状态是 queued、running、succeeded、failed、expired，不包含 cancelled（create-video-generation-task-api 的 callback_url 说明）。
- 对前端有用的错误码：InvalidParameter.UnsupportedParameter（当前模型不支持 service_tier=flex）；InvalidImageURL.EmptyURL / InvalidImageURL.InvalidFormat（Base64 图片为空或格式不对）；InputAudioSensitiveContentDetected 和各类 .PolicyViolation（版权相关）；OutputVideoSensitiveContentDetected；429 QuotaExceeded 有三种含义：免费额度用完、queued 任务数超限、5 小时 / 周 / 月配额超限（error-codes）。
- OpenAPI 的查询和列表响应 schema 里没有 draft 和 draft_task_id 字段（文档正文有）；TaskStatus 只是 string，没有 enum。前端解析时不要依赖 OAS 做严格校验。
- 列表文档顶部的 URL 模板里没有 filter.service_tier，但参数说明里有这个参数，默认值是 default。
- 查询接口的 priority 字段原文写的是 assigned to the current task based on the account and model policies，也就是平台按账号和模型策略分配的值，不一定等于请求里传的值。

## gaps
- status 枚举说法矛盾：查询和列表文档的 status 只列了 queued/running/cancelled/succeeded/failed，没有 expired；但回调说明、DELETE 状态表、execution_expires_after 说明都提到了 expired 状态。filter.status 能否筛 expired 未说明。
- 旧的 '--参数' 写法：文档只给了 --rs/--rt/--dur/--seed/--cf/--wm 六个缩写示例。frames 的缩写没读到；JSON 字段与 --参数 同时出现时谁优先，文档没说。
- seed 的适用模型：创建文档 Supported models 只列了 1.5 pro、1.0 pro、1.0 pro fast，但 2.5 的 Draft 规则说正式视频会复用 seed，2.5 和 2.0 的响应示例里也有 seed 值。2.0/2.5 请求里传 seed 是否生效或会不会报错，未明确。
- camera_fixed 只说'参考图场景不支持'，对 2.0/2.5 传入是忽略还是报错，未说明。
- draft 响应字段：查询和列表文档写'只有 Seedance 1.5 pro 返回'，但 2.5 也支持 Draft，2.0 的示例响应里也出现了 draft:false。实际哪些模型返回不一致。
- Seedance 2.5 输出格式矛盾：video-generation-tutorial 能力矩阵中 2.5 的 Output format 只写了 MP4，而 seedance-2-5 页面和创建文档都写支持 mp4/mov。
- heic/heif 支持范围表述不一：创建文档写'Seedance 1.5 pro and later'，tutorial 限制章节写'Seedance 1.5 Pro and Seedance 2.0 series'，2.5 页面也列了 heic/heif。
- 图片宽高比和宽高像素区间：创建文档用闭区间 [0.4,2.5] 和 [300,6000]，tutorial 限制章节用开区间 (0.4,2.5) 和 (300,6000)。
- 下载 100 次的限制：查询和列表文档写仅针对 2.5 生成的 URL，tutorial 保留期章节写成通用规则。
- Seedance 2.0 页面能力表的宽高比没有列 adaptive，但创建文档和 2.5 页面能力表都写 2.0 系列支持且默认 adaptive。
- OpenAPI 中有 tools 数组（Tool{type: string}）和 usage.tool_usage.web_search，文档正文完全没说明，可用值、适用模型、计费都未知。
- watermark 文档没有标注适用模型，默认 false。是否所有模型都支持没有明确写'全部'。
- return_last_frame 在创建文档中没写 Supported models，只能根据能力矩阵（所有模型都打 ✓）推断。
- 回调的'投递成功确认'具体指什么（例如要求 HTTP 200），文档没说；queued/running 状态的回调是否重试也没说；回调有没有签名或鉴权也没说。
- filter.service_tier 默认值为 default：不传时是否只返回 default 等级的任务，文档没明确。
- 列表接口没有提供按时间范围或排序的参数，返回结果的排序方式未说明。
- Base64 视频：创建文档的视频写法只列了 URL 和 asset ID，没有明确说'不支持 Base64'，只是没有列出。
- 浏览器直接调用（CORS）是否被允许：所读文档没有涉及。
- 创建文档 Base64 示例用的模型 seedance-1-0-lite-i2v-250428 不在任何能力矩阵或模型清单里，是否仍可用未说明。
- duration 在 OpenAPI 中没有 min/max，只能以正文里按模型给出的范围为准。
- SDK 示例响应中出现了 revised_prompt、file_url、subdivisionlevel、fileformat 等字段，HTTP 文档没有说明，推测是 SDK 的通用字段，未核实。
- 2.0 系列的最低 token 用量具体是多少，在这些页面里没有给出。
- fallback：没有去读模型清单页（model-list#7571da3f）中各模型的具体 RPM 和并发数，1.x 系列的限流数值未核实。