## MiniMax 国际站视频生成 API：调用流程与模型能力矩阵（核查修订版）

> 核查日期：2026-10-08。
> 资料来源只用 platform.minimax.io 国际站，包括 .md 页面、内嵌的 OpenAPI 和原始 JSON 规范。
> 核查过程中没有带 API Key 调用任何接口。
> 标注说明：【推断】表示不是原文；【未说明】表示文档没有写；【矛盾】表示文档内部或不同页面之间说法不一致。

### 来源简称

| 简称 | URL |
|---|---|
| v2json | https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json |
| v2create / v2query / v2list / v2delete / v2ir / v2regen | https://platform.minimax.io/docs/api-reference/video-generation-v2-{create,query,list,delete,h3-context-ir,regeneration}.md |
| guide | https://platform.minimax.io/docs/guides/video-generation.md |
| t2v | https://platform.minimax.io/docs/api-reference/video-generation-t2v.md（规范：…/video/generation/api/text-to-video.json） |
| i2v | https://platform.minimax.io/docs/api-reference/video-generation-i2v.md（规范：image-to-video.json） |
| fl2v | https://platform.minimax.io/docs/api-reference/video-generation-fl2v.md（规范：start-end-to-video.json） |
| s2v | https://platform.minimax.io/docs/api-reference/video-generation-s2v.md（规范：subject-reference-to-video.json） |
| v1q / v1dl | https://platform.minimax.io/docs/api-reference/video-generation-query.md、…/video-generation-download.md（规范：…/video/generation/api/openapi.json） |
| files | https://platform.minimax.io/docs/api-reference/file/management/api/openapi.json（对应 file-management-*.md 页面） |
| models | https://platform.minimax.io/docs/guides/models-intro.md |
| overview | https://platform.minimax.io/docs/api-reference/api-overview.md |
| rate | https://platform.minimax.io/docs/guides/rate-limits.md |
| paygo / pkg | https://platform.minimax.io/docs/guides/pricing-paygo.md、…/guides/pricing-video.md |
| mplan / faq / err | https://platform.minimax.io/docs/m-plan/faq.md、…/faq/about-apis.md、…/api-reference/errorcode.md |
| rn-apis / rn-models | https://platform.minimax.io/docs/release-notes/apis.md、…/release-notes/models.md |

---

### 总览：两代接口

**V2（MiniMax-H3、MiniMax-H3-Max）**
- 接口：`POST /v2/video_generation`，请求体用 `content[]` 多模态数组。
- 查询成功后直接返回 `content.url`，原文：“no file_id exchange is needed”（来源：v2json、guide）。
- API Overview 的 Video Model 部分只列了这两个模型（来源：overview）。

**V1（Hailuo 系列与 01 系列）**
- 接口：`POST /v1/video_generation`、`GET /v1/query/video_generation`、`GET /v1/files/retrieve`。
- Legacy 标注只覆盖 Hailuo 三款：Models 页和 pricing-paygo 把 Hailuo 2.3 / 2.3Fast / 02 放在 “Legacy Models” 折叠区。
- 01 系列根本没出现在 Models 页。
- API Reference 侧边栏的 Video 分组下有 “MiniMax-H3 (NEW)” 和 “Video Generation” 两组，V1 的 6 个页面在后者里，**没有 Legacy 或 deprecated 标注**。
- 下线时间【未说明】。
- 来源：models、paygo、t2v 页面 HTML 的侧边栏。

**模型补充信息**
- 所有视频模型输出都是 24 fps（来源：models）。
- MiniMax-H3-Max 在 schema 里被称为 “the **fast generation** variant”。guide 写明它由 MiniMax 与 fal.ai 联合发布，由 fal.ai 在 H3 基础上后训练，生成速度比 H3 快（来源：v2json、guide）。

---

### 0. 通用约定

| 项 | 内容 | 来源 |
|---|---|---|
| Base URL | `https://api.minimax.io`（OpenAPI 里的 `servers`） | 各规范 |
| 鉴权 | `Authorization: Bearer <API_key>`。securitySchemes 写的是 `bearerFormat: JWT`。Key 在 Account Management > API Keys 获取 | v2json、t2v |
| Content-Type | 所有创建接口（V1 的 4 个模式、V2 的 create / h3_context_ir / video_regeneration）都把 header `Content-Type: application/json` 标为 required。上传接口用 `multipart/form-data` | 各规范、files |
| 计费方式与 Key | 见下方说明 | guide、pkg、mplan |
| 浏览器安全 | 原文：“Do not share your API Key with others, or expose it in the browser or other client-side code”。公开泄露的 Key 可能被自动禁用 | faq |
| CORS | 全站文档（含 llms-full.txt）都没有提到 CORS 或 Access-Control【未说明】 | — |
| 速率限制 | 视频 V1 “Hailuo series” RPM 20；视频 V2 “MiniMax-H3” RPM 300、Max inflight tasks 30。H3-Max 的限额没有单列【未说明】。Video Packages 各档（Standard/Pro/Scale/Business）RPM 分别为 20/30/40/50 | rate、pkg |

**计费方式与 Key 的细节**
- guide 和 v2create 原文：“To use MiniMax H3 or MiniMax H3 Max, please select the Pay-as-you-go API”。
- Video Packages 页原文：“Video packages support Hailuo video models. MiniMax H3 is not supported yet”。
- M Plan FAQ 写 Explore/Build 档包含 “H3 video model”（没有提 H3-Max），并写明 Subscription Key 与按量付费 API Key 不能互换。
- 【矛盾/未说明】Subscription Key 能否调用 /v2 视频接口，文档没写。

---

### A. V2 接口（MiniMax-H3 / MiniMax-H3-Max）

#### A1. 接口清单（来源：v2json、overview）

