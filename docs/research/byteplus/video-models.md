我回到官方原文和 OpenAPI 合约，逐条核查了这份 video-models 报告。大部分字段、枚举、默认值和适用模型都对得上；有 13 处需要更正或补全，另有约 20 项对前端表单重要的限制原报告漏了，都已并入下面的完整报告。

# Seedance 视频模型能力差异矩阵（核查后的完整版）

**调研方式**
- 只做了只读操作：`arkcli docs get`、`docs list`、`docs apis spec`，以及 `models search / versions / get`。
- 没有发起任何生成请求，也没有执行 `activate`。

**文档版本**：docs snapshot revision 265（bp.en），核查日期 2026-10-08。

**缩写**
- T2V：文生视频
- I2V-F：首帧图生视频
- I2V-FL：首尾帧图生视频
- R2V：全模态参考生视频（omni reference）

**来源**
- [S25] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5
- [S20] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-0
- [TUT] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial
- [API] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api
- [GET] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api
- [LIST] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api
- [DEL] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/cancel-or-delete-video-generation-tasks-api
- [ML] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list （#7571da3f 视频生成部分）
- [PORT] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide
- [SPEC] OpenAPI 合约 `content-generation-ContentGenerationTasks_create-video`
- [CAT] `arkcli models search seedance --include-deprecated`、`models versions`、`models get`（模型目录元数据）

**标注约定**
- 「⚠未核实」：多处原文冲突，或者原文没有明确写。
- 「（推断）」：由原文推导出的结论，原文没有直接这么说。

---

## 1. 接口基础信息

### 1.1 创建任务
- 地址：`POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`。[API][SPEC]
- 鉴权头：`Authorization: Bearer <API Key>`。[SPEC][API 示例]
- 这是异步接口，只返回任务 `id`。[API]
  - 任务 ID 从 created_at 起保存 7 天。
  - `draft=true` 时，返回的就是样片任务 ID。

