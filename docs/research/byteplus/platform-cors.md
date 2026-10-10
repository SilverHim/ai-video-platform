# BytePlus ModelArk 平台通用事实 + 浏览器直连可行性（Seedream / Seedance）——核查修正版

> 核查方式：逐条回到 `arkcli docs` 官方正文和 OpenAPI 合约（`image-generation-ImageGenerations_generate`、`content-generation-ContentGenerationTasks_create-video`）核对。2026-10-08 用不带 API Key 的 curl 复测了全部 CORS 与 TOS 结论，结果和原报告（2026-10-07）一致，没有任何计费请求。
> 标注约定：【原文】= 文档或 schema 原文有支撑；【实测】= 无 key curl 结果；【推论】= 按浏览器通用规则推出，不是文档内容；【未核实】= 文档没写、也没测到。

---

## 0. 结论速览

| 问题 | 结论 | 依据 |
|---|---|---|
| 数据面 Base URL（AP） | `https://ark.ap-southeast.bytepluses.com/api/v3` | 【原文】base-url-and-authentication |
| 其他 region | EU（Dublin，`eu-west-1`）：`https://ark.eu-west.bytepluses.com/api/v3`。API Key、模型开通状态、接入点都按 region 隔离 | 【原文】region-availability |
| 鉴权头 | `Authorization: Bearer $ARK_API_KEY`。图像生成 1 个接口和视频任务 4 个接口（create/get/list/delete），共 5 个，都写明只支持 API Key 鉴权 | 【原文】各 API 页 Authentication 标签 |
| 浏览器能否直连图像接口 `/images/generations` | 不能。预检返回 204，`Access-Control-Allow-Headers` 固定为 `Origin,Content-Length,Content-Type`，不含 `authorization` | 【实测】 |
| 浏览器能否直连视频任务接口 `/contents/generations/tasks*` | 预检能通过（回显 Origin，包括 `null`；回显请求头，包括 `authorization`）。但无 key 的 401 响应不带 `Access-Control-Allow-Origin`，浏览器读不到错误体。带合法 key 的响应是否带 ACAO 无法验证 | 【实测】 / 【未核实】 |
| 推荐架构 | 用同源代理转发 `/api/v3/*`。至少图像接口必须走代理，建议所有 ARK 调用统一走代理 | 【推论】 |
| 结果 URL | 图像和视频 URL 都只有 24 小时有效；视频 URL 有 100 次下载上限（API 页只限 2.5，教程未限定模型）；结果桶和示例桶都没开 CORS（实测 `CORS is not enabled for this bucket`）| 【原文】+【实测】 |
| 本地文件 | 生成接口只接受 JSON。图片：URL 或 `data:image/<小写fmt>;base64,...`；Seedance 图片另外支持 `asset://`；视频：文档只列了 URL 和 `asset://`；音频：URL、`data:audio/<小写fmt>;base64,...` 或 `asset://`。请求体 ≤ 64 MB（视频任务）| 【原文】 |
| 视频预览 | 2.5 的 1080p 和 2.0 的 4K 是 10-bit H.265/HEVC，2.5 的 mov 是 H.264 4:4:4 + PCM，浏览器 `<video>` 可能放不了 | 【原文】兼容性警告 |

---

## 1. Base URL 与 Region

- 数据面 Base URL：`https://ark.ap-southeast.bytepluses.com/api/v3`。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication
  - Warning：这个地址和 Coding Plan 用的 Base URL 不同，用错可能产生额外费用。
- Region 列表（来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/region-availability ）：
  - Johor, AP：`ap-southeast-1`，`https://ark.ap-southeast.bytepluses.com/api/v3`
  - Dublin, EU：`eu-west-1`，`https://ark.eu-west.bytepluses.com/api/v3`
- Region 隔离：在某个 region 创建的接入点必须用该 region 的 Base URL 调用。API Key、模型开通状态等平台级资源也按 region 隔离。
- 路由：请求优先进入接入点所在 region，但 may spill over 到另一个 region。
- EU 能力：
  - Models supported 只列了 `seed-2-0-lite`；APIs supported 却列了 Chat API 和 Image generation API，两处矛盾（见 gaps）。
  - 平台能力表：EU 没有 Playground、Batch inference、Network configuration 等；API keys、Online inference、Model activation management 可用。
- OpenAPI：`servers` 是 `https://ark.ap-southeast.bytepluses.com`，路径是 `/api/v3/images/generations` 和 `/api/v3/contents/generations/tasks[/{id}]`。

## 2. API Key 获取与鉴权

来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/api-key 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/manage-api-keys 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication

- 获取步骤：登录控制台；（可选）在左下角切换项目空间；进入 API Key Management（`https://ai.byteplus.com/ark/region:ap-southeast-1/apiKey`）；点 Create API Key；填写名称后点 Create。
- Note：API Key 按 region 隔离，创建和使用前要选对 region。
- Warning：2026-09-17 12:00（UTC+8）之后创建的 Key 用新的明文格式，鉴权方式不变，旧 Key 继续有效。新格式的样子文档没写。【推论】前端不要用正则校验 Key 格式。
- 鉴权头：`Authorization: Bearer $ARK_API_KEY`。
- 只支持 API Key 的接口：图像生成、创建/查询/列表/取消删除视频任务，共 5 个接口，Authentication 标签都写着 supports only API Key authentication。
  - 补充：base-url-and-authentication 页面泛称数据面支持 API Key 和 Access Key（AK/SK）两种鉴权，用 AK/SK 时 model 必须是 Endpoint ID。对这 5 个接口，以具体 API 页为准。
  - OpenAPI：securitySchemes 列了 `BearerAuth` 和 `VolcSignatureV4`，但这两个操作的 `security` 只有 `[{BearerAuth: []}]`。
- 配额：一个主账号最多 50 个 API Key。
- 权限模型：
  - Key 只能访问所在项目的资源，不支持跨项目；接入点迁移到别的项目后，原 Key 不能再用于该接入点。
  - 可以选 All permissions，或按 Model ID / 自定义推理接入点做 Custom 授权。
  - 可以开 IP 调用白名单。【推论】浏览器直连时出口 IP 是用户公网 IP，走代理时是代理的出口 IP。
  - Key 可以 Disabled（可逆）或删除（不可逆）；禁用或删除后请求鉴权失败。
- 官方建议把 Key 放在环境变量里，不要硬编码，以免泄露被盗刷。【推论】浏览器页面让用户自己填 Key 属于用户自担风险，建议只放在内存或 sessionStorage，不发给第三方。

## 3. 错误码（HTTP 状态 + error.code）

来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes （Inference error codes）

实测 401 响应体：
```json
{"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid. request id: ...","param":"","type":"Unauthorized"}}
```
实测响应头还有 `x-error-code: AuthN_MissOrInvalidAuthorizationHeader`、`x-request-id`、`server: istio-envoy`。