| 用途 | 方法与 URL | 适用模型 |
|---|---|---|
| 创建视频生成任务 | `POST https://api.minimax.io/v2/video_generation` | H3、H3-Max |
| 查询单个任务 | `GET https://api.minimax.io/v2/query/video_generation/{task_id}`（task_id 放在 path 里） | 两模型共用（overview：“Both models share the same content[] request protocol and query endpoints”） |
| 任务列表 | `GET https://api.minimax.io/v2/query/video_generation`，query 参数：`page_num`（从 1 开始）、`page_size`、`filter.status`、`filter.task_ids`（array，序列化方式【未说明】）、`filter.model`、`filter.task_type` | 共用 |
| 取消或删除 | `DELETE https://api.minimax.io/v2/video_generation/{task_id}` | H3 任务；能否用于 H3-Max 任务没有单独说明 |
| H3-Context-IR | `POST https://api.minimax.io/v2/h3_context_ir`（只返回增强后的 prompt，不生成视频） | 只有 MiniMax-H3（枚举） |
| 视频再生成 | `POST https://api.minimax.io/v2/video_regeneration`（768P 升到 2K） | 只有 MiniMax-H3（枚举） |

overview 原文：“MiniMax-H3-Max supports the **Create Video Generation Task** endpoint only”。这句话的意思是，三个创建接口里 H3-Max 只能用第一个，不是说它不能查询。

#### A2. 创建请求体 `VideoGenerationV2Req`

- required：`model, content, resolution, duration`（来源：v2json）。
- schema 没有声明 `additionalProperties:false`，多传未声明字段时是报错还是忽略【未说明】。

| 字段 | 类型 | 必填 | 默认 | 取值 / 规则 |
|---|---|---|---|---|
| model | string | 是 | — | `MiniMax-H3`、`MiniMax-H3-Max` |
| content | array<ContentItem> | 是 | — | 每个请求都必须包含 1 条非空 `text`，否则返回参数错误（Err400 示例里是 2013） |
| resolution | string | 是 | H3-Max 的描述写 “defaults to `768P`”，但 schema 把它列为 required【矛盾】；H3 未说明 | 枚举 `480P`/`768P`/`2K`。H3 可用 `768P`、`2K`；H3-Max 可用 `480P`、`768P`，不支持 2K |
| duration | integer | 是 | 未说明 | 枚举 4–15。H3 为 4–15；H3-Max 为 5–15（不支持 4）。只接受整数 |
| ratio | string | 视模式而定 | `adaptive` | 枚举 `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。各模式规则见下 |
| extra | object | 否 | — | 描述是 “Additional generation options for `MiniMax-H3-Max`”，目前只有 `prompt_expansion_mode`，`additionalProperties:false`。原文禁止传 `balance`、空字符串、布尔值或其他未声明字段。传给 H3 会怎样【未说明】 |
| extra.prompt_expansion_mode | string | 否 | `balanced` | 枚举 `disabled`、`balanced`、`quality` |
| callback_url | string | 否 | — | 见 A7 |

**ratio 在各模式下的规则**
- t2va（文生视频）：必填，且不能是 adaptive。
- i2va（图生视频）：始终按 adaptive 处理，传其他合法值不报错，但会被忽略。
- r2va（参考生视频）：可选，默认 adaptive，也可以指定具体比例。

**V2 创建 schema 里没有这些字段**：`prompt_optimizer`、`fast_pretreatment`、`aigc_watermark`、`first_frame_image`、`last_frame_image`、`subject_reference`。`aigc_watermark` 只出现在再生成接口里。

#### A3. `ContentItem`（required: `type`）（来源：v2json）

| 字段 | 说明 |
|---|---|
| type | `text`、`image_url`、`video_url`、`audio_url` |
| text | 每个场景都必须有 1 条非空 text；每条最多 7000 字符（按字符计数） |
| image_url.url | 公网 URL；`mm_file://{file_id}`（可以引用上传的文件，或 “a previous output's file_id”）；`data:image/<format>;base64,<Base64>`（`<format>` 用小写） |
| video_url.url | 公网 URL；`mm_file://{file_id}`；`data:video/mp4;base64,<Base64>`（Base64 会让体积增大约 33%，大视频建议用 URL 或 mm_file） |
| audio_url.url | 公网 URL；`mm_file://{file_id}`；`data:audio/<format>;base64,<Base64>` |
| role | 条件必填：`first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio`。只有 1 张图且没写 role 时，默认当作 first_frame |

#### A4. 各模式的 content 组合（来源：v2json、guide）

| 模式 | 组合 |
|---|---|
| 文生视频 t2va | 只有 1 条 text（ratio 必填，且不能是 adaptive） |
| 图生视频（首帧） | text + 1 个 image_url（role=first_frame，或不写 role） |
| 图生视频（尾帧） | text + 1 个 image_url（role=last_frame） |
| 首尾帧 | text + 2 个 image_url，role 分别为 first_frame 和 last_frame |
| 参考生视频 r2va | text + reference_image、reference_video、reference_audio 的任意组合 |

- 图生视频和参考生视频互斥：两类 role 不能出现在同一个请求里。
- 【矛盾】content 的描述和 guide（“a first-frame image, a last-frame image, or both”）都允许只传尾帧，但 role 的描述写 last_frame “must be paired with first_frame”。

#### A5. 输入媒体限制（来源：v2json、guide、files）

请求体总大小 ≤ 64 MB；大文件建议用 URL，避免 Base64。

| 媒体 | 格式 | 单文件 | 宽高 | 宽高比 w/h | 数量 | 时长 / 帧率 |
|---|---|---|---|---|---|---|
| 图片 | JPG、JPEG、PNG、WEBP、HEIC、HEIF | ≤30 MB | [256, 5760] px | [0.4, 2.5]（guide 的参考图一栏只写了宽高范围，没写宽高比） | 首帧 ≤1，尾帧 ≤1，参考图 ≤9 | — |
| 视频（只用于参考） | MP4、MOV；视频编码 H.264/AVC、H.265/HEVC；音轨 AAC、MP3 | ≤50 MB | [256, 5760] | [0.4, 2.5] | ≤3 | 单段 [2, 15] s，总长 ≤15 s；帧率 [23.976, 60] |
| 音频（只用于参考） | WAV、MP3 | ≤15 MB | — | — | ≤3 | 单段 [2, 15] s，总长 ≤15 s |
| 混合输入 | — | — | — | — | 总共最多 12 个文件（这条只在 guide 中出现） | — |