### 1.2 查询任务
- 地址：`GET /api/v3/contents/generations/tasks/{id}`。[GET]
- 状态有 `queued`、`running`、`cancelled`、`succeeded`、`failed`。[GET]
- 超时的任务会被标记为 `expired`。[GET execution_expires_after][DEL]
  - 它也会出现在回调里。[API callback_url][TUT#caf01f12]
  - 但 GET 的 status 枚举里没有列 `expired`。
  - 前端的状态枚举应包含这 6 个值。
- `cancelled` 的任务 24 小时后会被自动删除。[GET][LIST]
- 成功后从 `content.video_url` 取视频。如果请求时设了 `return_last_frame=true`，还会返回 `content.last_frame_url`。[GET]
- 返回字段：
  - `duration` 和 `frames` 只会出现一个；请求里传了 frames 就返回 frames。
  - 还有 `framespersecond`、`ratio`、`resolution`、`seed`、`service_tier`、`priority`、`generate_audio`、`output_format`（仅 2.5）、`draft`、`draft_task_id`、`usage.completion_tokens`。
  - `usage.total_tokens` 等于 `completion_tokens`。
  - 返回的 `priority` 是按账号和模型策略分配的值。

  [GET]

### 1.3 任务列表
- 地址：`GET /api/v3/contents/generations/tasks`。[LIST]
- 查询参数：
  - `page_num`：默认 1，取值 [1,500]。
  - `page_size`：默认 20，取值 [1,500]。
  - `filter.status`。
  - `filter.task_ids`：可重复传，例如 `filter.task_ids=id1&filter.task_ids=id2`。
  - `filter.model`：Model ID 或 Endpoint ID，只能传一个；API Key 权限为 Custom 时必须填。
  - `filter.service_tier`：默认 default。

### 1.4 取消或删除
`DELETE /api/v3/contents/generations/tasks/{id}`，没有响应参数。不同状态下的行为如下 [DEL]：

| 任务状态 | 能否操作 | 结果 |
|---|---|---|
| queued | 能 | 变为 cancelled |
| running | 不能 | — |
| succeeded / failed / expired | 能 | 删除任务记录，之后查不到 |
| cancelled | 不能 | — |

### 1.5 其他
- create、get、list、delete 四个接口都只支持 API Key 鉴权。[API][GET][LIST][DEL]
- `model` 可以填 Model ID，也可以填 Endpoint ID。[API]
- SPEC 的 required 只有 `model` 和 `content`。[SPEC]

## 2. 各模型精确 Model ID

| 模型 | Model ID | 状态 | 来源 |
|---|---|---|---|
| Dreamina Seedance 2.5 | `dreamina-seedance-2-5-260628` | CAT：Published | [S25][TUT][ML][CAT] |
| Dreamina Seedance 2.0 | `dreamina-seedance-2-0-260128` | CAT：Published | [S20][TUT][ML][CAT] |
| Dreamina Seedance 2.0 fast | `dreamina-seedance-2-0-fast-260128` | CAT：Published | [S20][TUT][ML][CAT] |
| Dreamina Seedance 2.0 mini | `dreamina-seedance-2-0-mini-260615` | CAT：Published | [S20][TUT][ML][CAT] |
| Seedance 1.5 pro | `seedance-1-5-pro-251215` | ML：**Retired**（推荐替代 `dreamina-seedance-2-0-mini-260615`）；CAT：`Retiring`；TUT 和 API 仍按可用模型描述 | [ML][CAT][TUT][API] |
| Seedance 1.0 pro | `seedance-1-0-pro-250528` | CAT：Published | [TUT][ML][CAT] |
| Seedance 1.0 pro fast | `seedance-1-0-pro-fast-251015` | CAT：Published | [TUT][ML][CAT] |
| Seedance 1.0 lite i2v / t2v | `seedance-1-0-lite-i2v-250428` / `seedance-1-0-lite-t2v-250428` | CAT：`Retiring` | 见下方说明 |

**1.0 lite 说明**
- API 的「Image to video - base64」示例用了 `seedance-1-0-lite-i2v-250428`。
- ML 和 TUT 的能力表里都没有这两个模型，文档也没有给出它们的能力或参数说明。

**模型目录（CAT）查到的信息**
- `arkcli models versions` 显示上面 7 个主模型各只有 1 个版本，版本号与上表一致。[CAT]
- 调研所用账号（个人档示例）的 `models get` 结果：
  - 7 个主模型的 pricing.state 都是 `Unavailable`，可能是未开通。
  - lite-i2v 的 pricing.state 是 null。
  - 本次没有执行 activate。

**开通条件**
- S25 顶部的 Note 和 API 文档写的是“满足任一即可”，这条规则同时适用于 2.0 系列和 2.5：
  - 余额 > USD 30；
  - 购买 USD 30 档及以上的 AI Savings Plan；
  - 持有可用额度的资源包。

  [S25][API][S20]
- ⚠未核实：S25 Getting started 第 3 步写的是“必须已购买资源包，否则无法开通 Seedance 2.5”，与上面的写法矛盾。

## 3. 生成模式矩阵（模型 × 输入方式）

| 能力 | 2.5 | 2.0 | 2.0 fast | 2.0 mini | 1.5 pro | 1.0 pro | 1.0 pro fast |
|---|---|---|---|---|---|---|---|
| T2V | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| I2V-F（role 填 `first_frame` 或不填） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| I2V-FL（`first_frame` + `last_frame`，role 必填） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 参考图 `reference_image` | ✓ 1–30 | ✓ 1–9 | ✓ 1–9 | ✓ 1–9 | ✗ | ✗ | ✗ |
| 参考视频 `reference_video` | ✓ ≤10 | ✓ ≤3 | ✓ ≤3 | ✓ ≤3 | ✗ | ✗ | ✗ |
| 参考音频 `reference_audio` | ✓ 可以只传音频 | ✓ 必须同时有图或视频 | 同 2.0 | 同 2.0 | ✗ | ✗ | ✗ |
| 组合参考（图+音、图+视、视+音、图+视+音） | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 视频编辑 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| 视频延长 | ✓ | ✓（可拼接最多 3 段） | ✓ | ✓ | ✗ | ✗ | ✗ |
| 有声视频 `generate_audio` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| 样片 Draft | ✓（文档写法；目录写法相反，见 §11） | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| 返回尾帧 `return_last_frame` | ✓ | ✓ | ✓ | ✓ | ✓（样片不支持） | ✓ | ✓ |
| 离线推理 `service_tier=flex` | ✗ | ✗ | ✗ | ✗ | ✓（样片不支持） | ✓ | ✓ |
| 参考素材总数上限 | 50（30+10+10） | 15（9+3+3） | 15 | 15 | — | — | — |

来源：TUT#e7b4c498 能力总表；S25「Capabilities overview」；S20#fd30cc1a；API 中 content.role、Video、Audio、Draft 各段的 Supported models；ML；TUT#5acd28c8。

**2.0 系列的音频限制**
- 不支持“文本+音频”和“只有音频”两种输入。[S20#50e1b4ea Note][API Audio role]

**content 支持的组合**
- 只有 Text。
- Text（可选）加上以下任意一种：image；video；audio（2.5 支持只传音频）；image+audio；image+video；video+audio；image+video+audio。
- 样片任务 ID。

**prompt 何时必填**
- 有素材时，prompt 是可选的。[API content]
- 2.5 的 edit / extend 例外：prompt 里必须有编辑或延长的关键词，所以这两种模式下 prompt 实际上必填。[S25]

**互斥规则**
- 首帧、首尾帧、全模态参考（参考图、视频、音频）三类场景互斥，**不能混用**。[API content.role Warning]
- 想要“参考 + 首尾帧”的效果，可以在 prompt 里指定某张参考图作首帧或尾帧，属于间接实现。要严格保证首尾帧一致，必须用 `first_frame` / `last_frame`。[API][S20]
- 首帧图和尾帧图可以是同一张。两张宽高比不一致时以首帧为准，尾帧会被自动裁剪。[API]

## 4. 输出规格矩阵

| 项目 | 2.5 | 2.0 | 2.0 fast | 2.0 mini | 1.5 pro | 1.0 pro | 1.0 pro fast |
|---|---|---|---|---|---|---|---|
| `resolution` 枚举 | 480p, 720p（8-bit）, 1080p（10-bit H.265） | 480p, 720p, 1080p（8-bit）, 4k（10-bit H.265） | 480p, 720p | 480p, 720p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p |
| `resolution` 默认 | 720p | 720p | 720p | 720p | 720p | **1080p** | **1080p** |
| `ratio` 枚举 | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive | 同左 | 同左 | 同左 | 同左 | 同左，但 T2V 不支持 adaptive | 同 1.0 pro |
| `ratio` 默认 | adaptive | adaptive | adaptive | adaptive | adaptive | T2V 为 16:9，I2V 为 adaptive | 同 1.0 pro |
| `duration` | [4,30] 或 -1 | [4,15] 或 -1 | [4,15] 或 -1 | [4,15] 或 -1 | [4,12] 或 -1 | [2,12] | [2,12] |
| `duration` 默认 | **-1** | 5 | 5 | 5 | 5 | 5 | 5 |
| `frames` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ [29,289]，形如 25+4n（n 为正整数） | ✓ 同左 |
| 帧率 | 24 fps | 24 | 24 | 24 | 24 | 24 | 24 |
| `output_format` | mp4（默认）, mov | mp4 | mp4 | mp4 | mp4 | mp4 | mp4 |

来源：API 中 resolution、ratio、duration、frames、output_format 各段；TUT#9fe4cce0、#e7b4c498；S25#2.5_video_output_specs；S20#fd30cc1a；ML；SPEC（frames 的 minimum 29、maximum 289）。

**表格补充说明**
- 色深：2.0 的 1080p 是 8-bit，来自 S25、S20、TUT、ML 的能力表；API 只说了 2.5 的 1080p 和 2.0 的 4K 是 10-bit + H.265。
- 播放兼容：10-bit + H.265 在部分浏览器上只是有条件支持，详见 S20#4k_player 的兼容表。前端预览播放可能失败，需要提示用户换用 VLC、mpv、QuickTime 等播放器。
- duration 与 frames：
  - `frames` 优先于 `duration`。计算方式是 帧数 = 时长 × 24。[API][TUT]
  - 查询返回的 `duration` = 实际总帧数 / 24 后向下取整。例如 133 帧返回 5。[API]
- `duration=-1` 的行为：
  - 2.0 系列、1.5 pro、2.5 非编辑任务：模型在合法范围内自选整秒时长。
  - 2.5 编辑任务：输出时长跟随被编辑的视频，可能不是整秒，会稍短一些（S25 写不超过 0.4 秒，API 写约 0.4 秒）。

  [API][S25]
- 像素尺寸各系列不同。例如 480p 16:9：2.5 是 854×480，2.0 系列和 1.5 pro 是 864×496，1.0 系列是 864×480。完整表见 API ratio 段和 TUT#resolution-and-aspect-ratio。
- 4k 只有 2.0 支持，对应像素如下 [API][TUT]：

  | 比例 | 像素 |
  |---|---|
  | 16:9 | 3840×2160 |
  | 4:3 | 3326×2494 |
  | 1:1 | 2880×2880 |
  | 3:4 | 2494×3326 |
  | 9:16 | 2160×3840 |
  | 21:9 | 4398×1886 |

- I2V 时，如果 ratio 与输入图的宽高比不一致，会居中裁剪输入图。[TUT#f76aafc8]
- 2.0 首帧或首尾帧出现画面跳变时，建议把图裁到目标像素，或者设 `ratio=adaptive`。[S20#1df655fb]
- 2.5 的 adaptive 规则 [S25#2.5_ratio]：
  - T2V 和参考生视频：从 6 个枚举比例中选一个。
  - 编辑和延长：跟随被选中的视频。
  - I2V：跟随 first_frame 图。
  - 查询返回的 ratio 可能不在枚举里。API 示例的响应中出现过编辑结果 `ratio='5:4'`、延长结果 `ratio='7:5'`。

**ratio 在各任务下的行为**（来自 API ratio 表）

| 任务 | 2.5 | 2.0 系列 | 1.5 pro | 1.0 系列 |
|---|---|---|---|---|
| T2V | adaptive 或指定比例 | adaptive 或指定比例 | adaptive 或指定比例 | 只能指定比例 |
| I2V-F / I2V-FL | **只能 adaptive** | adaptive 或指定比例 | adaptive 或指定比例 | adaptive 或指定比例 |
| R2V 编辑 / 延长 | **只能 adaptive** | adaptive 或指定比例 | — | — |
| R2V 参考生视频 | adaptive 或指定比例 | adaptive 或指定比例 | — | — |

## 5. 请求参数总表

| 字段 | 类型 | 必填 | 默认 | 取值 | 适用模型 | 说明 | 来源 |
|---|---|---|---|---|---|---|---|
| `model` | string | 是 | — | Model ID / Endpoint ID | 全部 | — | [API][SPEC] |
| `content` | object[] | 是 | — | 元素按 `type` 区分：text / image_url / video_url / audio_url / draft_task | 全部 | 见 §6 | [API][SPEC] |
| `omni_reference_task_type` | string | 否 | `auto` | auto / reference / edit / extend | **仅 2.5** | 显式指定时提交即校验（见 §8） | [API][SPEC][S25] |
| `resolution` | string | 否 | 见 §4 | 480p / 720p / 1080p / 4k | 各模型子集 | — | [API][SPEC] |
| `ratio` | string | 否 | 见 §4 | 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive | 全部 | 约束见 §4、§8 | [API][SPEC] |
| `duration` | integer | 否 | 见 §4 | 见 §4 | 全部 | 与 frames 二选一，frames 优先 | [API][SPEC] |
| `frames` | integer | 否 | 未说明 | [29,289]，形如 25+4n | 仅 1.0 pro / 1.0 pro fast | 用于生成非整秒视频 | [API][SPEC][TUT] |
| `generate_audio` | boolean | 否 | `true` | — | 2.5、2.0 系列、1.5 pro | 输出音频都是单声道；对白建议放在双引号里 | [API][SPEC] |
| `watermark` | boolean | 否 | `false` | — | API 没有列适用模型 | 右下角显示 “AI Generated” | [API][S25][TUT] |
| `output_format` | string | 否 | `mp4` | mp4 / mov | 仅 2.5 | mov 为 H.264 + yuv444p + PCM；编辑和延长建议输入输出都用 mov | [API][S25] |
| `seed` | integer | 否 | `-1` | [-1, 2147483647] | API 只列了 1.5 pro、1.0 pro、1.0 pro fast | 2.x 有冲突，见 §11 | [API][SPEC] |
| `camera_fixed` | boolean | 否 | `false` | — | 1.5 pro、1.0 pro、1.0 pro fast | 参考图场景不支持；实现方式是往 prompt 里追加指令，效果不保证 | [API] |
| `return_last_frame` | boolean | 否 | `false` | — | TUT 表为全部；1.5 pro 样片不支持 | 返回 jpeg 尾帧，尺寸与视频一致，无水印 | [API][TUT] |
| `draft` | boolean | 否 | `false` | — | 2.5、1.5 pro | 只能出 480p，设其他分辨率会报错 | [API][S25][TUT] |
| `service_tier` | string | 否 | `default` | default / flex | 2.5 和 2.0 系列不支持 flex | 提交后不能修改；flex 价格为在线的 50% | [API][TUT] |
| `execution_expires_after` | integer | 否 | `172800` | [3600, 259200] 秒 | 全部 | 从 created_at 起算，超时后为 expired | [API][SPEC] |
| `priority` | integer | 否 | `0` | [0, 9] | 2.5、2.0 系列 | 只在同一 Endpoint 内插队；同优先级按 FIFO；不打断 running 的任务；flex 不支持 | [API][SPEC] |
| `callback_url` | string | 否 | — | URL | 全部 | 状态变化时 POST，内容结构同 GET；succeeded/failed 5 秒内未确认会重试 3 次 | [API][TUT] |
| `safety_identifier` | string | 否 | — | 长度 ≤ 64 | 全部 | 建议传哈希后的用户标识 | [API][SPEC] |
| `tools` | array（元素为 `{type}`） | 否 | 未说明 | — | ⚠未核实 | API 正文没有说明；CAT 写 2.x 支持 `{"type":"web_search"}` | [SPEC][CAT] |

**旧写法（宽松校验）**
- 在 prompt 末尾追加 `--rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true`。
- 适用于 resolution、ratio、duration、frames、seed、camera_fixed、watermark，所有模型都支持。
- 不合法的参数会被忽略或报错。
- 官方推荐直接在请求体里传参数，这种方式是严格校验。

[API Note][TUT#9fe4cce0]

## 6. content 元素结构与素材引用

### 6.1 文本
- 结构：`{type:"text", text}`。
- 支持的语言：
  - 所有模型都支持英文。
  - 2.5 另外支持西、印尼、葡、日、马来、泰、阿、越、韩。S25 正文写的是含中文共 11 种语言。
  - 2.0 系列另外支持西、印尼、葡、日。
- 建议长度不超过 500 个汉字或 1000 个英文单词。

[API][S25#2.5_multi_language]

### 6.2 图片
- 结构：`{type:"image_url", image_url:{url}, role}`。
- role 的取值：`first_frame`、`last_frame`、`reference_image`。[SPEC enum]
  - 首帧场景可以不填 role。
  - 首尾帧和参考图场景必须填 role。
- url 的三种来源：
  - 公网 URL；
  - `data:image/<小写格式>;base64,...`；
  - `asset://<ASSET_ID>`。

[API]

### 6.3 视频
- 结构：`{type:"video_url", video_url:{url}, role:"reference_video"}`。
- url 的来源：文档只列出公网 URL 和 `asset://` 两种，没有列 Base64；原文也没有写“不支持 Base64”这句话。
- 只有 2.5 和 2.0 系列可用。

[API][S25][TUT]

### 6.4 音频
- 结构：`{type:"audio_url", audio_url:{url}, role:"reference_audio"}`。
- url 的三种来源：URL、`data:audio/<小写格式>;base64,...`、`asset://`。
- 只有 2.5 和 2.0 系列可用。

[API]

### 6.5 样片
- 结构：`{type:"draft_task", draft_task:{id}}`。
- 只有 2.5 和 1.5 pro 可用。

[API][SPEC]

### 6.6 Asset 引用和素材编号 [PORT][S20#7f69bcbf][S25]
- 在 `content.<modality>_url.url` 里传 `asset://<asset ID>`，可以是预置数字人，也可以是授权的真人素材。
- prompt 里必须用“素材类型 + 序号”引用，例如 “Image 1”、“@Video 1”。
  - “Image n” 指 content 数组中第 n 个 `type=image_url` 的素材，按数组顺序从 1 开始数。
  - Video 和 Audio 同理。
  - 不能在 prompt 里直接写 asset ID。
- 2.5 的 prompt 规则：
  - 用 `@Image 1`、`@Video 1`、`@Audio 1` 引用素材，并说明每个素材提供什么。
  - 音乐用 `()`，音效用 `<>`，对白用 `{}`，字幕用 `【】`。
  - 非中文对白建议在前面写明语言。

  [S25#2.5_prompt_guide]

### 6.7 人脸限制
2.5 和 2.0 系列不支持直接上传含真人脸的参考图或视频。有三种替代方案。[PORT][API]

**1. 可信输出**
- 条件：ModelArk 平台、同一账号、生成后 30 天内、未经二次编辑的原始输出。
- 适用范围：
  - 2.5 / 2.0 系列生成的含脸视频（2026-03-11 之后生成的）；
  - 这些视频的尾帧图（2026-04-16 之后）；
  - Seedream 5.0 lite 文生图的含脸图（2026-04-16 之后）。
- 注意事项：
  - 不能跨平台，也不能跨账号。
  - 压缩或转发可能让信任校验失效。
  - 信任只作用于输入，输出仍可能因为审核失败。
  - 信任只在触发人脸审核时才生效。

**2. 预置数字人** `asset://...`，从 Digital characters library 获取。

**3. 经过真人认证并入库的授权素材** `asset://...`。

## 7. 参考素材数量、时长与规格上限

| 维度 | 2.5 | 2.0 / fast / mini | 1.x |
|---|---|---|---|
| 首帧 / 首尾帧图片数 | 1 / 2 | 1 / 2 | 1 / 2（1.0 pro fast 只支持首帧） |
| 参考图数 | 1–30 | 1–9 | 不支持 |
| 参考视频 | 最多 10 段，总时长 ≤ 30s；单段 2–30s；**编辑任务单段 4–30s** | 最多 3 段，总时长 ≤ 15s；单段 2–15s | 不支持 |
| 参考音频 | 最多 10 段，总时长 ≤ 30s；单段 2–30s；可以只传音频 | 最多 3 段，总时长 ≤ 15s；单段 2–15s；必须带图或视频 | 不支持 |

来源：[API][S25#2.5_multimodal_input][TUT#63a97f09][S20]

**通用规格**

| 素材 | 格式 | 尺寸 / 参数 | 大小 |
|---|---|---|---|
| 图片 | jpeg / png / webp / bmp / tiff / gif；1.5 pro 及之后的模型还支持 heic / heif（API；S25 对 2.5 也列了 heic/heif） | 宽高比 [0.4,2.5]；宽、高各 [300,6000] px | 单张 < 30MB；请求体 ≤ 64MB；大文件不要用 Base64 |
| 视频 | mp4 / mov；视频编码 H.264 或 H.265；音频 AAC / MP3 | 分辨率 480p/720p/1080p/4k；宽高比 [0.4,2.5]；宽高 [300,6000] px；总像素 [407696, 8295044]；FPS [24,60] | 单段 ≤ 200MB |
| 音频 | wav / mp3 | — | 单段 ≤ 15MB；请求体 ≤ 64MB |

⚠ 两处原文写法不一致：
- 图片：TUT 写的是开区间 (0.4, 2.5)、(300, 6000)，API 和 S25 写的是闭区间。
- mov 音轨：S25 的表里写 mov 还支持 PCM，API 和 TUT 的表里没有 PCM。

## 8. Seedance 2.5 任务类型约束

前端需要按任务类型锁定 ratio / duration。

| 任务 | 触发条件 | 约束 |
|---|---|---|
| T2V | 只有文本 | ratio 和 duration 无特殊约束 |
| I2V-F / I2V-FL | role 为 `first_frame`（首尾帧再加 `last_frame`） | `ratio` 必须为 adaptive；`duration` 可取 [4,30] 或 -1 |
| R2V 参考生视频 | 至少有一个 `reference_*` | 无特殊约束（API 示例中 reference 用了 ratio=16:9、duration=15） |
| R2V 编辑 | 至少一个 `reference_video`，且 prompt 表达编辑意图 | `ratio=adaptive`；`duration=-1`；被编辑视频 4–30s；prompt 要含 edit the video、add、delete/remove、modify/replace/change 等词 |
| R2V 延长 | 至少一个 `reference_video`，且 prompt 表达延长意图 | `ratio=adaptive`；duration 可取 [4,30] 或 -1；prompt 要含 extend forward/backward、continue、continue the story 等词 |

来源：[S25#2.5_task_type_intro][S25#2.5_param_constraints][S25#2.5_extend][S25#2.5_first-last-frame]

**auto 模式（或不传 omni_reference_task_type）的官方建议**
- `ratio=adaptive`，`duration=-1`；
- 每段参考视频时长在 4–30 秒之间。

[S25]

**校验时机与错误码** [S25#2.5_error_handling][API]

同步校验（提交时）：
- 显式指定任务类型时，提交时就校验，不合规会立即报错，任务不会创建。
  - API 写的是 reference、edit、extend 三种都会；
  - S25 只写了 edit 和 extend。

异步校验（任务开始后），错误码为 `InvalidParameter.TaskTypeConstraint`：
- 全模态参考任务不传或设为 auto 时，模型先判定实际任务类型，再校验约束，不合规时异步报错。
- **首帧 / 首尾帧任务违反约束（例如 ratio 不是 adaptive）也是异步报错，提交时不会拦截。**

其他：
- 显式指定了类型，但模型识别出的实际类型不一致时，仍会异步报 `InvalidParameter.TaskTypeMismatch`。
- GET 文档提示：2.5 某些任务类型要等排队结束、开始处理后才会返回错误。[GET error]

## 9. 样片（Draft）规则

### 9.1 Seedance 2.5 [S25#2.5_draft_mode]
**第一步：生成样片**
- 设 `draft=true`，只能是 480p，设其他分辨率会报错。
- token 消耗和单价与普通 480p 视频相同。

**第二步：生成正片**
- 请求体传 `content:[{type:"draft_task",draft_task:{id}}]`。
- 固定值参数：
  - `model` 必须与第一步相同；
  - `draft` 不传或设为 false；
  - `resolution` 默认且只能是 **1080p**。
- 自动复用的参数，**不能再传**，即使值相同也会报错：
  - prompt；
  - 图片、视频、音频；
  - `duration`、`ratio`、`seed`、`generate_audio`、`omni_reference_task_type`。
- 可以重新指定的参数：
  - `return_last_frame`、`output_format`、`watermark`、`service_tier`；
  - `execution_expires_after`、`priority`、`callback_url`、`safety_identifier`。
  - **这些参数不传时，用模型默认值，不沿用样片的值**；取值必须符合 2.5 的限制。

**计费与有效期**
- 正片按目标分辨率计费。
- token 单价取决于第一步是否有输入视频。
- 输入视频时长按第一步的输入视频计算，不计样片本身。
- 样片 ID 从 `created_at` 起 7 天内有效。

### 9.2 Seedance 1.5 pro [TUT#5acd28c8]
- 样片只能是 480p，不支持返回尾帧，也不支持 flex。
- 样片的 token 单价不变，但用量更少：有声样片的 token 是普通有声视频的 0.6 倍。
- 正片自动复用：`model`、`content.text`、`content.image_url`、`generate_audio`、`seed`、`ratio`、`duration`、`camera_fixed`。
- 正片可以手动指定其他参数，例如 resolution（示例用的是 720p）、watermark、service_tier、return_last_frame；不传时用默认值。
- 正片按普通视频计费。
- 样片 ID 同样 7 天内有效。

### 9.3 查询结果中的 draft 字段
- GET 文档写 `draft` 字段“仅由 Dreamina Seedance 1.5 pro 返回”。
- 2.5 的样片任务是否返回这个字段，⚠未说明。

## 10. 速率限制与保留期

**在线推理限流**

| 模型 | 企业用户 | 个人用户 |
|---|---|---|
| 2.5 / 2.0 fast / 2.0 mini / 2.0（非 4K） | RPM 600，并发 10 | RPM 180，并发 3 |
| 2.0（4K） | RPM 15，并发 1 | RPM 15，并发 1 |

- 上面这些模型都不支持 flex。[ML][S20][S25]
- 1.x：RPM 600，并发 10；flex 的 TPD 为 500B。[ML]

**限流规则**
- 按同一主账号、同一模型计算，不区分模型版本。
- 超过限制返回 `429 Too Many Requests`。
- 达到并发上限后，新任务进入队列排队。

[S25#2.5_rate_limits][TUT#b25b1821]

**调研所用账号（CAT，个人档示例）**
- 2.5 和 2.0 mini：create_task_rpm 180、concurrent 3。
- 1.x：600 / 10。
- lite-i2v：300 / 5。
- 180 / 3 与个人用户档的数值一致（推断）。

**非推理接口 QPS**：查询 20，列表 1，取消或删除 20。[S25][TUT]

**保留期**
- 任务记录保留 7 天，查询区间为 [T-7 天, T)。
- video_url 和 last_frame_url 有效 24 小时。
- 2.5 的 video_url 和 last_frame_url 最多可下载 100 次。[GET][LIST][S25]
  - ⚠未核实：TUT#2760a484 写的是视频 URL 最多下载 100 次，没有限定模型。

**最低用量**
- 2.0 系列有最低 token 用量，实际用量低于最低值时按最低值计费。[GET]
- 具体数值⚠未说明。

## 11. 冲突与未核实项

1. **2.5 是否支持 Draft**：S25、TUT、API 都写支持；CAT 的 supported_params 写 draft support=false。以官方文档为准，建议实测确认。
2. **2.x 是否支持 seed**：
   - API 的 seed 段只列了 1.5 pro、1.0 pro、1.0 pro fast。
   - CAT 写 2.x 为 false，理由是“最新 API 文档未列”，属于转述，不是独立证据。
   - 但 S25 的 Draft 规则把 seed 列为正片自动复用的参数，API 里 2.5 的示例响应也带 seed 值。
   - 2.x 请求里传 seed 会怎样，⚠未说明。
3. **seed 上限**：SPEC 和 API 写 2147483647；CAT 中 1.5 pro 写 max=4294967295。
4. **tools 字段**：SPEC 有这个字段；CAT 写 2.x 支持 web_search；API 正文没有说明，用途、默认值、计费都⚠未说明。示例响应中出现过 `tools='null'`。
5. **2.5 输出格式**：S25、API、ML 写 mp4 和 mov；TUT 能力表只写了 MP4。
6. **2.0 系列的 ratio 和 duration**：S20 能力表里 ratio 不含 adaptive，duration 只写 4–15 秒；API、S25、TUT 时长段和 CAT 都写支持 adaptive 和 -1，默认 ratio 为 adaptive。以 API 为准。
7. **图片区间开闭写法、mov 是否支持 PCM 音频**：见 §7。
8. **2.0 系列是否支持中文 prompt**：BytePlus 文档没有明确说明。
9. **watermark 的适用模型**：API 没有列适用模型；TUT 和 S25 把它作为通用参数介绍。
10. **frames 的默认值**：未说明。
11. **1.5 pro 的状态**：ML 标为 Retired，CAT 为 Retiring，但 TUT 和 API 仍按可用模型描述。是否还能调用，⚠未说明。
12. **1.0 lite**：只在 API 示例和 CAT 中出现，没有能力和参数说明。
13. **2.0 系列编辑和延长任务的 duration 约束**：未说明。API ratio 表只写了 2.0 可以用 adaptive 或指定比例。
14. **2.5 开通条件**：“满足任一”和“必须购买资源包”两种写法冲突。
15. **2.5 样片支持哪些输入类型**（是否支持参考视频、音频等）：⚠未说明。S25 的示例是首帧图 + 文本；计费规则提到第一步可能有输入视频。
16. **没有读的页面**：seedance-2-5-prompt-guide、seedance-2-0-prompt-guide、avatar-library、upload-real-person-portrait-assets、error-codes、seedance-model-activation-usage-and-refund。

## 12. 前端联动建议（由上面的事实推导，不是原文）

1. **先选模型，再选模式**：
   - 1.0 pro fast 隐藏首尾帧。
   - 1.x 隐藏所有参考、编辑、延长入口。
   - 2.0 系列只有音频、没有图或视频时禁止提交。
   - 1.0 lite 是否列出需要另行决定，文档没有它的能力说明。
2. **首帧/首尾帧与全模态参考做成互斥的 Tab。**
3. **2.5 按任务类型锁定参数**：
   - I2V、edit、extend 模式下把 ratio 锁定为 adaptive。
   - edit 模式再把 duration 锁定为 -1，并校验被编辑视频时长在 4–30 秒。
   - I2V 的约束违反是异步报错，必须在前端拦截。
   - edit / extend 模式下 prompt 必填，并提示需要的关键词。
4. **参数按模型显隐**：
   - `seed` / `camera_fixed`：只对 1.x 显示；camera_fixed 在参考图场景隐藏。
   - `frames`：只对 1.0 pro / pro fast 显示，与 duration 二选一。
   - `output_format` / `omni_reference_task_type`：只对 2.5 显示。
   - `priority`：只对 2.x 显示。
   - `flex`：只对 1.x 显示，1.5 pro 打开 draft 时禁用。
   - `return_last_frame`：1.5 pro 打开 draft 时禁用。
   - `draft`：对 2.5 和 1.5 pro 显示。
     - 打开后 resolution 锁定 480p。
     - 2.5 正片的 resolution 锁定 1080p，并且不能再传素材、prompt、ratio、duration、seed、generate_audio、omni_reference_task_type。
5. **素材上传与校验**：
   - 视频只提供 URL 和 asset:// 两种输入；Base64 只用于图片和音频，MIME 格式要小写，请求体控制在 64MB 以内。
   - 按 §7 预先校验数量、时长、像素、帧率、大小。
6. **prompt 素材引用助手**：按 content 中同类素材的顺序生成 “Image n / Video n / Audio n” 标签，禁止在 prompt 里写 asset ID。
7. **结果页**：
   - 能处理任意 ratio 字符串，以及非整秒时长。
   - 提示 H.265 / 10-bit / mov 的播放兼容问题。
   - 提示 URL 24 小时过期。
   - 状态枚举包含 expired。
   - 删除按钮在 running 和 cancelled 状态下禁用。
8. **限流**：遇到 429 时退避重试；超过并发的任务会排队，界面应显示 queued。

## corrections
[
 {
  "claim": "seedance-1-0-lite-i2v / seedance-1-0-lite-t2v 只出现在 arkcli 目录里，ML 和 TUT 中都没有出现；本次读的文档都没有提到它们",
  "problem": "说漏了。create-video-generation-task-api 的代码示例「Image to video - base64」用的就是 seedance-1-0-lite-i2v-250428，参数为 ratio=adaptive、duration=5、watermark=false，首帧图用 Base64 传入。另外，CAT 中 lite-i2v 的 pricing.state 是 null，不是 Unavailable；它的 content_generation_rate_limit 是 create_task_rpm 300、concurrent_requests 5",
  "correct_fact": "lite-i2v 在 API 文档里出现过，但只作为调用示例，文档没有给出它的能力或参数说明。它在 ML 和 TUT 的能力表里都不存在，CAT 的 lifecycle 为 Retiring。前端是否列出这个模型需要另行决定。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "omni_reference_task_type 显式设为 edit / extend 时，提交时就同步报错",
  "problem": "不完整，而且两份文档写法不一致。API 文档写的是：显式设为 reference、edit 或 extend 时，都会在提交时校验对应任务的约束。S25 的 Error handling 只提到 edit 和 extend。",
  "correct_fact": "API 文档：显式指定 reference / edit / extend 时，提交时同步校验，不合规会立即报错，任务不会创建。S25 只写了 edit / extend。reference 本身没有特殊约束，所以实际影响不大。即使显式指定了类型，模型识别出的实际类型如果不一致，仍会异步报 InvalidParameter.TaskTypeMismatch。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "§8 校验时机与错误码：只写了 omni_reference_task_type 为 auto 或未传时提交后才异步校验",
  "problem": "漏写了首帧 / 首尾帧任务的校验时机。2.5 的 I2V 任务如果违反约束（例如 ratio 不是 adaptive），提交时不会报错，而是在任务开始后异步报错。",
  "correct_fact": "S25#2.5_error_handling 的异步校验部分写明：首帧 / 首尾帧任务的参数不满足特殊约束时，任务异步返回错误，错误码为 InvalidParameter.TaskTypeConstraint。前端需要在提交前自己把 ratio 锁定为 adaptive。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5"
 },
 {
  "claim": "视频 url 只能是公网 URL 或 asset://，**不支持 Base64**",
  "problem": "加粗的“不支持”在原文中没有对应的句子，是推断出来的。",
  "correct_fact": "API 写的是 Video URL or asset ID；S25 和 TUT 写的是 Input methods: video URL, asset ID。图片和音频都明确列了 Base64，视频没有列。原文没有出现“不支持 Base64”这句话。前端按“视频只提供 URL 和 asset ID 两种方式”实现即可。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "状态有 queued/running/cancelled/succeeded/failed，回调里还会出现 expired",
  "problem": "容易让人以为 expired 只在回调里出现。实际上它也是任务的真实状态：GET 文档在 execution_expires_after 处写了任务会被标记为 expired，DELETE 文档的状态表也列了 expired。只是 GET 的 status 枚举里没有写它。",
  "correct_fact": "前端的状态枚举需要包含 queued、running、cancelled、succeeded、failed、expired。另外，cancelled 的任务会在 24 小时后被自动删除（GET 和 LIST 文档都有写）。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/cancel-or-delete-video-generation-tasks-api"
 },
 {
  "claim": "2.5 的 URL 最多可下载 100 次",
  "problem": "各文档的适用范围写法有冲突。GET、LIST 和 S25 写的是 Dreamina Seedance 2.5 生成的 URL（GET 里 video_url 和 last_frame_url 都有这个限制）。TUT#2760a484 Retention period 写的是 Video URLs 有效 24 小时、最多下载 100 次，没有限定模型。",
  "correct_fact": "可以确定 2.5 的 video_url 和 last_frame_url 都有效 24 小时、最多下载 100 次。其他模型是否也有 100 次限制，文档写法冲突，列为未核实。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api"
 },
 {
  "claim": "开通 2.5 的前置条件（满足任一）：余额 > USD 30 / 买 USD 30 档以上 AI Savings Plan / 持有可用 2.5 资源包",
  "problem": "同一页面里有相互矛盾的写法。S25 Getting started 的第 3 步写的是：必须已购买资源包，否则无法开通 Seedance 2.5。",
  "correct_fact": "S25 顶部的 Note 和 API 文档都写“满足以下任一条件”，而且这条规则同时适用于 2.0 系列和 2.5。但 S25 Quick start 写的是必须购买资源包。存在冲突，标为未核实。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5"
 },
 {
  "claim": "return_last_frame 适用全部模型",
  "problem": "没写例外情况。1.5 pro 在 draft=true（样片）时不支持返回尾帧。另外，API 的 return_last_frame 段没有列适用模型，“全部”来自 TUT 的能力表。",
  "correct_fact": "TUT 能力表里 7 个模型都标为支持。但 TUT#5acd28c8 写明 1.5 pro 的样片不支持返回尾帧，也不支持离线推理。2.5 的样片是否支持 return_last_frame，原文没有说明；S25 只把它列为正片可以重新指定的参数。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial"
 },
 {
  "claim": "§4 来源标注中引用 CAT supported_params 来支撑 1.0 系列的参数",
  "problem": "CAT 里 seedance-1-0-pro、seedance-1-0-pro-fast、seedance-1-0-lite-* 的 supported_params 都是空的，不能作为 1.0 参数的来源。",
  "correct_fact": "1.0 pro 和 1.0 pro fast 的参数事实只来自 API、TUT 和 ML。CAT 里只有 1.0 pro fast 有 limits 字段（480p/720p/1080p、2-12s、24fps）。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "调研所用账号 2.x 是 create_task_rpm 180、concurrent 3，即个人档",
  "problem": "数值核实无误，但“即个人档”是根据数值推断的，CAT 本身没有写账号类型。",
  "correct_fact": "CAT 的 content_generation_rate_limit：2.5 和 2.0 mini 都是 180 / 3；1.0 pro、1.0 pro fast、1.5 pro 都是 600 / 10。180 / 3 与 S25 和 ML 中个人用户的数值一致。“个人档”这个结论属于推断。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list"
 },
 {
  "claim": "2.5 正片可以重新指定 return_last_frame、output_format、watermark、service_tier 等参数",
  "problem": "漏了关键规则：这些参数不传时，用的是模型默认值，而不是样片当时的取值。另外漏了正片的计费规则。",
  "correct_fact": "S25#2.5_draft_mode 写明：可以重新指定的参数如果不传，使用模型默认值，不沿用样片的实际值；取值必须符合 2.5 的限制。正片按目标分辨率计费；token 单价取决于第一步是否包含输入视频；输入视频时长按第一步的输入视频计算，不计样片本身。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5"
 },
 {
  "claim": "取消或删除：只有 queued 状态的任务能取消",
  "problem": "正确但不完整，缺少各状态下 DELETE 的行为，而前端的删除按钮需要这些信息。",
  "correct_fact": "DELETE 文档的状态表：queued 会被移出队列，状态变为 cancelled；running 不能操作；succeeded、failed、expired 会删除任务记录，之后查不到；cancelled 不能操作。该接口没有响应参数。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/cancel-or-delete-video-generation-tasks-api"
 },
 {
  "claim": "这个查询 API 只支持 API Key 鉴权（只写在 GET 上）",
  "problem": "范围写窄了。create、get、list、delete 四个接口的文档都写了只支持 API Key 鉴权。",
  "correct_fact": "四个视频任务接口都只支持 API Key，请求头为 Authorization: Bearer <API Key>；SPEC 的 securitySchemes 是 BearerAuth。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api"
 }
]

## missing_items
- text 提示词在多数组合里是可选的。API 写的组合是：仅 Text、Text(optional)+image、Text(optional)+video、Text(optional)+audio 等。所以有素材时 prompt 输入框不应该强制必填。但 2.5 的 edit / extend 要求 prompt 里有编辑或延长意图的关键词，这两种模式下 prompt 实际上是必填的。[API][S25]
- 2.5 的首帧 / 首尾帧任务违反 ratio=adaptive 约束时是异步报错（InvalidParameter.TaskTypeConstraint），提交时不会拦截，前端必须自己在提交前锁定。[S25#2.5_error_handling]
- 2.5 用 auto 模式（或不传 omni_reference_task_type）时，官方除了建议 ratio=adaptive、duration=-1，还建议每段参考视频时长在 4–30 秒之间。[S25#2.5_param_constraints]
- 2.5 的编辑 / 延长结果，查询接口返回的 ratio 可能不在枚举里。API 示例的响应中出现过 ratio='5:4'（编辑）和 ratio='7:5'（延长）；编辑结果的时长也可能不是整秒。结果展示组件要能处理任意比例字符串。[API 代码示例响应][S25#2.5_edit]
- 2.5 文生视频和参考生视频用 adaptive 时，模型会从 16:9/4:3/1:1/3:4/9:16/21:9 中选一个；编辑和延长跟随被选中的视频；首帧任务跟随 first_frame 图。[S25#2.5_ratio]
- prompt 引用素材的编号规则：“Image n”指 content 数组中第 n 个 type=image_url 的素材，按数组顺序从 1 开始数；Video 和 Audio 同理；prompt 里不能直接写 asset ID。[S20#7f69bcbf][PORT]
- 2.5 的 prompt 规则：用 @Image 1、@Video 1、@Audio 1 引用素材；音乐用 ()，音效用 <>，对白用 {}，字幕用 【】；非中文对白建议在前面写明语言。[S25#2.5_prompt_guide]
- 2.0 的 prompt 公式：参考图、参考视频、参考音频（音色或内容）各有写法；编辑分增、删、改三类；延长写作“延长 Video n”或多段衔接。[S20#7f69bcbf]
- 1.5 pro 样片（draft=true）不支持 return_last_frame，也不支持 service_tier=flex；正片按普通视频计费。[TUT#5acd28c8]
- 2.5 正片中可以重新指定的参数如果不传，使用模型默认值，而不是样片的值。[S25#2.5_draft_mode]
- DELETE 在各状态下的行为：queued 变为 cancelled；running 和 cancelled 不能操作；succeeded、failed、expired 删除记录。cancelled 任务 24 小时后自动删除。[DEL][GET]
- LIST 接口参数：page_num 默认 1，取值 [1,500]；page_size 默认 20，取值 [1,500]；filter.status；filter.task_ids 可重复传；filter.model（Model ID 或 Endpoint ID，只能传一个；API Key 权限为 Custom 时必须填）；filter.service_tier 默认 default。[LIST]
- 超过限流时返回 429 Too Many Requests；达到并发上限后，新任务会进入队列排队，不会被拒绝；限流按同一主账号、同一模型计算，不区分模型版本。[S25#2.5_rate_limits][TUT#b25b1821]
- 旧的 --参数 写法（--rs --rt --dur --seed --cf --wm）适用于 resolution、ratio、duration、frames、seed、camera_fixed、watermark，所有模型都支持；校验宽松，不合法的参数可能被忽略。[API Parameter input methods Note]
- 查询接口返回的 duration 和 frames 只会出现一个；usage.total_tokens 等于 completion_tokens；返回的 priority 是按账号和模型策略分配的值，可能与请求时传的不同。[GET]
- 人脸素材的信任规则只作用于输入：输出仍可能因为审核失败；信任只在触发人脸审核时才生效；只信任 ModelArk 平台、同一账号、未经二次编辑的原始输出。[PORT]
- Base64 图片的 MIME 格式必须小写，例如 data:image/png;base64,...；音频同样要求小写。[API]
- 视频输入还要求总像素在 [407696, 8295044] 之间，帧率在 [24,60] 之间，分辨率为 480p/720p/1080p/4k 之一。这些可以在前端读取视频元数据后预先校验。[API][S25][TUT]
- 2.5 的编辑任务输出可能比原视频短，S25 写的是“不超过 0.4 秒”，API 写的是“约 0.4 秒”。[S25#2.5_edit][API duration]

## gaps
- 2.5 是否支持 Draft 有冲突：S25、TUT 和 API 都写 2.5 支持 draft，但 arkcli 目录里 dreamina-seedance-2-5 的 supported_params 写的是 draft support=false（'Seedance 2.5 不支持样片模式'）。目前以官方文档为准，建议实测时再确认。
- 2.x 是否支持 seed 有冲突：API 文档的 seed 段只列了 1.5 pro、1.0 pro、1.0 pro fast，目录里 2.x 也写 seed support=false。但 S25 的 Draft 规则表把 seed 列为正片“自动复用”的参数，TUT 和 API 的返回示例里 2.5 任务也带 seed 值。2.x 请求里能否传 seed、传了会怎样，都没有明确说明。
- seed 上限有冲突：OpenAPI SPEC 和 API 文档写的是 2147483647，目录中 1.5 pro 写的是 max=4294967295。
- 请求体的 `tools` 字段：SPEC 里有，是 array，元素为 {type}；目录写 2.x 支持 {"type":"web_search"}。但 create-video-generation-task-api 正文的请求参数里没有说明这个字段，用途、默认值和计费都未说明。
- 2.5 输出格式有冲突：S25 和 API 写的是 mp4、mov 都支持，但 TUT 能力总表里 2.5 的 Output format 只写了 MP4。
- 2.0 系列的 ratio 和 duration 写法不一致：S20 的能力表里 ratio 不含 adaptive，duration 只写 4–15 秒；但 API 文档、S25 对比表和目录都写 2.0 系列支持 adaptive 和 duration=-1，默认 ratio 为 adaptive。目前以 API 文档为准。
- 图片宽高比与尺寸的区间写法不一致：TUT 写的是开区间 (0.4, 2.5)、(300, 6000)，API 和 S25 写的是闭区间 [0.4, 2.5]、[300, 6000]。
- 视频音轨编码不一致：S25 写 mov 支持 PCM，TUT 和 API 的表里 mov 音频只有 AAC、MP3。
- 中文 prompt：S25 正文写 2.5 原生支持包含中文在内的 11 种语言；API 文档只写“所有模型支持英文”，再列出 2.5 和 2.0 额外支持的语种，没有提中文。2.0 系列是否支持中文 prompt，BytePlus 文档未明确说明。
- watermark 的适用模型：API 没有列 Supported models，只写了默认 false，可以理解为全模型可用，但没有明确写“全部”。
- frames 的默认值未说明；callback_url、safety_identifier 也没有默认值。
- 1.5 pro 的状态：ML 文档标为 Retired，目录 lifecycle 为 Retiring，但 TUT 和 API 仍按可用模型描述。是否还能调用、何时下线，都未说明。
- seedance-1-0-lite-i2v-250428 和 seedance-1-0-lite-t2v-250428 只出现在 arkcli 目录（Retiring），本次读的文档都没有它们的能力和参数说明。camera_fixed 写了“参考图场景不支持”，但当前文档里的 1.x 模型本来就不支持参考图，这句话可能是针对旧模型的历史描述。
- GET 接口文档写 draft 字段“仅由 Dreamina Seedance 1.5 pro 返回”，2.5 的样片任务是否返回 draft 字段，未说明。
- 2.0 系列的编辑和延长任务，duration 有没有特殊约束未说明；API 的 ratio 表只写了 2.0 可以用 adaptive 或指定比例。
- 2.0 系列在只有 2.5 说明的上下文里提到的“最低 token 用量”：具体数值未说明（GET 文档只说存在最低值）。
- 没有读的页面：seedance-2-5-prompt-guide、seedance-2-0-prompt-guide、avatar-library（数字人库与 asset ID 获取方式）、upload-real-person-portrait-assets（真人素材入库流程）、generate-copyright-video（IP 模板视频，可能是另一种输入方式）、error-codes、seedance-model-activation-usage-and-refund。
- 调研所用账号用 `arkcli models get` 查到的 pricing.state 都是 Unavailable（可能未开通），本次没有 activate，所以无法确认该账号实际能调用哪些模型。目录里的 rate_limit（180 RPM / 并发 3）反映的是当前账号档位。