| HTTP | type | code | 含义（原文要点） |
|---|---|---|---|
| 400 | BadRequest | MissingParameter / MissingParameter.{Parameter} | 缺必填参数 |
| 400 | BadRequest | InvalidParameter / InvalidParameter.{Parameter} | 参数非法 |
| 400 | BadRequest | InvalidParameter.TaskTypeConstraint | 参数和模型识别出的任务类型不兼容（Seedance 2.5，可能异步返回） |
| 400 | BadRequest | InvalidParameter.TaskTypeMismatch | 指定的任务类型和 Seedance 根据 prompt/输入识别出的类型不一致 |
| 400 | BadRequest | InvalidParameter.UnsupportedParameter | 当前模型版本不支持 `service_tier=flex` |
| 400 | BadRequest | InvalidImageURL.EmptyURL / InvalidImageURL.InvalidFormat | Base64 图片为空或无法解析 |
| 400 | BadRequest | SensitiveContentDetected、Input{Text,Image,Video,Audio}SensitiveContentDetected、Output{Text,Image,Video,Audio}SensitiveContentDetected | 输入或输出命中内容审核 |
| 400 | BadRequest | Input{Text,Image,Video,Audio}SensitiveContentDetected.PolicyViolation、Output{Video,Audio}SensitiveContentDetected.PolicyViolation | 可能涉及版权限制 |
| 400 | BadRequest | Input{Image,Video}SensitiveContentDetected.PrivacyInformation | 输入可能含真人 |
| 400 | BadRequest | OutputImageSensitiveContentDetected.DeepFake | 输出可能含伪造证件 |
| 400 | BadRequest | InvalidEndpoint.ClosedEndpoint | 接入点已关闭或暂不可用 |
| 401 | Unauthorized | AuthenticationError | API Key 或 AK/SK 缺失或无效 |
| 401 | Forbidden | InvalidAccountStatus | 账号状态异常 |
| 403 | Forbidden | AccessDenied | 无权访问该资源 |
| 403 | Forbidden | OperationDenied.ServiceNotOpen | 模型服务未开通 |
| 403 | Forbidden | AccountOverdueError / OperationDenied.ServiceOverdue | 账号欠费 |
| 403 | Forbidden | OperationDenied.ArkAccessRoleNotFound / OperationDenied.TosAccessDenied | TOS 授权问题 |
| 403 | Forbidden | OperationDenied.FileQuotaExceeded / OperationDenied.InvalidState（file） | Files 存储额度用完 / file 不可用 |
| 404 | NotFound | InvalidEndpointOrModel.NotFound | 模型或接入点不存在，或无权访问 |
| 404 | NotFound | ModelNotOpen | 账号未开通该模型 |
| 404 | NotFound | InvalidEndpointOrModel.ModelIDAccessDisabled | 账号不允许用 Model ID 调用，需改用接入点 ID |
| 404 | NotFound | NotFound.{Parameter} | 资源不存在（例如 task id） |
| 429 | TooManyRequests | RateLimitExceeded.EndpointRPMExceeded / ModelAccountRpmRateLimitExceeded / APIAccountRpmRateLimitExceeded | RPM 超限 |
| 429 | TooManyRequests | ModelAccountIpmRateLimitExceeded | IPM（每分钟图片数）超限 |
| 429 | TooManyRequests | QuotaExceeded | 三种含义：(1) 免费试用额度用完；(2) queued 状态任务数超限；(3) 5 小时/周/月用量额度超限，到 {reset_time} 重置 |
| 429 | TooManyRequests | SetLimitExceeded | 触达"安全体验模式"设定的上限，服务已暂停 |
| 429 | TooManyRequests | InflightBatchsizeExceeded | 达到当前充值额度对应的最大并发 |
| 429 | TooManyRequests | ServerOverloaded | 突发流量保护（原文：seed-1.8 及更早的模型返回这个） |
| 429 | TooManyRequests | RequestBurstTooFast | 突发流量保护（原文：seed-2.0 及更新的模型返回这个） |
| 429 | TooManyRequests | AccountRateLimitExceeded | RPM/TPM 超限 |
| 500 | InternalServerError | InternalServiceError | 内部错误，稍后重试 |

补充：
- 公共错误码页面 https://ai.byteplus.com/ark/region:ap-southeast-1/docs/byteplus-platform/reference-common-error-codes 未展开阅读。
- 图像非流式：组图中单张失败放在 `data[].error`，其他图不受影响。单张因内容审核失败时继续生成下一张；遇到 500 则不再继续。整单失败返回顶层 `error`。图层拆分里任一层失败则整单失败。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api
- 图像流式（SSE）事件：`error`、`image_generation.partial_succeeded`（含 `image_index`、`url` 或 `b64_json`、`size`）、`image_generation.partial_failed`（含 `image_index`、`error`）、`image_generation.completed`（含 `usage`）。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-streaming-responses
- 视频：Dreamina Seedance 2.5 的部分任务类型是在 queued 任务被消费后才返回错误，前端必须轮询 GET，在 `status=failed` 时读取 `error`。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api

## 4. 限流（RPM / IPM / 并发 / QPS）

来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list （#7571da3f、#9df4d9fd）、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/traffic-burst-handling-best-practices

### 图像（Seedream）：Max IPM
| Model ID | 能力 | Max IPM |
|---|---|---|
| dola-seedream-5-0-pro-260628 | 图层拆分；单图生成（文生图、单图生图、多参考图生图） | 500 |
| dola-seedream-5-0-flash-260915 | 同上 | 500 |
| seedream-5-0-260128（also supports: seedream-5-0-lite-260128） | 单图生成 + 组图生成 | 500 |
| seedream-4-5-251128 | 单图生成 + 组图生成 | 500 |
| seedream-4-0-250828 | 单图生成 + 组图生成 | 500 |

- 图层拆分时每个请求预扣 17 IPM（1 张底图 + 16 个图层），生成完按实际数量退还。
- 图像接口的 RPM、并发上限文档没给出。

### 视频（Seedance）：default 是在线推理，flex 是离线推理
| Model ID | default（企业用户） | default（个人用户） | flex |
|---|---|---|---|
| dreamina-seedance-2-5-260628 | RPM 600 / 并发 10 | RPM 180 / 并发 3 | 不支持 |
| dreamina-seedance-2-0-260128（非 4K） | RPM 600 / 并发 10 | RPM 180 / 并发 3 | 不支持 |
| dreamina-seedance-2-0-260128（4K） | RPM 15 / 并发 1 | RPM 15 / 并发 1 | 不支持 |
| dreamina-seedance-2-0-fast-260128 | RPM 600 / 并发 10 | RPM 180 / 并发 3 | 不支持 |
| dreamina-seedance-2-0-mini-260615 | RPM 600 / 并发 10 | RPM 180 / 并发 3 | 不支持 |
| seedance-1-0-pro-250528 | default：RPM 600 / 并发 10（文档没分企业/个人） | — | TPD 500B |
| seedance-1-0-pro-fast-251015 | default：RPM 600 / 并发 10（文档没分企业/个人） | — | TPD 500B |
| seedance-1-5-pro-251215（Retired，推荐替代 dreamina-seedance-2-0-mini-260615） | default：RPM 600 / 并发 10（文档没分企业/个人） | — | TPD 500B |