**文件上传** `POST https://api.minimax.io/v1/files/upload`
- multipart 表单，必填 `purpose` 和 `file`；`purpose=video_generation_input`。
- 上传后在 content 的 url 里用 `mm_file://{file_id}` 引用，**有效期 7 天**，过期后生成会返回 file expired。
- 上传时就会校验规格，不合规的文件返回 400，且不保存。
- heic/heif 的尺寸由服务端解析，客户端不需要转码。
- 单文件上限：图片 30 MB，视频 50 MB，音频 15 MB。
- `files/list` 支持 `purpose=video_generation_input`；`files/delete` 的 purpose 枚举里没有 `video_generation_input`【未说明能否删除】。
- 来源：files。

#### A6. 响应、状态与查询（来源：v2json、guide）

- **创建成功**：`{"task_id":"..."}`，没有 base_resp。

**查询** `GET /v2/query/video_generation/{task_id}` 返回 `{task: VideoTask}`：

| 字段 | 说明 |
|---|---|
| id | 任务 ID |
| model | 使用的模型 |
| status | `queued`、`running`、`succeeded`、`failed`、`cancelled` |
| error | 成功时不返回；失败时为 `{code(string), message}` |
| created_at / updated_at | Unix 秒 |
| content | 成功后返回。`url`：有时效（time-limited）的下载链接，过期后重新查询可拿到新 URL，具体时长【未说明】；`prompt`：只在 h3_context_ir 任务成功时返回 |
| resolution、duration | 输出的分辨率和时长 |
| usage | 见下方说明 |
| ratio | 实际宽高比，可能是空字符串 |
| task_type | `generation`、`h3_context_ir`、`regeneration` |
| modality | `video` 或 `text` |

**usage 的细节**
- 字段：total_seconds、input_seconds、output_seconds、input_image_count、input_audio_seconds、total_tokens、prompt_tokens、completion_tokens。
- schema 写的是只在成功时返回，但 List 示例里非成功任务返回 `"usage": {}`，前端需要能接受空对象。
- input_audio_seconds 在没有参考音频时不返回。

**查询窗口与轮询**
- 只能查最近 7 天的任务（`[T-7d, T)`），超出窗口返回 `invalid task_id`。
- guide 建议每 10 秒轮询一次。成功后直接下载 content.url；`failed` 和 `cancelled` 是失败终态。

**列表**：返回 `{items: VideoTask[], total}`，total 只统计最近 7 天。

**取消/删除**
- `queued` 状态：取消，返回 `action=cancelled`。
- `succeeded`/`failed` 状态：删除记录，返回 `action=deleted`。
- `running`/`cancelled` 状态：不允许，返回错误。
- 响应体：`{task_id, action, status}`。

#### A7. V2 回调（来源：v2json）

- 配置 `callback_url` 后，服务端先发一次带 `challenge` 字段的验证请求（HTTP 方法【未说明】），需在 3 秒内原样返回 challenge。
- 验证通过后，任务状态每次变化都会 POST 推送，推送体与 Query Task 的响应结构相同。
- 回调中的 status 取值：`queued`、`running`、`succeeded`、`failed`、`cancelled`。

#### A8. V2 错误格式（来源：v2json components.responses）

出错时 HTTP 状态码就是真实错误码，响应体为 OpenAI 风格：

`{"type":"error","error":{"type":...,"message":"...(内部码)","http_code":"400"},"request_id":"..."}`

| HTTP | error.type | 示例 message |
|---|---|---|
| 400 | bad_request_error | `invalid params, content must include a non-empty text item (prompt is required) (2013)` |
| 401 | authorized_error | `login fail: ... (1004)` |
| 402 | insufficient_balance_error | `insufficient balance (1008)` |
| 422 | unprocessable_entity_error | `video description contains sensitive content (1026)` |
| 429 | rate_limit_error | `rate limit, please retry later (1002)` |
| 500 | server_error | `internal error (1000)` |
| 529 | overloaded_error | 只出现在类型描述里，没有示例 |

- 创建类接口列出了 400/401/402/422/429/500。
- Query、List、Delete 只列了 400/401/429/500。

#### A9. H3-Context-IR 与再生成（只限 MiniMax-H3）（来源：v2json）

**H3-Context-IR**
- required：`model`（只能是 MiniMax-H3）、`content`、`duration`（4–15）。
- 可选：`ratio`（规则与创建接口相同）、`callback_url`。没有 resolution 和 extra。
- 成功后：`content.prompt` 是增强后的提示词，`task_type=h3_context_ir`，`modality=text`。

**再生成**：oneOf 两种请求体，`source_task_id` 与 content 中的 base_video 必须**恰好传一个**，都传或都不传会报参数错误。

- ① `{model, source_task_id, resolution:"2K"}`
  - 需要白名单。
  - 源任务必须属于当前账号，状态为 succeeded，且仍在 7 天查询窗口内。
- ② `{model, content, resolution:"2K"}`
  - content 中必须恰好有 1 个 `type=video_url, role=base_video` 的条目。
  - 其余 content 要提交生成 768P 源视频时实际送入模型的相同输入；text 要用经 Context-IR 处理后的最终 prompt。原文说不一致时 “may prevent regeneration from producing the expected result”。
  - 再生成的 text 每条最多 40000 字符。
- base_video 规格：
  - 必须有音轨；
  - 帧率 24 fps；
  - 宽、高都能被 32 整除；
  - 像素面积在 589,824 到 1,032,192 之间；
  - 总帧数 107–362，步长 17。
- 两种请求体都有可选字段：`callback_url`；`aigc_watermark`（boolean，默认 `false`）。

#### A10. V2 价格（参考）（来源：paygo）

**输出价格**
- H3：768P $0.08/s，2K $0.13/s。
- H3-Max：480P $0.05/s，768P $0.08/s。

**输入素材**
- H3：图片前 5 张免费，之后每张 $0.04；参考视频按 2K $0.13/s、768P $0.08/s 计费；音频免费。
- H3-Max：图片前 2 张免费，之后每张 $0.074；参考视频按 480P $0.0553/s、768P $0.143/s 计费；音频免费。