- RPM：每分钟可创建的视频任务数，超过则创建请求被限流（429）。
- 最大并发：达到上限后新任务进入排队（原文）。queued 任务数本身也有上限，超过会返回 429 QuotaExceeded（错误码页原文），具体上限未说明。
- 非推理接口的账号级 QPS（原文，视频教程）：

| 接口 | 账号级 QPS |
|---|---|
| Retrieve a video generation task（GET /tasks/{id}） | 20 |
| List video generation tasks（GET /tasks） | 1 |
| Cancel or delete a video generation task | 20 |

  【推论】前端应按 id 轮询 GET，不要轮询 List。

### 其他
- Files API：上传 20 QPS、带宽 100 Mbps；查询、列表、删除各 20 QPS。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/file-api
- 限流范围：突发流量最佳实践和视频教程都写"同一主账号、同一模型，不区分版本"；Seedream 教程写 IPM 是"账号下某个模型的特定版本"。口径不一致，见 gaps。
- 突发流量：platform 识别为突发的阈值示例是"比上一分钟增加 300 万 TPM，或 3 分钟内增长 20%"（会动态调整）；同一模型的多个接入点或账号共享同一资源池，分流无效。

## 5. 媒体输入：本地上传、公网 URL 还是 base64

### 5.1 Seedream 图像接口的 `image`（string / string[]）
来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0

- 两种形式：可访问的 URL，或 `data:image/<image format>;base64,<Base64>`，其中 `<image format>` 必须小写。
- 生成场景（可选）：
  - 格式：jpeg/png/webp/bmp/tiff/gif/heic/heif。
  - 宽高比 [1/16, 16]；宽、高都 > 14 px；单张 ≤ 30 MB；总像素 [196, 36,000,000]。
  - 张数：5.0 pro/flash 最多 10 张；5.0 lite/4.5/4.0 最多 14 张。
  - 组图时输入参考图数 + 生成图数 ≤ 15。
- 图层拆分场景（`layer_decomposition=true`，必填）：只能 1 张；png/jpeg；≤ 30 MB；总像素 [262,144, 36,000,000]。
- 图像接口的请求体大小上限文档没写。

### 5.2 Seedance 视频任务的 content
来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial

- `image_url.url`：公网 URL、`data:image/<小写fmt>;base64,...` 或 `asset://<ASSET_ID>`。
  - 格式：jpeg/png/webp/bmp/tiff/gif；heic/heif 的支持范围，API 页写"Seedance 1.5 pro 及之后的模型"，教程写"1.5 Pro 和 2.0 系列"。
  - 宽高比 [0.4, 2.5]、宽高 [300, 6000] px（API 页是闭区间，教程写开区间）。
  - 大小：单张 < 30 MB；请求体 ≤ 64 MB；Do not use Base64 encoding for large files。
  - 张数：首帧 1 张；首尾帧 2 张；2.5 omni 参考 1–30 张；2.0 系列 omni 参考 1–9 张。
- `video_url.url`：原文只列了 Video URL 和 `asset://`（没有列 base64；"不支持 base64"是推论）。
  - 容器：mp4/mov；视频编码 H.264/H.265；音频编码 AAC/MP3。
  - 输入分辨率 480p/720p/1080p/4k；宽高比 [0.4, 2.5]；宽高 [300, 6000]；总像素 [407696, 8295044]；单个 ≤ 200 MB；FPS [24, 60]。
  - 时长：2.5 非编辑任务每段 2–30 s，视频编辑任务每段 4–30 s，最多 10 段、总长 ≤ 30 s；2.0 系列每段 2–15 s，最多 3 段、总长 ≤ 15 s。
- `audio_url.url`：URL、`data:audio/<小写fmt>;base64,...` 或 `asset://`。
  - wav/mp3；单个 ≤ 15 MB；请求体 ≤ 64 MB。
  - 时长：2.5 每段 2–30 s、最多 10 段、总长 ≤ 30 s；2.0 系列每段 2–15 s、最多 3 段、总长 ≤ 15 s。
  - 2.0 系列不支持只传音频。
- Warning：Dreamina Seedance 2.5 / 2.0 系列不支持直接上传含真人脸的参考图或视频。替代方案（来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide ）：
  1. 可信输出：同账号、ModelArk 平台、原始未编辑的输出，自生成起 30 天内有效。范围：2.5 / 2.0 系列生成的含人脸视频（2026-03-11 起）、对应尾帧图（2026-04-16 起）、Seedream 5.0 lite 文生图得到的含人脸图片（2026-04-16 起）。压缩或转发可能让可信校验失效，建议原样存到 BytePlus TOS。可信只作用于输入审核，输出仍可能被拦截。
  2. 预置数字人 `asset://`。
  3. 经过实名认证和本人授权的真人素材入库后得到的 `asset://`。

### 5.3 对前端的含义【推论】
- 图片和音频：可以用 FileReader 把本地文件转成 data URL 直接放进 JSON。MIME 子类型要转小写；注意 64 MB 请求体上限和"大文件不要用 base64"。
- 视频参考素材：要先放到公网可访问的位置（用户自己的 TOS/S3 预签名 URL 等），或者用 `asset://`。本次没有找到把本地视频直接传给生成接口的通道。

### 5.4 Files API（`POST /api/v3/files`）
来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/file-api
- 支持 multipart 上传 `file`，也支持 `url`（HTTP/HTTPS 或 `tos://<bucket>/<prefix>/<file_name>`）。
- 存储限制：
  - 默认托管空间：单文件 512 MB，总容量 20 GB（免费，满了不能再传）。
  - 用户 TOS 桶：视频 2 GB，其他类型 512 MB，总容量不限，需要先在控制台授权。
- 默认保存 7 天，可用 `expire_at` 设为 1–30 天；上传后异步处理，`status` 变为 active 后才能用；预处理超时 5 分钟。
- 文档写的用途是配合 Responses API / Chat API 做多模态理解。图像和视频生成接口的文档与 OpenAPI schema（ImageInput、ImageURL、VideoURL、AudioURL）只有 `url` 字段，没有 `file_id`。准确说法是：文档没有说明生成接口支持 file_id，按不支持设计。

### 5.5 内网 TOS 预签名 URL
- 可以把文件放进同 region 的私有 TOS 桶，生成内网 GET 预签名 URL 交给 ModelArk 读取（TOS 桶必须和 ModelArk 同 region）。示例用的是 chat.completions 视频理解，是否适用于生成接口没写。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-via-tos-internal-presigned-url
- FAQ（视觉理解章节）：
  - 默认图片下载超时 5 s，建议放 TOS 或压缩到 100 kB 以下。
  - 部分对象存储的 ACL 会拒绝 BytePlus 来源，返回 403。
  - TIFF/SGI/ICNS/JPEG2000 按 Content-Type 校验，对象存储必须正确设置 Content-Type。
  - 这些是否适用于生成接口未说明。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq

## 6. CORS 实测（无 API Key，不计费；2026-10-07 原测，2026-10-08 复测一致）

| # | 请求 | 状态 | Access-Control-* 响应头 | 判断 |
|---|---|---|---|---|
| 1 | AP OPTIONS `/images/generations`（ACRM=POST，ACRH=`authorization,content-type`），Origin `http://localhost:5173` | 204 | `allow-origin: *`；`allow-methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS`；`allow-headers: Origin,Content-Length,Content-Type`；`max-age: 43200` | 预检失败：Allow-Headers 不含 authorization |
| 2 | AP POST `/images/generations`，无 key，Body `{}` | 401 | 没有 ACAO | 浏览器读不到响应 |
| 3 | AP OPTIONS `/contents/generations/tasks`（POST） | 200 | `allow-origin` 回显 Origin；`allow-credentials: true`；`allow-methods: GET,POST,PUT,DELETE,HEAD,OPTIONS,PATCH,CONNECT`；`allow-headers` 回显 ACRH；`max-age: 0` | 预检通过 |
| 4 | AP GET / POST `/contents/generations/tasks`，无 key | 401 | 没有 ACAO | 浏览器报 CORS 错误，拿不到 401 错误体 |
| 5 | AP OPTIONS `/contents/generations/tasks/{id}`（GET） | 200 | 同 #3 | 预检通过 |
| 6 | AP GET `/contents/generations/tasks/{id}`，无 key | 401 | 没有 ACAO | 同 #4 |
| 7 | Origin `null`：OPTIONS images | 204 | 同 #1 | 预检失败 |
| 8 | Origin `null`：OPTIONS tasks、tasks/{id} | 200 | `allow-origin: null`，其余同 #3 | 预检通过 |
| 9 | Origin `https://example.com`，ACRH 带 `x-foo` 的 tasks 预检 | 200 | 回显 `https://example.com` 和 `authorization,content-type,x-foo` | 视频任务网关无条件回显 |
| 10 | 对比：OPTIONS `/chat/completions`、`/files`、`/files/{id}` | 200 | 与 tasks 相同（回显） | — |
| 11 | 对比：OPTIONS `/responses` | 204 | 与 images 相同（固定头，不含 authorization） | — |
| 12 | EU OPTIONS images 和 tasks | 204 | 都是固定头 `Origin,Content-Length,Content-Type` 加 `*` | EU 两个接口的预检都失败 |
| 13 | AP OPTIONS images，不带 Origin | 404 | — | — |

结论：
1. Seedream 图像接口无法从浏览器直连（AP 和 EU 都一样；http://localhost 和 file:// 都一样）。【实测】
2. Seedance 视频任务接口在 AP 预检能通过，但网关在鉴权失败时不返回 CORS 头。带合法 key 的 2xx 或业务 4xx 是否带 ACAO，没有测到。【未核实】
3. 响应里没有 `Access-Control-Expose-Headers`。【推论】跨域时 JS 读不到 `x-request-id`、`x-error-code`。
4. 建议【推论】：用同源代理转发 `/api/v3/*`。开发期用 Vite `server.proxy`，部署时用 Worker、Nginx 或 Node。代理负责透传或注入 `Authorization`，同时解决结果文件下载的跨域问题。如果 Key 开了 IP 白名单，要把代理出口 IP 加进去。
5. 官方文档检索 CORS、browser、cross-origin 都没有结果：没有任何关于浏览器直连的说明。

## 7. 结果 URL 在浏览器中的展示与下载

文档事实【原文】：
- 图像：
  - `response_format` 默认 `url`，可选 `url`、`b64_json`。
  - 原文：The URL is valid for 24 hours after the image is generated；教程：retained for 24 hours and will be automatically cleared after expiration。
  - 来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedream-4-0-5-0
- 视频：
  - `content.video_url` 和 `content.last_frame_url` 都是 24 小时有效。
  - 下载次数：GET 和 List API 页写 Dreamina Seedance 2.5 生成的 URL 最多下载 100 次；视频教程 Retention period 写 Video URLs ... can be downloaded up to 100 times，没有限定模型。两处不一致，前端应保守按所有 Seedance 输出都有 100 次上限处理。
  - 任务记录只能查最近 7 天（`[T-7 days, T)`）；task id 保存 7 天；cancelled 任务 24 小时后自动删除。
  - 官方建议配置 BytePlus TOS 数据订阅，自动转存产物。
  - 来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api 、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial
- 示例域名：
  - 视频结果：`https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/xxx`。
  - 图像结果：示例只写了 `"url": "https://..."`。
  - 文档素材：`ark-doc.tos-ap-southeast-1.bytepluses.com`、`arkdocs-en.tos-ap-southeast-1.volces.com`。
- 视频编码兼容性：2.5 的 1080p 和 2.0 的 4K 是 10-bit H.265/HEVC，may not be compatible with some playback environments；2.5 的 `output_format=mov` 是 H.264 + YUV 4:4:4 + PCM，部分播放器不支持。来源：create-video-generation-task-api
- GET 返回的 `duration` = floor(实际总帧数 / 24)，可能和实际时长不同。

实测【实测】：
- `ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com`：HEAD 不存在的对象返回 404（TosServer），没有 CORS 头；OPTIONS 返回 403 `CORSResponse: CORS is not enabled for this bucket`。
- `ark-doc.tos-ap-southeast-1.bytepluses.com` 和 `arkdocs-en.tos-ap-southeast-1.volces.com`：HEAD 返回 200，有 `Accept-Ranges: bytes`，没有 ACAO；OPTIONS 同样是 403 "CORS is not enabled"。

推论【推论】：
- 不带 `crossorigin` 属性的 `<img src>` 和 `<video src>` 不受 CORS 限制，但视频能否播放还要看编码（见上面的 HEVC / 4:4:4 警告）。
- `fetch()` 或 XHR 下载为 Blob、canvas 读回、带 `crossorigin` 的媒体元素都会被拦截。
- `<a download>` 对跨域 URL 一般不会强制下载。
- 所以下载和保存要走代理；图像也可以改用 `response_format: "b64_json"`。
- `<video>` 播放时的 Range 请求是否计入 100 次下载上限，文档没说，前端要避免反复加载。