**再生成与 Context-IR**
- 再生成输出 $0.05/s；原 768P 任务的输入素材会再计一次费。
- Context-IR：输入 $0.90/M tokens，输出 $3.60/M tokens。

---

### B. V1 接口（Hailuo / 01 系列）

#### B1. 接口清单

| 用途 | 方法与 URL | 来源 |
|---|---|---|
| 创建任务（T2V/I2V/FL2V/S2V 共用同一路径，按字段区分模式） | `POST https://api.minimax.io/v1/video_generation` | t2v、i2v、fl2v、s2v |
| 查询任务 | `GET https://api.minimax.io/v1/query/video_generation?task_id=<id>`（只能查当前账号下的任务） | v1q |
| 用 file_id 换下载链接 | `GET https://api.minimax.io/v1/files/retrieve?file_id=<id>`（参数类型 integer/int64；file_id 可来自视频生成或异步语音合成） | v1dl、files |
| 直接下载文件内容 | `GET https://api.minimax.io/v1/files/retrieve_content?file_id=<id>`（返回 binary） | files |

V1 没有列表接口，也没有取消接口。

#### B2. V1 创建请求体字段

| 字段 | 类型 | 必填 | 默认 | 约束 | 出现在哪些页 |
|---|---|---|---|---|---|
| model | string | 是 | — | 见 B4 的各模式枚举 | 全部 |
| prompt | string | T2V 必填；I2V、FL2V、S2V 不在 required 中 | — | ≤2000 字符；部分模型支持运镜指令（B5） | 全部 |
| prompt_optimizer | boolean | 否 | `true` | 设为 false 可以更精确地控制 | 全部 |
| fast_pretreatment | boolean | 否 | `false` | 在 prompt_optimizer 开启时缩短优化耗时。T2V 页写明只适用于 Hailuo-2.3、Hailuo-02；I2V 页写明只适用于 Hailuo-2.3、2.3-Fast、02 | 只在 T2V、I2V 页 |
| duration | integer | 否 | `6` | 按模型和分辨率取值，见 B4 | T2V、I2V、FL2V |
| resolution | string | 否 | 按模型而定 | T2V 枚举 `720P`/`768P`/`1080P`；I2V 枚举 `512P`/`720P`/`768P`/`1080P`；FL2V 枚举 `768P`/`1080P` | T2V、I2V、FL2V |
| first_frame_image | string | I2V 必填；FL2V 的 required 中**没有列出** | — | 见下方图片要求；FL2V 中视频分辨率跟随首帧 | I2V、FL2V |
| last_frame_image | string | FL2V 必填 | — | 同上；首尾帧尺寸不一致时，尾帧会被裁剪成首帧的尺寸 | FL2V |
| subject_reference | array | S2V 必填 | — | 元素 required 为 `type`、`image` | S2V |
| subject_reference[].type | string | 是 | — | 原文：“currently only `character` (face of a person)” | S2V |
| subject_reference[].image | array<string> | 是 | — | 原文：“only one image supported”；限制同下方图片要求；URL 或 base64 写法【未说明】，示例只用公网 URL | S2V |
| callback_url | string | 否 | — | 见 B6 | 全部 |

**图片要求（first_frame_image、last_frame_image、subject_reference.image 相同）**
- 写法：公网 URL，或 Base64 Data URL（文档只给了 `data:image/jpeg;base64,...` 一例）。
- 格式：JPG、JPEG、PNG、WebP。
- 大小：<20MB。
- 尺寸：短边 >300px，宽高比在 2:5 到 5:2 之间。

四个 V1 页面都没有 `aigc_watermark`。V1 是否接受 `mm_file://` 或 HEIC/HEIF【未说明】。

#### B3. V1 响应与状态（来源：v1q、v1dl、files）

**创建响应**：`{task_id, base_resp:{status_code, status_msg}}`。

**查询响应**：`{task_id, status, file_id, video_width, video_height, base_resp}`。
- file_id、video_width、video_height 只在成功时返回。
- **file_id 在这里声明为 string**（示例 "176844028768320"），而 files/retrieve 声明为 int64【矛盾】。

**status 枚举**：`Preparing`、`Queueing`、`Processing`、`Success`、`Fail`。

**files/retrieve 响应**：`{file:{file_id, bytes, created_at, filename, purpose, download_url}, base_resp}`。
- Video Download 页的 FileObject 写明 download_url “valid for 1 hour”。
- File Management 版的 FileObject schema 没有 download_url，只在示例中出现。

V1 出错时的 HTTP 状态码【未说明】。

#### B4. V1 时长与分辨率的合法组合（来源：t2v、i2v、fl2v、s2v）

| 模式 | 模型 | 512P | 720P | 768P | 1080P | 默认 |
|---|---|---|---|---|---|---|
| T2V | MiniMax-Hailuo-2.3 | — | — | 6/10 | 6 | 768P、6s |
| T2V | MiniMax-Hailuo-02 | — | — | 6/10 | 6 | 768P、6s |
| T2V | T2V-01-Director、T2V-01（表中的 “Other models”） | — | 6 | — | 时长表填了 6，但分辨率表写 Other models 只有 720P、10s 不支持【矛盾】 | 720P、6s |
| I2V | MiniMax-Hailuo-2.3 | — | — | 6/10 | 6 | 768P |
| I2V | MiniMax-Hailuo-2.3-Fast | — | — | 6/10 | 6 | 768P |
| I2V | MiniMax-Hailuo-02 | 6/10 | — | 6/10 | 6 | 768P |
| I2V | I2V-01-Director、I2V-01-live、I2V-01（Other models） | — | 6（10s 不支持） | — | — | 720P（原文：“The default resolution for other models is 720p”） |
| FL2V | MiniMax-Hailuo-02（枚举里唯一的模型） | 不支持（原文：“does not support 512P”） | — | 6/10 | 6 | 768P |
| S2V | S2V-01 | 页面没有 duration/resolution 字段，输出规格【未说明】 | | | | |

#### B5. 运镜指令（V1）（来源：t2v、i2v、fl2v）

**支持的模型**
- T2V 页：MiniMax-Hailuo-2.3、MiniMax-Hailuo-02、T2V-01-Director。
- I2V 页：MiniMax-Hailuo-2.3、MiniMax-Hailuo-2.3-Fast、MiniMax-Hailuo-02、I2V-01-Director。
- FL2V 页：MiniMax-Hailuo-02。
- S2V 页没有提到运镜；T2V-01、I2V-01、I2V-01-live 也不在列表中。

**15 条指令**：`[Truck left]` `[Truck right]` `[Pan left]` `[Pan right]` `[Push in]` `[Pull out]` `[Pedestal up]` `[Pedestal down]` `[Tilt up]` `[Tilt down]` `[Zoom in]` `[Zoom out]` `[Shake]` `[Tracking shot]` `[Static shot]`

**用法**
- 同一个 `[]` 里写多条指令表示同时生效，例如 `[Pan left,Pedestal up]`，建议最多 3 条。
- 按顺序书写表示先后执行。注意顺序执行的示例写的是 `[Push out]`，不在 15 条列表中，列表里对应的是 `[Pull out]`。
- 也可以用自然语言描述，但用明确指令效果更准。

**V2/H3**：guide 只写了可以在关键描述后加运镜指令，举例 `[pan]`、`[zoom]`、`[static]`，没有完整列表。H3-Max 的运镜没有单独说明。

#### B6. V1 回调（来源：t2v 等四页）

- 配置后，服务端先发一个带 `challenge` 的 POST 请求，需在 3 秒内原样返回。
- 之后任务状态变化时推送，结构与 Query 接口相同。
- 回调中的 status 取值：`processing`、`success`、`failed`（小写，与查询接口的首字母大写枚举不一致【矛盾】）。
- 推送示例：`{task_id, status:"success", file_id, base_resp}`。

#### B7. V1 的 base_resp.status_code

| 接口 | 码表 |
|---|---|
| 创建 | 0 成功；1002 限流；1004 鉴权失败；1008 余额不足；1026 prompt 含敏感内容；2013 参数无效；2049 API Key 无效 |
| 查询 | 0；1002；1004；1026 输入敏感；1027 生成视频敏感 |
| files/retrieve | 1000 未知错误；1001 超时；1002 RPM 限流；1004；1008；1013 内部服务错误；1026 输入内容错误；1027 输出内容错误；1039 TPM 限流；2013 输入格式异常 |

**全局错误码页**：1000、1001、1002、1004、1008、1024、1026、1027、1033、1039、1041、1042、1043、1044、2013、20132、2037、2039、2042、2045、2048、2049、2056（2056 的处理建议是等下一个 5 小时窗口）。
- 其中 1043/1044/20132/2037/2039/2042/2048 从文案看与语音相关【推断，页面没有分类】。
- 来源：err。

---

### C. 模型 × 能力/参数矩阵

| model | 接口代 | 文生 | 首帧 | 只传尾帧 | 首尾帧 | 参考 | duration | resolution | ratio | 运镜 `[]` | prompt_optimizer | fast_pretreatment | 可用接口 / 其他 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `MiniMax-H3` | V2 | ✓ | ✓ | 【矛盾】见 A4 | ✓ | 参考图 ≤9、视频 ≤3、音频 ≤3 | 4–15 | 768P / 2K | ✓ | 只举例 [pan]/[zoom]/[static] | 无此字段 | 无此字段 | create、query、list、delete、Context-IR、regeneration（再生成有 aigc_watermark） |
| `MiniMax-H3-Max` | V2 | ✓ | ✓ | 同上 | ✓ | v2json、overview、guide 写支持；models 页只写 T2V/I2V【矛盾】 | 5–15 | 480P / 768P | ✓ | 未说明 | 无此字段 | 无此字段 | create、query、list；不支持 Context-IR 和 regeneration；delete 未单独说明；`extra.prompt_expansion_mode` |
| `MiniMax-Hailuo-2.3` | V1 | ✓ | ✓ | ✗ | ✗ | ✗ | 768P 可 6/10，1080P 只有 6 | 768P（默认）/ 1080P | — | ✓ | ✓ | ✓ | — |
| `MiniMax-Hailuo-2.3-Fast` | V1 | ✗（不在 T2V 枚举里） | ✓ | ✗ | ✗ | ✗ | 同上 | 768P（默认）/ 1080P | — | ✓ | ✓ | ✓（I2V） | — |
| `MiniMax-Hailuo-02` | V1 | ✓ | ✓ | ✗ | ✓（FL2V 枚举里唯一的模型） | ✗ | 512P/768P 可 6/10，1080P 只有 6 | 512P（只限 I2V）/ 768P（默认）/ 1080P | — | ✓ | ✓ | ✓（T2V/I2V；FL2V 页没有这个字段） | — |
| `T2V-01-Director` | V1 | ✓ | ✗ | ✗ | ✗ | ✗ | 6 | 720P | — | ✓ | ✓ | ✗ | 只出现在枚举和 “Other models” 中 |
| `T2V-01` | V1 | ✓ | ✗ | ✗ | ✗ | ✗ | 6 | 720P | — | 未列 | ✓ | ✗ | 同上 |
| `I2V-01-Director` | V1 | ✗ | ✓ | ✗ | ✗ | ✗ | 6 | 720P | — | ✓ | ✓ | ✗ | 同上 |
| `I2V-01-live` | V1 | ✗ | ✓ | ✗ | ✗ | ✗ | 6 | 720P | — | 未列 | ✓ | ✗ | 同上 |
| `I2V-01` | V1 | ✗ | ✓ | ✗ | ✗ | ✗ | 6 | 720P | — | 未列 | ✓ | ✗ | 同上 |
| `S2V-01` | V1 | ✗ | ✗ | ✗ | ✗ | `subject_reference`（type=character，1 张人脸图） | 无此字段 | 无此字段 | — | 未提及 | ✓ | ✗ | 同上 |