## 8. 平台通用参数表

| 字段名 | 类型 | 是否必填 | 默认值 | 取值范围/枚举 | 适用模型 | 说明 | 来源URL |
|---|---|---|---|---|---|---|---|
| Base URL（AP） | string | 是 | — | `https://ark.ap-southeast.bytepluses.com/api/v3` | 全部 | 数据面；和 Coding Plan 的地址不同 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication |
| Base URL（EU） | string | 否 | — | `https://ark.eu-west.bytepluses.com/api/v3` | 文档只列了 seed-2-0-lite；APIs 列了 Image generation（矛盾） | Key 和接入点按 region 隔离；EU 预检不允许 authorization | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/region-availability |
| Authorization（Header） | string | 是 | — | `Bearer <ARK_API_KEY>` | 图像 1 个 + 视频任务 4 个接口 | 只支持 API Key；OpenAPI 操作级 security 只有 BearerAuth | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api |
| Content-Type（Header） | string | POST 时用 | — | `application/json` | 全部 | 文档示例写法 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication |
| model | string | 是（OpenAPI required） | — | Model ID 或 Endpoint ID | 全部 | 用 Endpoint ID 可获得限流、计费方式、运行状态、监控、安全等能力；部分账号会被禁止用 Model ID（ModelIDAccessDisabled） | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api |
| content | object[] | 是（视频，OpenAPI required） | — | type 是 text / image_url / video_url / audio_url / draft_task | Seedance | 首帧、首尾帧、omni 参考三类场景互斥 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api |
| image（图像接口） | string / string[] | 生成场景可选；图层拆分场景必填 | — | URL 或 `data:image/<小写fmt>;base64,...` | 5.0 pro/flash 最多 10 张；5.0 lite/4.5/4.0 最多 14 张 | ≤ 30 MB/张 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api |
| response_format | string | 否 | `url` | `url`、`b64_json` | Seedream | url 有效 24 小时 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api |
| stream | boolean | 否 | `false` | true / false | Seedream 5.0 lite、4.5、4.0（5.0 pro/flash 不支持） | 返回 SSE 事件 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api |
| tools | array（元素 `{type: string}`，type 必填） | 否 | 未说明 | 未说明 | 未说明 | 只出现在 OpenAPI 里（图像和视频都有），正文没有描述【未核实】 | arkcli docs apis spec |
| content[].image_url.url | string | 视任务而定 | — | 公网 URL、`data:image/...;base64,...`、`asset://<ID>` | Seedance 全系列 | < 30 MB/张；请求体 ≤ 64 MB；宽高比 [0.4, 2.5]；宽高 [300, 6000] | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api |
| content[].role | string | 首尾帧和参考素材必填 | — | first_frame / last_frame / reference_image / reference_video / reference_audio | 按场景 | 首帧可以留空或写 first_frame | 同上 |
| content[].video_url.url | string | 视任务而定 | — | 原文只列公网 URL、`asset://<ID>` | Dreamina Seedance 2.5、2.0 系列 | ≤ 200 MB；mp4/mov；总像素 [407696, 8295044] | 同上 |
| content[].audio_url.url | string | 视任务而定 | — | 公网 URL、`data:audio/<小写fmt>;base64,...`、`asset://<ID>` | Dreamina Seedance 2.5、2.0 系列 | ≤ 15 MB；wav/mp3；2.0 系列不能只传音频 | 同上 |
| service_tier | string | 否 | `default` | default、flex | flex 不支持 Dreamina Seedance 2.5 / 2.0 系列 | 提交后不能改；flex 价格是在线的 50% | 同上 |
| callback_url | string | 否 | 未说明 | URL | Seedance | 状态变化时 POST；只有 succeeded/failed 写明 5 秒未确认重试 3 次；需要自建公网服务器，纯前端用不了 | 同上；https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial |
| execution_expires_after | integer | 否 | 172800 | [3600, 259200]（秒） | Seedance | 超时后标记为 `expired` | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api |
| priority | integer | 否 | 0 | [0, 9] | Dreamina Seedance 2.5、2.0 系列 | 只在同一 Endpoint 内生效；flex 不支持 | 同上 |
| safety_identifier | string | 否 | — | ≤ 64 字符（OpenAPI maxLength 64） | Seedance | 建议传用户 ID 的哈希 | 同上 |
| page_num（List） | integer / null | 否 | 1 | [1, 500] | Seedance | 只能查最近 7 天；QPS 1 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/list-video-generation-tasks-api |
| page_size（List） | integer / null | 否 | 20 | [1, 500] | Seedance | — | 同上 |
| filter.status | string / null | 否 | — | queued、running、cancelled、succeeded、failed | Seedance | — | 同上 |
| filter.task_ids | string[] / null | 否 | — | 重复传参：`filter.task_ids=id1&filter.task_ids=id2` | Seedance | — | 同上 |
| filter.model | string / null | 否（Key 是 Custom 权限时必填） | — | Model ID 或 Endpoint ID，只能传 1 个 | Seedance | 传 Model ID 时只返回经预置接入点发起的任务 | 同上 |
| filter.service_tier | string / null | 否 | `default` | default、flex | Seedance | — | 同上 |
| DELETE /tasks/{id} | — | — | — | queued → 取消（变为 cancelled）；succeeded/failed/expired → 删除记录；running/cancelled → 不能操作 | Seedance | QPS 20；无响应参数 | https://ai.byteplus.com/ark/region:ap-southeast-1/docs/cancel-or-delete-video-generation-tasks-api |

视频任务状态：GET 和 List 文档列出 queued、running、cancelled、succeeded、failed；callback 文档、教程的回调示例、DELETE 表里还有 `expired`。

## 9. 对前端表单设计的补充要点（核查新增）

- 统一用请求体传参，不要用提示词里的 `--rs/--rt/--dur/--seed/--cf/--wm` 旧式写法（弱校验）。来源：create-video-generation-task-api
- Seedance 2.0 / 2.5 开通前提（满足其一）：余额 > USD 30；或 ≥ USD 30 档的 AI Savings Plan；或有可用额度的 Seedance 资源包。没满足时出错，界面要引导用户。
- 2.5 的 `omni_reference_task_type`（auto/reference/edit/extend，默认 auto）显式指定后会同步校验。edit 和 extend 要求 `ratio=adaptive`；edit 还要求 `duration=-1`、编辑视频 4–30 s。
- Draft（只有 2.5 和 1.5 pro 支持）只能 480p；正式视频用 `type=draft_task` 引用草稿。
- 提示词建议长度：Seedream ≤ 300 个汉字或 600 个英文单词；Seedance ≤ 500 个汉字或 1000 个英文单词（只是建议）。
- data URL 的 MIME 子类型必须小写。
- 错误展示：401 提示检查 Key 状态、Region、项目；429 要区分 IPM、RPM、queued 上限、额度类问题；Seedance 2.5 的异步错误要在轮询结果里展示。

## 10. Gaps（未核实 / 文档未说明）

- 带合法 Key 时，`/contents/generations/tasks` 的 2xx 和业务 4xx 响应是否带 ACAO：没有测（任务要求只做无 key 请求）。带伪造 Authorization 头时的 401 是否带 ACAO 也没测。
- 带合法 Key 时 `/images/generations` 的响应 CORS 头：没测；不过预检已经失败。
- Seedream 图像结果 URL 的真实域名和桶的 CORS 情况：文档没给，没有实测。
- 真实结果对象（预签名 URL）的 GET 响应头是否带 CORS、是否支持 Range：没有直接验证（桶级预检返回 CORS is not enabled）。
- 视频 URL 的 100 次下载上限适用范围：API 页（只限 2.5）和教程（未限定）不一致；`<video>` 的 Range 请求是否计数，文档没说。
- Seedream 图像 URL 是否有下载次数限制：文档没提。
- EU region：支持模型（只有 seed-2-0-lite）和支持 API（含 Image generation）矛盾；EU 预检不允许 authorization。
- `tools` 字段：只出现在 OpenAPI 里，语义和支持模型未说明。
- Files API 的 file_id 能否用于生成接口：文档和 schema 都没提供。
- video_url 是否支持 base64：文档只列了 URL 和 asset ID。
- 限流口径：视频教程和突发流量文档写不区分版本，Seedream 教程写 IPM 按特定版本。
- 图像接口的 RPM、并发、请求体大小上限：文档没给。
- queued 任务数上限的具体数值：文档没给（只知道超过会报 429 QuotaExceeded）。
- FAQ 里 5 s 下载超时、ACL 返回 403、Content-Type 校验这几条属于视觉理解章节，是否适用于生成接口：文档没说。
- GET 接口是否会返回 `expired` 状态：GET 文档的枚举里没有。
- 2026-09-17 之后的新 Key 格式（前缀、长度）：文档没给。
- 公共错误码页面 byteplus-platform/reference-common-error-codes：没有展开阅读。
- callback_url 的默认值和取值约束，以及 queued/running/expired 回调是否重试：文档没说。
- Seedance 1.0/1.5 的 RPM 和并发是否区分企业/个人：文档没分。
- Seedance 图片输入的宽高比和宽高区间：API 页是闭区间，教程是开区间。