**补充**
- Release notes 原文是 “MiniMax-Hailuo-2.3-Fast supports Image-to-Video (I2V) generation mode”，没有“只”字。它不能用于文生视频，是从 T2V 枚举中没有它推出来的（来源：rn-apis、t2v）。
- Legacy 模型的价格（paygo）：Hailuo-2.3 768P 6s $0.28；2.3-Fast 768P 6s $0.19；02 512P 6s $0.10 等。国际站价格页**没有 01 系列价格**。
- Video Packages 按点数扣费，生成失败或触发安全审核的视频不扣点（来源：pkg）。

---

### D. 前端集成提示（全部是【推断】，不是文档原文）

1. **V1 和 V2 分成两个 adapter**，二者差异如下：

   | 方面 | V1 | V2 |
   |---|---|---|
   | 请求结构 | 平铺字段（prompt、first_frame_image 等） | `content[]` 加 `role` |
   | 状态枚举 | 查询是 `Success`/`Fail`，回调是小写的 `success`/`failed` | `succeeded`/`failed`/`cancelled` |
   | 拿视频方式 | 用 file_id 调 files/retrieve 换 download_url（1 小时有效） | 直接用 `content.url`（有效时长未说明） |
   | 错误格式 | `base_resp.status_code`（integer） | HTTP 状态码 + `error.code`（string） |

2. **file_id 一律按字符串处理**：V1 查询返回的是 string，files/retrieve 声明的是 int64，可能超出 JS 安全整数范围。
3. **表单联动校验**：
   - H3-Max 禁用 2K 和 4s。
   - t2va 强制选一个具体 ratio；i2va 隐藏 ratio。
   - 首帧/尾帧与参考素材互斥。
   - V1 按模型过滤模式和 duration × resolution 组合。
   - 参考素材在前端预校验格式、大小、宽高、时长，并控制总请求体 ≤64MB（Base64 会膨胀约 33%）。
4. **用轮询，不用回调**：本机页面没有公网入口，`callback_url` 的 challenge 验证用不上，应按官方建议每 10 秒轮询一次。
5. **鉴权与 CORS**：FAQ 不建议把 Key 暴露在浏览器端，CORS 也未说明，建议加本地代理，或者实测后再决定。
6. **计费字段要明确选择**：H3 的参考图超过 5 张、H3-Max 超过 2 张后单独计费；参考视频按秒计费。前端可以做费用预估。

---

### E. Gaps（未核实或文档没有写的项）

**链接有效期与查询**
- V2 `content.url` 的具体有效时长【未说明】。
- V1 的 download_url 在 Video Download 页写明 1 小时；File Management 版的 FileObject schema 没有列出这个字段。

**状态与类型**
- V1 查询状态（首字母大写）与回调状态（小写）不一致，以哪个为准【未说明】。
- V1 Query 的 file_id 是 string，files/retrieve 的 file_id 是 int64，两者矛盾。

**V1 字段与组合**
- T2V 的 Other models 在时长表的 1080P 列填了 6，与分辨率表矛盾。
- FL2V 的 required 里没有 first_frame_image，只传尾帧是否合法【未说明】。
- S2V-01 的输出时长和分辨率【未说明】。
- subject_reference.image 是否接受 base64【未说明】。
- V1 是否接受 mm_file:// 或 HEIC【未说明】。
- V1 出错时的 HTTP 状态码【未说明】。

**V2 字段与模式**
- V2 能否只传尾帧：content 描述和 guide 说可以，role 描述说不行【矛盾】。
- H3-Max 的 resolution 描述写 “defaults to 768P”，但 schema 标为 required【矛盾】。
- 传 extra 给 H3 会怎样【未说明】。
- 创建请求里多传未声明字段时是报错还是忽略【未说明】。
- filter.task_ids 的序列化方式【未说明】。

**H3-Max 支持范围**
- H3-Max 是否支持参考生视频：models 页与其他页面说法矛盾。
- H3-Max 的速率限额没有单列。
- H3-Max 能否使用 Cancel/Delete【未说明】。

**运镜**
- V2 运镜指令没有完整列表。
- V1 顺序执行示例中的 `[Push out]` 不在 15 条列表里。

**计费与 Key**
- Subscription Key（M Plan）能否调用 /v2 视频接口【未说明】；guide 写 H3/H3-Max 要用 Pay-as-you-go API，与 M Plan 页说法存在张力。
- 01 系列在国际站没有价格。

**文件与 CORS**
- files/delete 的 purpose 枚举不含 video_generation_input。
- CORS 策略【未说明】。

**下线计划与 404 页面**
- Legacy 模型的下线时间表【未说明】。
- 01 系列没有独立的模型说明页。
- `/docs/api-reference/video-generation-intro`（链接出自 rn-models 的 Director 卡片）返回 404；国内站对应 URL https://platform.minimaxi.com/docs/api-reference/video-generation-intro 也是 404（只查了状态码）。
- `/docs/faq/history-modelinfo` 返回 404；国内站 https://platform.minimaxi.com/docs/faq/history-modelinfo 也是 404。

**其他**
- 国际站另有 Video Agent（模板视频）接口：https://platform.minimax.io/docs/api-reference/video-agent-create.md，本报告没有展开。
- 本报告没有使用国内站的任何内容作为依据。