## corrections
[
 {
  "claim": "§4：超过最大并发时，新任务进入排队，不报错",
  "problem": "\"不报错\"没有原文支撑，而且和错误码页面矛盾。教程只写了 newly created tasks enter a queue for processing；错误码页面另有一条 429 QuotaExceeded，含义是当前账号 queued 状态任务数超限",
  "correct_fact": "达到最大并发后新任务会进入排队（教程原文）。但 queued 任务数有上限，超过会返回 429 TooManyRequests / QuotaExceeded（原文：The number of tasks in the queued state for the current account has exceeded the limit）。具体上限文档未说明",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes"
 },
 {
  "claim": "§3：429 QuotaExceeded 同一个 code 有两种含义（免费额度用完 / queued 任务数超限）",
  "problem": "错误码表里 QuotaExceeded 实际有三行",
  "correct_fact": "三种含义：(1) 某模型的免费试用额度用完；(2) 账号 queued 状态任务数超限；(3) You have exceeded the 5-hour/weekly/monthly usage quota，会在 {reset_time} 重置。前端要按 message 区分，不能只看 code",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes"
 },
 {
  "claim": "§8：stream 支持模型列表在文档里（可见部分有 Seedream 5.0 lite）",
  "problem": "表述含糊，看起来像没读完。原文明确列了支持模型",
  "correct_fact": "stream（boolean，默认 false）的支持模型是 Seedream 5.0 lite、Seedream 4.5、Seedream 4.0。Seedream 5.0 pro / flash 原文写的是 Sequential image generation, web search, and streaming output are not currently supported",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/image-generation-api"
 },
 {
  "claim": "§8：callback_url 在任务状态变化时 POST 回调；5 秒内没收到确认会重试 3 次",
  "problem": "重试规则被泛化到了所有状态。原文只在 succeeded 和 failed 两个状态下写了 5 秒未确认重试 3 次",
  "correct_fact": "回调状态有 queued、running、succeeded、failed、expired。只有 succeeded 和 failed 写明 no successful delivery confirmation is received within 5 seconds 时重试三次；queued、running、expired 是否重试文档未说明",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "§0 / §7：Seedance 2.5 产出的 URL 最多下载 100 次",
  "problem": "只引用了 API 页面的说法，漏了视频教程的不同表述",
  "correct_fact": "GET 和 List API 页面写的是 A video URL generated by Dreamina Seedance 2.5 can be downloaded up to 100 times（只限 2.5）；视频教程的 Retention period 写的是 Video URLs are retained for 24 hours and can be downloaded up to 100 times，没有限定模型。两处不一致，前端应保守地认为所有 Seedance 输出 URL 都可能有 100 次上限",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial"
 },
 {
  "claim": "§7：生成的视频 URL（24 小时内）可以直接作为另一次 Seedance 调用的输入，即可信输出",
  "problem": "\"24 小时内直接用原 URL\"是推论。原文写的可信有效期是 30 天，而且示例是把原视频转存到 TOS 后再用",
  "correct_fact": "可信范围：Seedance 2.5 / 2.0 系列生成的含人脸视频（2026-03-11 起）、对应尾帧图（2026-04-16 起）、Seedream 5.0 lite 文生图得到的含人脸图片（2026-04-16 起），有效期都是自生成起 30 天。限制：只认 ModelArk 平台、同一账号、原始输出；二次编辑或过期后失效；Compressing or forwarding files may invalidate trust verification，建议直接存到 BytePlus TOS；可信只作用于输入审核，输出仍可能被拦截。原视频 URL 本身只有 24 小时有效",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide"
 },
 {
  "claim": "§5.4：Files API 的 file_id 不能当作生成接口的素材上传通道",
  "problem": "\"不能\"是根据 schema 里没有该字段推出来的，原文没有明确禁止",
  "correct_fact": "Files API 文档写的用途是配合 Responses API / Chat API 做多模态理解。图像和视频生成接口的文档、OpenAPI schema（ImageInput、ImageURL、VideoURL、AudioURL）都只有 url 字符串字段，没有 file_id。准确说法是：文档未说明生成接口支持 file_id，按不支持设计",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/file-api"
 },
 {
  "claim": "§8：content[].video_url.url 取值为公网 URL、asset://（不支持 base64）",
  "problem": "\"不支持 base64\"是推论，原文只列了支持的方式",
  "correct_fact": "原文：Video URL or asset ID（Input methods: Video URL or asset ID）。文档没有列 base64，也没有明文禁止。前端按\"只提供 URL / asset 输入\"设计即可，但要标注为推论",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "§0：图像生成和视频任务的 4 个接口都写明只支持 API Key 鉴权",
  "problem": "数量不对：图像 1 个加视频 4 个（create/get/list/delete），共 5 个。另外漏了通用鉴权页的不同说法",
  "correct_fact": "5 个接口的 Authentication 标签都写 This API (only) supports only API Key authentication。但 base-url-and-authentication 页面说数据面整体支持 API Key 和 Access Key（AK/SK）两种鉴权，而且用 AK/SK 时 model 必须是 Endpoint ID。以具体 API 页为准。OpenAPI 的 securitySchemes 列了 BearerAuth 和 VolcSignatureV4，但这两个操作级的 security 只有 [{BearerAuth: []}]",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/base-url-and-authentication"
 },
 {
  "claim": "§6 #1：预检失败——不允许 authorization，而且 * 也不能覆盖 Authorization",
  "problem": "技术表述混淆。实测里的 * 是 Access-Control-Allow-Origin，它管的是来源，不管请求头",
  "correct_fact": "预检失败的直接原因是 Access-Control-Allow-Headers 固定为 Origin,Content-Length,Content-Type，不含 authorization。（按 Fetch 规范，即使 Allow-Headers 是 *，也不覆盖 Authorization；这是浏览器规范推论，不是文档内容。）复测于 2026-10-08，结果一致",
  "source_url": "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations"
 },
 {
  "claim": "§4：限流范围不一致——突发流量文档说按主账号、按模型（不区分版本）；Seedream 教程说 IPM 按特定版本",
  "problem": "来源不完整：视频教程也写了不区分版本",
  "correct_fact": "突发流量最佳实践和视频生成教程（Rate limits 一节：Under the same primary account, requests to the same model, regardless of model version）都写不区分版本；Seedream 教程写 IPM 是 by a specific version of a model under an account。图像与视频的口径不同，原因文档未说明",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial"
 },
 {
  "claim": "§4 视频限流表：seedance-1-0-pro 等是 RPM 600 / 并发 10（不区分企业/个人）",
  "problem": "\"不区分\"是解读，原文只写了 default: 没有分企业/个人两行",
  "correct_fact": "model-list 对 seedance-1-0-pro-250528、seedance-1-0-pro-fast-251015、seedance-1-5-pro-251215 只写 default: Max RPM 600 / Max concurrency 10，flex: TPD 500B；是否区分企业/个人文档未说明",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-list"
 },
 {
  "claim": "§5.2：Seedance image_url 宽高比 [0.4, 2.5]；宽高 [300, 6000] px",
  "problem": "漏了文档之间的区间写法不一致",
  "correct_fact": "创建任务 API 页写闭区间 [0.4, 2.5]、[300, 6000]；视频教程 Limitations 写开区间 (0.4, 2.5)、(300, 6000)。前端校验建议用更严格的开区间，或在边界值上给出提示",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial"
 },
 {
  "claim": "§5.2：video_url 的时长：2.5 每段 2–30 s，最多 10 段，总长 ≤ 30 s",
  "problem": "漏了视频编辑任务的特殊下限，也漏了像素总量约束",
  "correct_fact": "Dreamina Seedance 2.5：非视频编辑任务每段 2–30 s；视频编辑任务每段 4–30 s；最多 10 段，总长 ≤ 30 s。2.0 系列：每段 2–15 s，最多 3 段，总长 ≤ 15 s。另外总像素（宽×高）须在 [407696, 8295044]，输入分辨率 480p/720p/1080p/4k",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 },
 {
  "claim": "§7 推论：不带 crossorigin 的 <video src> 应该能直接展示",
  "problem": "只考虑了 CORS，漏了文档明确写出的编码兼容性风险",
  "correct_fact": "创建任务文档：Dreamina Seedance 2.5 的 1080p 和 Dreamina Seedance 2.0 的 4K 输出是 10-bit、H.265/HEVC 编码，may not be compatible with some playback environments；Seedance 2.5 的 output_format=mov 是 H.264 + YUV 4:4:4 + PCM 音频，Some players may not support this combination。浏览器 <video> 能否播放要另行验证，不能只按 CORS 判断",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api"
 }
]