## corrections
[
 {
  "claim": "Release notes 写明 Hailuo-2.3-Fast 只支持 I2V",
  "problem": "限定词“只”在原文里找不到。Release notes 只写了它支持 I2V，没有说“仅”。",
  "correct_fact": "原文是 “MiniMax-Hailuo-2.3-Fast supports Image-to-Video (I2V) generation mode”。“不能用于文生视频”这个结论，来自 T2V 页 model 枚举（MiniMax-Hailuo-2.3、MiniMax-Hailuo-02、T2V-01-Director、T2V-01）里没有它。Models 页对它也只写了 “Image to Video”。",
  "source_url": "https://platform.minimax.io/docs/release-notes/apis.md ; https://platform.minimax.io/docs/api-reference/video/generation/api/text-to-video.json"
 },
 {
  "claim": "V1（文档里标为 Legacy Models）：Hailuo 系列和 01 系列",
  "problem": "报告夸大了 Legacy 标注的范围。标为 Legacy 的只有 Hailuo 三款；01 系列从没被标过 Legacy，V1 接口页本身也没有 Legacy 或 deprecated 字样。",
  "correct_fact": "Models 页（models-intro）和 pricing-paygo 的 “Legacy Models” 折叠区里只有 MiniMax Hailuo 2.3、2.3Fast、02。01 系列（T2V-01、I2V-01、S2V-01 等）根本没出现在 Models 页。API Reference 侧边栏的 Video 分组下分成 “MiniMax-H3 (NEW)” 和 “Video Generation” 两组，V1 的 6 个页面在后者里，没有 Legacy 标注。下线时间表未说明。",
  "source_url": "https://platform.minimax.io/docs/guides/models-intro.md ; https://platform.minimax.io/docs/api-reference/video-generation-t2v"
 },
 {
  "claim": "矩阵中 MiniMax-H3-Max 标注“只支持创建接口”",
  "problem": "这样写容易让人以为 H3-Max 不能查询任务。原文的限定范围只是“三个创建接口里只能用 Create Video Generation Task”。",
  "correct_fact": "API Overview 原文：“Both models share the same content[] request protocol and query endpoints”，并写明 “MiniMax-H3-Max supports the Create Video Generation Task endpoint only”，指的是 H3-Max 不能用 H3-Context-IR 和 video_regeneration（这两个接口的 model 枚举只有 MiniMax-H3）。Query 和 List 两个模型共用；Cancel/Delete 能否用于 H3-Max 任务，原文没有单独写。",
  "source_url": "https://platform.minimax.io/docs/api-reference/api-overview.md"
 },
 {
  "claim": "V1 的 file_id 在 files/retrieve 中被声明为 int64；示例值是 15 位数字",
  "problem": "报告漏了一个对前端很关键的类型矛盾，而且把 15 位示例的出处说错了。",
  "correct_fact": "V1 Query 响应里 file_id 声明为 type string，示例是 \"176844028768320\"（15 位数字就出自这里）。files/retrieve 的 query 参数 file_id 和 FileObject.file_id 声明为 integer/int64，它的示例只是占位符 \"${file_id}\"。Query 页还写明：只能查询当前账号下创建的任务。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video/generation/api/openapi.json"
 },
 {
  "claim": "usage：只在成功时返回",
  "problem": "schema 描述确实这么写，但官方示例和它不一致，报告没有指出。",
  "correct_fact": "List 示例中 queued、running、failed 状态的任务返回的是 \"usage\": {}（空对象）。另外 input_audio_seconds 在没有参考音频时不返回。前端解析时应该能接受 usage 缺失或为空对象。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json"
 },
 {
  "claim": "其中 1043/1044/20132/2037/2039/2042/2048 属于语音相关",
  "problem": "错误码页没有给错误码分类。这是根据 message 文案推出来的，报告却当成原文写。",
  "correct_fact": "错误码页只有 Error Code / Message / Solution 三列。这几条的文案涉及 asr、clone、voice_id、prompt audio，可以推断与语音相关，应标注【推断】。",
  "source_url": "https://platform.minimax.io/docs/api-reference/errorcode.md"
 },
 {
  "claim": "release notes 链接的 /docs/api-reference/video-generation-intro 返回 404",
  "problem": "没写清是哪个页面里的链接。",
  "correct_fact": "这个链接在 release-notes/models.md 的 “T2V-01-Director / I2V-01-Director” 卡片里，不在 release-notes/apis.md。国际站这个 URL 的 HTML 和 .md 版本都返回 404。国内站对应 URL https://platform.minimaxi.com/docs/api-reference/video-generation-intro 也是 404（只查了状态码，没有使用内容）。",
  "source_url": "https://platform.minimax.io/docs/release-notes/models.md"
 },
 {
  "claim": "V1 回调：验证机制与 V2 相同：先发带 challenge 的 POST",
  "problem": "把 V1 的写法套到了 V2 上。",
  "correct_fact": "V1 原文明确写 “MiniMax sends a POST request with a challenge field”。V2 原文只写 “first sends a verification request containing a challenge field”，没有写验证请求用什么 HTTP 方法；状态变更推送才写了 “POSTs an update”。两者的共同点是都要求在 3 秒内原样返回 challenge。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video/generation/api/text-to-video.json ; https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json"
 },
 {
  "claim": "再生成 ②：其余 content 必须与生成源 768P 视频时实际送入模型的输入完全一致",
  "problem": "不一致时的后果被说重了。",
  "correct_fact": "原文要求 “Submit exactly the same inputs that were actually sent to the model”，但后果写的是 “Any mismatch may prevent regeneration from producing the expected result”，也就是可能达不到预期效果，并没有说会返回错误。另外，再生成的 text 上限是 40000 字符，不是创建接口的 7000。",
  "source_url": "https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json"
 },
 {
  "claim": "Video Packages 页写明套餐只支持 Hailuo 系列",
  "problem": "“只”字没有原文支撑。",
  "correct_fact": "原文：“Video packages support Hailuo video models. MiniMax H3 is not supported yet”，并建议需要 H3 时使用 pay-as-you-go API。H3-Max 在这一页没有被提到。",
  "source_url": "https://platform.minimax.io/docs/guides/pricing-video.md"
 }
]

## missing_items
- Models 页写明所有视频模型（H3、H3 Max、Hailuo 2.3、2.3Fast、02）输出都是 24 fps。来源：https://platform.minimax.io/docs/guides/models-intro.md
- MiniMax-H3-Max 的定位：schema 称它是 “the fast generation variant”；guide 写明它由 MiniMax 与 fal.ai 联合发布，由 fal.ai 在 H3 基础上后训练，生成速度比 H3 快。来源：v2-video-generation.json、https://platform.minimax.io/docs/guides/video-generation.md
- V1 Query 只能查询当前账号创建的任务（“Only tasks created under the current account can be queried”）。files/retrieve 的 file_id 可以来自视频生成任务，也可以来自异步语音合成任务。
- V2 的 mm_file:// 除了引用上传的文件，image_url 的描述还写了可以引用 “a previous output's file_id”。
- 文件上传：heic/heif 的尺寸由服务端解析，客户端不需要转码。purpose=video_generation_input 的描述只列了首帧图、参考图、参考视频、参考音频，没有点名尾帧。files/list 支持 purpose=video_generation_input；但 files/delete 的 purpose 枚举（voice_clone、prompt_audio、t2a_async、t2a_async_input、video_generation）里没有 video_generation_input。来源：https://platform.minimax.io/docs/api-reference/file/management/api/openapi.json
- V2 输入素材计费：H3 的图片前 5 张免费，之后每张 $0.04；H3-Max 前 2 张免费，之后每张 $0.074；参考视频按输入时长和输出分辨率计费（H3：2K $0.13/s、768P $0.08/s；H3-Max：480P $0.0553/s、768P $0.143/s）；音频免费。再生成的输出 $0.05/s，原 768P 任务的输入素材会再计一次费。H3-Context-IR 输入 $0.90/M tokens、输出 $3.60/M tokens。国际站按量价格页没有 01 系列的价格。来源：https://platform.minimax.io/docs/guides/pricing-paygo.md
- Video Packages 各档 RPM 分别为 20/30/40/50；生成失败或触发安全审核的视频不扣点数（套餐页原文）。来源：https://platform.minimax.io/docs/guides/pricing-video.md
- V2 的 Query、List、Delete 接口只列了 400/401/429/500 的错误响应；402/422 只列在创建类接口上。V2 的 error.code 是 string（如 "1026"），V1 的 base_resp.status_code 是 integer。
- V2 List 的 filter.task_ids 是数组参数，但查询串怎么序列化（重复 key 还是逗号分隔）未说明。
- 计费口径存在张力：Video guide 和 v2-create 写的是使用 H3/H3-Max 要选 Pay-as-you-go API；M Plan FAQ 写 Explore/Build 档包含 “H3 video model”，没有提 H3-Max，视频模型只受周窗口限制。Subscription Key 能否调用 /v2/video_generation 未说明。
- guide 对参考图只写了宽高范围 [256,5760]，没有写宽高比限制；API 则对所有 image_url 写了宽高比 [0.4,2.5]。guide 还写到首帧、尾帧可以单独或同时提供（“a first-frame image, a last-frame image, or both”），这支持“允许只传尾帧”的读法。
- V2 创建请求体 schema 没有声明 additionalProperties:false（只有 extra 声明了）。所以多传 prompt_optimizer、aigc_watermark 等字段时，服务端是报错还是忽略未说明。
- 国际站另有 Video Agent（模板视频）接口：/docs/api-reference/video-agent-create.md、video-agent-query.md。它不属于 Hailuo/H3 的生成接口，原报告没有提到，按需评估。
- 国际站文档站有一个登录可见的受限页面机制，但目前只配置了 guides/smartrouter-m3-sft 一个页面，没有受限的视频文档，因此不存在读不到的隐藏视频页。

## gaps
- V2 content.url（视频下载链接）只写了 time-limited，没有给出具体有效时长；V1 的 files/retrieve download_url 在 Video Download 页写明 1 小时有效，而 File Management > Retrieve File 页的 FileObject schema 里没有列出 download_url 字段（只在示例中出现）。
- V1 状态枚举不一致：Query 接口是 Preparing/Queueing/Processing/Success/Fail，callback 是 processing/success/failed（小写）。哪个为准，文档没有说明。
- V1 T2V 的 duration 表中 Other models（T2V-01、T2V-01-Director）在 1080P 列填了 6，但 resolution 表写 Other models 只支持 720P、10s 不支持，两者矛盾。
- V1 FL2V 的 schema required 只有 model 和 last_frame_image，没有 first_frame_image；但描述写输出分辨率跟随首帧。只传尾帧是否合法没有说明。
- V2 content 描述允许只传尾帧（role=last_frame），但 role 描述写 last_frame must be paired with first_frame，文档自相矛盾。
- MiniMax-H3-Max 是否支持参考生视频：API 参考和 guide 写支持，models-intro 表只写 T2V/I2V。另外 V2 rate-limits 表只列了 MiniMax-H3（RPM 300 / inflight 30），没有 H3-Max 的限额。
- H3-Max 的 resolution 描述写 defaults to 768P，但 schema 把 resolution 列为 required；duration 也是 required，没有默认值。传 extra 给 MiniMax-H3 会怎样未说明。
- V2/H3 的运镜指令只举了 [pan]/[zoom]/[static]，没有完整列表；V1 15 条指令说明里的顺序执行示例用了 [Push out]，不在 15 条列表中。
- aigc_watermark 只出现在 V2 再生成接口（默认 false）；V1 四个视频创建页和 V2 创建接口都没有这个字段。如果其他资料提到视频创建可加水印，国际站文档无法佐证。
- 01 系列（T2V-01、T2V-01-Director、I2V-01、I2V-01-Director、I2V-01-live、S2V-01）没有独立的模型说明页，只出现在 enum 里；S2V-01 的输出时长和分辨率没有任何说明；subject_reference.image 是否接受 base64 没有写明（示例只用 URL）。
- V1 Base64 写法只给了 data:image/jpeg;base64,... 一例；V1 是否接受 mm_file:// 或 HEIC/HEIF 没有说明（这些只在 V2 中出现）。
- V1 出错时的 HTTP 状态码（是否总是 200 加 base_resp）没有说明；V2 的 529 overloaded_error 只出现在类型列表里，没有示例。
- 国际站文档没有说明 api.minimax.io 的 CORS 策略；FAQ 明确不建议在浏览器或客户端代码中暴露 API Key。
- Legacy 视频模型（Hailuo、01 系列）是否有下线时间表没有说明；API Overview 视频部分已经只列 H3/H3-Max。历史模型页 /docs/faq/history-modelinfo 返回 404。
- release notes 链接的 /docs/api-reference/video-generation-intro 返回 404，无法读取 Director 系列的原始介绍页。
- 没有核对国内站（如 https://platform.minimaxi.com/docs 下对应的视频生成页面），也没有使用国内站内容作为事实依据。