## missing_items
- OpenAPI 合约里图像（image-generation-ImageGenerations_generate）和视频（content-generation-ContentGenerationTasks_create-video）的 requestBody 都有 tools 字段（array，元素是 {type: string}，type 必填），但正文文档没有说明它。图像文档只说 Seedream 5.0 pro / flash 当前不支持 web search。tools 的语义、可用 type、支持模型都没核实，前端暂时不要暴露
- 视频创建有"旧式"传参：在 text 末尾追加 --rs/--rt/--dur/--seed/--cf/--wm，属于弱校验（非法值可能被忽略或报错）；官方推荐在请求体里直接传，走严格校验。前端应统一用 body 参数，并提醒用户提示词里不要写 --xx
- Dreamina Seedance 2.0 / 2.5 的开通前提（满足其一）：BytePlus 余额 > USD 30；或购买 ≥ USD 30 档的 AI Savings Plan；或有可用额度的 Seedance 资源包。没满足时可能出现 ModelNotOpen / ServiceNotOpen，前端错误提示要能引导用户（来源：create-video-generation-task-api）
- Dreamina Seedance 2.5 的部分任务类型是异步报错（原文：an error is returned only after the queued task is consumed），例如 InvalidParameter.TaskTypeConstraint / TaskTypeMismatch。创建接口返回成功不代表参数都合法，前端必须轮询 GET，在 status=failed 时展示 error.code / error.message
- omni_reference_task_type（auto/reference/edit/extend，默认 auto，只有 2.5 支持）：显式指定后会在提交时同步校验。edit 要求至少一个 reference_video、视频 4–30 s、ratio=adaptive、duration=-1；extend 要求至少一个 reference_video、ratio=adaptive。这是平台层"提前失败"的手段
- safety_identifier：最终用户标识，string，maxLength 64（OpenAPI + 正文），建议传用户名、ID 或邮箱的哈希。前端表单可以隐藏它，自动填充
- priority：integer，默认 0，取值 [0, 9]，只有 Dreamina Seedance 2.5 / 2.0 系列支持；只在同一个 Endpoint 内生效；service_tier=flex 时不支持
- service_tier：flex 价格是在线的 50%，Dreamina Seedance 2.5 / 2.0 系列当前不支持；提交后不能修改。表单要按模型禁用 flex（否则返回 400 InvalidParameter.UnsupportedParameter）
- Seedance 输出的编码兼容性：2.5 的 1080p 和 2.0 的 4K 是 10-bit H.265/HEVC；2.5 的 mov 输出是 H.264 4:4:4 + PCM。浏览器 <video> 预览可能失败，需要降级（提供下载、提示用 VLC/mpv/QuickTime）
- GET 返回的 duration 是 floor(实际总帧数 / 24)，可能和实际时长不一致（例如 133 帧实际 5.54 s，返回 5）。前端显示时长最好以 <video> 元数据为准
- Draft 模式（draft=true，只有 Dreamina Seedance 2.5 和 Seedance 1.5 pro 支持）只能生成 480p，用其他分辨率会报错；正式视频要用 content[].type=draft_task + draft_task.id 引用草稿任务
- content 的组合规则：首帧、首尾帧、omni reference（参考图/视频/音频）三种场景互斥，不能混用；2.0 系列不支持只传音频，至少要有一张参考图或一个参考视频；首尾帧时 role 必填（first_frame / last_frame），参考素材 role 固定为 reference_image / reference_video / reference_audio
- Seedream 组图：sequential_image_generation=auto 时，输入参考图数 + 生成图数 ≤ 15；max_images 是 integer，默认 15，取值 [1, 15]（OpenAPI 有 minimum/maximum）。只有 Seedream 5.0 lite / 4.5 / 4.0 支持
- 提示词长度建议：Seedream ≤ 300 个汉字或 600 个英文单词；Seedance ≤ 500 个汉字或 1000 个英文单词（只是建议，不是硬限制）。Seedance 只保证英文提示词，2.5 / 2.0 另外支持部分语言，文档没有列中文（2026-10-10 补：S25 写 2.5 支持中文，1.0 / 1.5 pro 提示词指南写支持中英文，2.0 提示词指南有中文对白规则）
- data URL 格式要求：图像是 data:image/<fmt>;base64,...，音频是 data:audio/<fmt>;base64,...，<fmt> 必须小写。前端用 FileReader 生成 data URL 后要把 MIME 子类型转成小写，并核对 heic/heif 的支持模型（Seedream 支持；Seedance 是 1.5 pro 及之后的模型，教程写的是 1.5 Pro 和 2.0 系列）
- API Key 可以被禁用（Disabled），禁用后请求鉴权失败（401 AuthenticationError）；Key 只能访问创建它的项目里的资源，接入点跨项目迁移后原 Key 不能再用于该接入点。前端遇到 401 时要提示用户检查 Key 状态、Region、项目
- List 接口的 filter.model：API Key 是 Custom 权限时必须填；只能传 1 个；传 Model ID 时只返回经预置接入点发起的任务。前端"历史任务"页要允许用户填 Endpoint ID
- Files API 相关错误：403 OperationDenied.FileQuotaExceeded（默认托管空间 20 GB 用满）、403 OperationDenied.InvalidState（file 未到可用状态）。虽然生成接口用不上 file_id，如果页面接入 Files API 就要处理这两个错误
- FAQ（视觉理解章节）：经 URL 传图时，部分格式（TIFF/SGI/ICNS/JPEG2000）按 Content-Type 元数据校验，对象存储必须正确设置 Content-Type；默认图片下载超时 5 s；部分对象存储的 ACL 会拒绝 BytePlus 来源，返回 403。这些是否适用于生成接口文档未说明，但前端可以把它们作为 URL 输入的提示文案
- EU region 的平台能力表：Playground、Batch inference、Network configuration 等在 EU 不可用；API keys、Online inference、Model activation management 可用。EU 的 images 和 tasks 预检都不允许 authorization（实测）
- 图像接口错误：组图里单张因内容审核失败时会继续生成下一张；遇到 500 内部错误则不再继续。图层拆分里任意一层失败会导致整单失败，不支持部分成功。前端结果展示要分别处理

## gaps
- 带合法 API Key 时，/contents/generations/tasks 的 2xx 响应和业务 4xx 响应是否带 Access-Control-Allow-Origin 无法验证（任务要求只做无 key 请求）；只确认了预检能通过，以及无 key 的 401 响应不带 ACAO。
- 带合法 Key 时，/images/generations 的 POST 响应是否带 ACAO 无法验证；不过预检已经不允许 authorization 头，浏览器直连在预检这一步就会失败。
- 官方文档全文检索 CORS、browser 都没有结果：文档没有任何关于浏览器直连、前端调用、跨域的说明。
- Seedream 图像结果 URL 的实际域名文档没给出（示例只写了 https://...），只验证了文档里视频示例域名 ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com 的桶没开 CORS；图像结果桶的 CORS 情况没有实测。
- 实测 TOS 结果桶时用的是不存在的对象 key（xxx），没有拿到真实的预签名结果 URL；真实对象 GET 响应是否带 CORS 头、是否支持 Range 没有直接验证（桶级预检返回 CORS is not enabled，推测相同）。
- Seedance 2.5 的结果 URL 最多下载 100 次：<video> 播放时的多次 Range 请求是否计入次数，文档没说。
- Seedream 图像结果 URL 有没有下载次数限制，文档没提（只写了有效期 24 小时）。
- EU region 文档自相矛盾：EU 支持的模型只列了 seed-2-0-lite，但 EU 支持的 API 里列了 Image generation API。EU 是否能调用 Seedream 或 Seedance 不清楚；而且 EU 的 images 和 tasks 预检都不允许 authorization。
- Files API 的 file_id 是否能用于图像或视频生成：文档只写了用于 Responses/Chat 多模态理解，生成接口的 OpenAPI schema 里只有 url 字段，没有说明支持 file_id。
- Seedance 视频输入（video_url）文档只列了公网 URL 和 asset ID，没说是否支持 base64 data URL，按不支持处理。
- 限流范围表述不一致：突发流量最佳实践写的是按模型、不区分版本；Seedream 教程写的是 IPM 按模型的特定版本计算。
- 图像接口只给了 Max IPM（500），没有给 RPM 和并发上限。
- 图像接口的请求体大小上限文档没说明（64 MB 只出现在视频任务 API 里）。
- FAQ 里图片下载默认超时 5 秒、对象存储 ACL 返回 403 这些说明位于视觉理解章节，是否适用于 Seedream/Seedance 生成接口拉取参考素材，文档没说。
- 视频任务状态枚举：GET/List 文档只列了 queued、running、cancelled、succeeded、failed，但 callback、DELETE、execution_expires_after 的说明里出现了 expired 状态，GET 接口是否会返回 expired 需要以实际为准。
- 2026-09-17 之后创建的 API Key 采用新明文格式，具体格式（前缀、长度）文档没给出，前端不能据此校验格式。
- 公共错误码页面 byteplus-platform/reference-common-error-codes 没有展开阅读。
- callback_url 的默认值和取值约束文档没说明。