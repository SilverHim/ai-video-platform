# ModelArk 侧对 TOS 素材的要求（核查修订版，只依据 BytePlus 官方文档）

核查日期：2026-10-08。ModelArk 文档版本为 arkcli docs revision 265（bp.en）；TOS 文档取自 docs.byteplus.com 的 SSR 正文。标注【推断】的内容原文没有直接写；其余每条都附来源。

## 来源
- [S1] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-via-tos-internal-presigned-url
- [S2] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api
- [S3] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial
- [S4] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-0
- [S5] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5
- [S6] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/project-configuration
- [S7] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/file-api
- [S8] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq
- [S9] https://docs.byteplus.com/en/docs/tos/docs-region-and-endpoint
- [S10] https://docs.byteplus.com/en/docs/tos/reference-including-a-signature-in-the-url
- [S11] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide
- [S12] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes
- [S13] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-api
- [S14] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/c2pa-content-credentials-guide
- [S15] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-understanding
- [S16] https://docs.byteplus.com/en/docs/tos/2116749（TOS 默认域名限制公告）
- [S17] https://docs.byteplus.com/en/docs/tos/How-to-preview-objects-in-a-browser
- [S18] https://docs.byteplus.com/en/docs/tos/Creating_data_subscription_rules
- [S19] https://docs.byteplus.com/en/docs/tos/docs-uploading-a-file
- [S20] https://docs.byteplus.com/en/docs/tos/reference-putobject
- [S21] https://docs.byteplus.com/en/docs/tos/Install-the-node-js-sdk ／ https://docs.byteplus.com/en/docs/tos/Initializing-the-client-side-node-js-sdk ／ https://docs.byteplus.com/en/docs/tos/Normal-pre-signature-node-js-sdk
- [S22] https://docs.byteplus.com/en/docs/tos/Normal-pre-signature-python-sdk
- [S23] https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-real-person-portrait-assets

---

## 0. 结论速览
| 问题 | 文档原文 | 来源 |
|---|---|---|
| 内网预签名是否必须同 region | 必须。桶与 ModelArk 同 region，URL 用该 region 的内网 TOS endpoint | [S1] |
| Johor 内网 endpoint | `tos-ap-southeast-1.ibytepluses.com`；S3 兼容内网 endpoint 为 `tos-s3-ap-southeast-1.ibytepluses.com` | [S1][S9] |
| Johor 外网 endpoint | `tos-ap-southeast-1.bytepluses.com`；S3 兼容外网 endpoint 为 `tos-s3-ap-southeast-1.bytepluses.com` | [S9] |
| 内网预签名是否明确适用于 Seedance | 没写。内网预签名页只演示了 Chat Completions 视频理解（`seed-2-0-lite-260228`）；Seedance 的 `content.video_url.url` 写的是 public URL 或 `asset://` | [S1][S2] |
| Seedance 推荐做法 | 确保 URL 公网可访问；推荐存 BytePlus TOS 并配置公共读 | [S4][S5] |
| 预签名 URL 是否需要先在控制台做 TOS 授权 | 内网预签名页没提授权。控制台“项目授权 → TOS”的作用写的是供 Files API 的 `tos` 参数使用 | [S1][S6][S7] |
| 有效期 | ModelArk 只说有效期有限，可用 `expires` 设置，没给建议值。TOS 规定 `X-Tos-Expires` 取 1–604800 秒（7 天） | [S1][S10] |
| Content-Type | Seedance 规格表列出 `video/mp4`、`video/quicktime`。按 Content-Type 校验的 FAQ 只针对视觉理解的部分图片格式 | [S2][S8] |
| 视频上限 | mp4/mov，≤200 MB，FPS 在 [24,60]，另有时长、尺寸、像素要求 | [S2][S3][S5] |
| 可信输出转存 TOS | 推荐把原始输出直接存到 BytePlus TOS。条件：同账号、ModelArk 平台产出、未经二次编辑、30 天内；压缩或转发可能让信任校验失效 | [S11] |
| 新增：默认域名的预签名访问 | 2026-08-01 及以后新建的桶，用默认域名做预签名或匿名访问时，响应会自动带 `Content-Disposition: attachment` | [S16] |

---

## 1. 公网预签名与内网预签名

### 1.1 内网预签名（[S1] 全页已逐句核对）
- **做法**：文件放在与所访问 ModelArk 服务同 region 的**私有** TOS 桶；用内网 TOS endpoint 生成 `GET` 预签名 URL；再通过内网把文件交给 ModelArk。
- **URL 示例**：`https://<YOUR_PRIVATE_BUCKET>.tos-ap-southeast-1.ibytepluses.com/path/to/object?...signature...`
- **好处**：
  - 源文件不能从公网直接访问，只能凭预签名 URL 访问。
  - 若 URL 用的是“你所在环境支持的”内网 endpoint，传输可以不走公网流量。原文带了这个条件。
- **Warning**：TOS 桶与 ModelArk 服务必须同 region。另有一句：URL 必须使用与访问 ModelArk 的 region 对应的内网 TOS endpoint。
- **示例凭证**：环境变量 `TOS_ACCESS_KEY` / `TOS_SECRET_KEY`，加上 `ARK_API_KEY`。
- **示例调用**：`base_url="https://ark.ap-southeast.bytepluses.com/api/v3"`，接口 `client.chat.completions.create`，`{"type":"video_url","video_url":{"url":...}}`，场景是视频理解。
- **有效期**：Tip 只说可用 `expires` 设置，并链接 TOS 的 General presigned (Python SDK)，没给推荐值。
- **FAQ“ModelArk 读不到输入文件”的检查顺序**：
  1. 是否同 region；
  2. 内网 endpoint 是否正确；
  3. URL 是否过期；
  4. 对象是否存在，key 是否与签名时完全一致；
  5. URL 是否被截断、重复编码或丢了 query；
  6. 所选模型是否支持该输入类型。
- **补充**：该页示例场景是视频理解。视频理解通过 URL 传视频时，单个视频不超过 50 MB；Base64 也不超过 50 MB，请求体不超过 64 MB [S15]。

### 1.2 公网 URL / 公网预签名
- ModelArk 没有专门讲“公网预签名 URL”的页面。
- Seedance 字段的要求：
  - `content.video_url.url`：public URL 或 `asset://<ASSET_ID>`；
  - 图片、音频：publicly accessible URL、Base64 或 asset ID [S2]。
- 2.0 和 2.5 教程都写了：确保 URL 公网可访问，推荐存 BytePlus TOS 并配置公共读 [S4][S5]。2.5 教程这句后面的链接指向的是 Data subscription，链接错位。
- 【推断】用外网 endpoint 生成的 GET 预签名 URL 在有效期内可以公网访问，形式上符合 public URL 的要求。但 Seedance 文档没有专门提预签名这种用法。
- **新增事实：默认域名限制** [S16]：
  - 适用范围：2026-08-01 及以后新建的桶，用默认域名做预签名或匿名访问。
  - 效果：TOS 自动在响应头加 `Content-Disposition: attachment`，任何类型的对象都会直接下载，不再在线预览。
  - `.apk`、`.ipa`、`.hap` 通过默认域名或预签名 URL 访问会被拒，返回 400 `ApkDownloadForbidden`。
  - 想预览，需改用自定义域名。
  - TOS FAQ [S17] 也说默认域名会加 attachment，但时间分界写的是 2024-01-03 23:59:59，与公告不一致。FAQ 还说 Content-Type 与实际类型不符时浏览器也会强制下载。
  - 【推断】这影响的是浏览器预览。ModelArk 服务端拉取是否受影响，文档没写。

### 1.3 TOS endpoint（[S9]，Johor）
| Region | Region ID | Endpoint | S3 Endpoint |
|---|---|---|---|
| Asia Pacific (Johor) | `ap-southeast-1` | 外网 `tos-ap-southeast-1.bytepluses.com`；内网 `tos-ap-southeast-1.ibytepluses.com` | 外网 `tos-s3-ap-southeast-1.bytepluses.com`；内网 `tos-s3-ap-southeast-1.ibytepluses.com` |

内网域名在哪里可以解析或访问、怎么计费，该页都没写。

### 1.4 预签名格式与签名（[S10]）
- **URL 示例**：`https://bucketname.tos-ap-southeast-1.bytepluses.com/object?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=<access-key-id>/<YYYYMMDD>/<region>/tos/request&X-Tos-Date=...&X-Tos-Expires=86400&X-Tos-SignedHeaders=host&X-Tos-Signature=...&X-Tos-Security-Token=...`
- **参数**：
  - `X-Tos-Algorithm`：只支持 `TOS4-HMAC-SHA256`。
  - `X-Tos-Expires`：单位秒，取 1–604800 的整数（最长 7 天）。
  - `X-Tos-SignedHeaders`：必须包含 `host`，且所有 `x-tos-*` 头都要参与签名。
  - `X-Tos-Security-Token`：使用临时 AK/SK 时必须带。
- **签名计算**：
  - 载荷用 `UNSIGNED-PAYLOAD`。
  - CanonicalRequest 里包含 `host:<bucket>.tos-ap-southeast-1.bytepluses.com`。
  - SigningKey = HMAC 链，依次是 SK → date → region → `tos` → `request`。
  - 凭证范围里的 region 写 `ap-southeast-1`。
- **安全含义**：URL 里明文带 AK ID。任何拿到 URL 的人，在有效期内都能执行该操作。
- 【推断】host 参与了签名，所以内网 URL 必须直接用内网 endpoint 签出来，不能先签外网 URL 再改域名。

### 1.5 SDK（Node.js，[S21][S22]）
- BytePlus 文档给出的包名是 `@volcengine/tos-sdk`，要求 Node.js 10 及以上。
- 初始化需要 `accessKeyId`、`accessKeySecret`、`region`、`endpoint`。
- 超时默认值：`requestTimeout` 120000 ms，`connectionTimeout` 10000 ms。可设 `maxRetryCount`、`enableCRC`。
- 预签名方法：`client.getPreSignedUrl({ method: 'GET'|'PUT'|'DELETE', bucket, key })`。
- Node 和 Python SDK 页都没写 `expires` 的默认值，Python 示例显式传 `expires=3600`。

---

## 2. 对 Seedance 生成接口（`POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`）
- **视频** `content.video_url.url`：
  - 只接受视频的 public URL，或 `asset://<ASSET_ID>`（数字人或已授权的真人素材）[S2][S11]。
  - 不支持 Base64 [S3][S5]。
  - `role` 固定为 `reference_video`。
- **图片**：URL、`data:image/<小写格式>;base64,...` 或 asset ID [S2]。
- **音频**：URL、`data:audio/<小写格式>;base64,...` 或 asset ID [S2]。
- 生成接口没有 Files API 的 file_id 输入，也没有 `tos://` 输入。Files API 的 file_id 写明只用于 Responses API 和 Chat API 的多模态理解 [S7]。
- 内网预签名能否用于 Seedance：**文档没写**。
- 官方示例的素材域名：
  - 输入：`ark-doc.tos-ap-southeast-1.bytepluses.com` [S11]，以及 `arkdocs-en.tos-ap-southeast-1.volces.com` [S2]；
  - 输出 `video_url` 示例：`ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com` [S3]；
  - 都是公网 URL，没有内网示例。

## 3. TOS 授权、ArkAccessRole、错误码
- **控制台路径**：System Settings → Project configuration → Project authorization → TOS → Add authorization → 选桶 → Confirm → Authorize [S6]。
  - 每个桶默认未授权，可点 Cancel 撤销。
  - 授权后，该项目的 API key 可以在 Files API 里用 `tos` 参数访问已授权对象 [S6]。
- **权限**：
  - ArkFullAccess / ArkStandardGlobalAccess 可以做项目授权；ArkReadOnlyAccess 不行。
  - 主账号默认看到 default 项目的授权状态；子账号默认没有授权权限 [S6]。
- **错误码**（均为 403 Forbidden）[S12]：
  - `OperationDenied.ArkAccessRoleNotFound`：请到 Project configuration > Project authorization 给 TOS 桶授权。
  - `OperationDenied.TosAccessDenied`：TOS 拒绝访问。message 带资源名和 TOS 原始响应，处理方法是确认账号或项目已获授权。
- 【推断】这两个错误码对应 ModelArk 以项目身份代访问 TOS 的路径（Files API 的 `tos` 参数、`tos://`）。预签名 URL 自带签名，文档没有要求先授权。原文没有直接这么说。
- **Files API 的限制**（不适用于 Seedance）[S7][S13]：
  - 不传 `tos`：单文件 ≤512 MB，总容量 20 GB；
  - 传 `tos`：视频 ≤2 GB，其他类型 ≤512 MB；
  - `expire_at` 取值 [当前时间+86400, 当前时间+2592000]，默认 +604800；
  - 进了用户桶的托管对象只能读，不能通过 TOS 控制台或 TOS API 删除、覆盖、修改；生命周期删除、覆盖复制也受限；只能用 Files API 删除；
  - `url` 若是 HTTP/HTTPS，必须能从公网直接访问。

## 4. 有效期
- ModelArk 没给推荐值 [S1]。TOS 上限是 604800 秒 [S10]。
- Seedance 任务：
  - `execution_expires_after` 默认 172800 秒，范围 [3600, 259200]，从 created_at 起算，超时后状态为 `expired` [S2]；
  - 任务 ID 和任务记录保留 7 天 [S2][S3][S5]；
  - 输出的 video_url 保留 24 小时，最多下载 100 次 [S3][S5]。
- 【推断】文档没写 ModelArk 何时去拉取输入素材。保守做法是让预签名有效期不短于 `execution_expires_after`。这只是推断，不是文档建议。

## 5. Content-Type
- **Seedance 规格表**：`.mp4` → `video/mp4`；`.mov` → `video/quicktime` [S2][S3][S5]。
- **视频理解页**：Content Type 表列出 `video/mp4`、`video/x-msvideo`、`video/quicktime`，并指向 TOS 文件元数据配置页（docs-managing-file-metadata），作为上传视频到 TOS 时的配置说明 [S15]。这是视频理解场景，被指向的页面目前读不出正文。
- **FAQ（只针对视觉理解的图片）**[S8]：
  - 图片下载超时默认 5 秒，建议搬到 TOS 或压到 100 kB 以下；
  - 403 的原文是部分图片服务器**可能**有安全或 ACL 策略拦截来自 BytePlus 的访问，不是“通常”；
  - jpg/jpeg、png、gif、webp、bmp、dib、ico 按前 512 字节识别；
  - TIFF / SGI / ICNS / JPEG2000 按 URL 的 Content-Type 校验，必须设置正确；
  - FAQ 里给的 TOS 元数据链接 `https://www.byteplus.com/docs/6349/145523` 跳转后显示 Page not found（HTTP 200 的软 404）。
- **TOS 侧** [S20]：`Content-Type`、`Content-Disposition` 是 PutObject 的可选请求头；可用 `Content-MD5` 校验完整性。TOS 默认怎么推断 Content-Type，没查到。
- 【推断】上传时显式设置正确的 `Content-Type` 是防御性做法，Seedance 文档没有强制要求。

## 6. 素材规格（Seedance）与上传校验
### 6.1 视频 [S2][S3][S5]
- 容器：mp4、mov。
- 视频编码：H.264/AVC、H.265/HEVC。
- 音频编码：AAC、MP3。2.5 教程的 mov 行多了 PCM，API 页和通用教程没有。
- 分辨率：480p / 720p / 1080p / 4k。
- 尺寸：宽高比 [0.4, 2.5]；宽、高各在 [300, 6000] px；宽×高在 [407696, 8295044]。
- 单个 ≤200 MB；FPS 在 [24, 60]。
- 时长：
  - 2.5：非编辑任务每段 2–30 s，编辑任务每段 4–30 s，最多 10 段，总长 ≤30 s；
  - 2.0 系列：每段 2–15 s，最多 3 段，总长 ≤15 s。
- TS 转 MP4 的 FAQ 在 Online inference 小节，是通用说法 [S8]。`-c copy` 只换容器，转出的文件仍须满足上面的编码要求。

### 6.2 图片 [S2]
- 格式：jpeg/png/webp/bmp/tiff/gif；1.5 pro 及以后的模型还支持 heic/heif。通用教程 [S3] 写成“1.5 Pro 和 2.0 series”，两处不一致。
- 宽高比 [0.4, 2.5]；宽、高各在 [300, 6000] px。通用教程写成开区间。
- 单张 <30 MB；请求体 ≤64 MB。
- 数量：首帧 1 张，首尾帧 2 张，2.5 全能参考 1–30 张，2.0 全能参考 1–9 张。

### 6.3 音频 [S2]
- 格式：wav、mp3；单个 ≤15 MB；请求体 ≤64 MB。
- 时长：2.5 每段 2–30 s，最多 10 段，总长 ≤30 s；2.0 每段 2–15 s，最多 3 段，总长 ≤15 s。
- 2.5 支持只传音频；2.0 至少要带一张参考图或一段参考视频。

### 6.4 上传前校验（【推断】建议，数值来自文档）
1. 扩展名或容器，以及将要设置的 MIME；
2. 文件大小；
3. 用 ffprobe 读编码、FPS、宽高、像素积、时长；
4. 按模型检查段数和总时长；
5. 2.5 编辑任务要求 4–30 s；
6. 含真人脸的素材：Seedance 2.5/2.0 不支持直接上传 [S2]。错误码页有 400 `InputImageSensitiveContentDetected.PrivacyInformation` 和 `InputVideoSensitiveContentDetected.PrivacyInformation`，含义是“输入可能包含真人”[S12]。这两个错误码与 Seedance 人脸拦截的对应关系属于【推断】。
   - 替代方案：可信输出、预置数字人、经授权的真人素材入库（`asset://`，账号需完成实名或企业认证）[S11][S23]。

## 7. 可信输出转存 TOS [S11]
**信任范围**（都从产出时间起算 30 天）：
- Seedance 2.5 / 2.0 系列的含人脸视频：2026-03-11 起的产出可信；
- 对应的尾帧图：2026-04-16 起的产出可信；
- Seedream 5.0 lite 文生图的含人脸图片：2026-04-16 起的产出可信。

**Warning 原文要点**：
- 只信任 ModelArk 平台的产出，不能跨平台；
- 只信任同一账号的产出，不能跨账号；
- 只信任原始产出，二次编辑后或过了有效期都不行；
- 压缩或转发可能让信任校验失效，推荐把原始输出直接存到 BytePlus TOS；
- 信任只作用于输入，输出仍可能被审核拦截；
- 不含人脸的素材没有信任问题。

**原始 URL 与自动转存**：
- 原始视频 URL 只有 24 小时有效，可以配置 TOS 数据订阅自动转存。
- 数据订阅规则 [S18]：
  - 只支持 Johor；目标桶只能是 FNS 桶，不支持 HNS；
  - 只复制规则创建之后产生的数据；
  - 异步复制，可能乱序，可靠性至少 99.9%，有自动重试；
  - 只接 ModelArk 推理接入点的产出，支持 dreamina-seedance-2-5、dreamina-seedance-2-0、dreamina-seedance-2-0-fast、dreamina-seedance-2.0-mini 等模型；
  - 首次创建要一键授权，生成服务关联角色 `TosSubscribeToArkRole`，权限是 `tos:PutObject`；
  - 目标桶在当前 region，且源数据与目标桶须在同一国家。

**C2PA** [S14]：
- 默认嵌入 C2PA 的视频模型只有 Seedance 2.0 / 2.0-mini / 2.0-fast，没有列 2.5。
- 截图、转码、压缩可能移除或破坏凭证。
- 文档没说人脸信任校验是否依赖 C2PA。

**其他**：Seedance 2.5 的 mov 输出用 PCM 音频，而 API 页的 mov 输入行不含 PCM。2.5 的 mov 原始输出能否作为输入，需要实测。

**【推断】对本工具的含义**：
- 逐字节原样转存，不做 remux 或转码；
- 上传 TOS 用的 AK/SK 所属账号，最好与调用 Seedance 的 API Key 是同一账号；
- 记录产出时间，超过 30 天就不再当作可信素材；
- 用预签名 URL（而不是公共读 URL）传入时信任校验是否仍生效，文档没写。

## 8. 文档自身的不一致
- **[S1]**：Step 1 没有给真正的 TOS 预签名代码，代码块是 Ark 调用，变量里还是 `tos-ap-southeast-1.volces.com`；Sample output 和 Step 2 用的又是 `ibytepluses.com`。
- **mov 音频编码**：2.5 教程含 PCM，API 页和通用教程不含。
- **图片区间**：API 页是闭区间，通用教程是开区间；heic/heif 的适用模型两处写法也不同。
- **域名混用**：`*.volces.com` 与 `*.bytepluses.com` 混用；ModelArk 输出示例用 volces.com，而 TOS 的 endpoint 表没有列出它。
- **FAQ 重复条目**：同一条在两个小节里，一处写 BytePlus sources，一处写 Volcengine sources。
- **默认域名 attachment 的生效时间**：公告写 2026-08-01 起新建的桶 [S16]，FAQ 写 2024-01-03 [S17]。
- **托管对象限制的表述**：Upload file API 页只说不能在 TOS 控制台删改 [S13]；Files API 教程说不能通过 TOS 控制台或 TOS API 删、覆盖、改 [S7]。

## 9. 【推断】对“React + Hono 本机代理”实现的提示
- **上传**：本机代理走外网 endpoint `tos-ap-southeast-1.bytepluses.com`，用 PutObject（≤5 GiB，200 MB 的视频足够）。
  - 显式设置 `Content-Type`，可带 `Content-MD5`。
  - 对象保持默认私有。
  - AK/SK 若属于 IAM 子用户，需要 `tos:PutObject` 和读权限 [S19]。
  - 大文件留意 SDK `requestTimeout` 默认只有 120 s [S21]。
- **给 Seedance 的 URL**：
  - 默认用外网 GET 预签名 URL，与 Seedance 文档“public URL”的要求一致；
  - 内网 `ibytepluses.com` 预签名做成可选项，只在 region 为 `ap-southeast-1` 时允许，并标明“Seedance 是否接受，文档未写”。
  - 两种 URL 都在本地按 host 直接签，不要事后替换域名。
- **有效期**：在 1–604800 秒内，建议不短于任务的 `execution_expires_after`。若使用 STS，记得带 `X-Tos-Security-Token`。
- **页面预览**：用本地 blob URL，不要直接打开预签名 URL，因为新桶在默认域名下会被加 `Content-Disposition: attachment` [S16]。
- **URL 传递**：填进 JSON 时不要二次编码，也不要截断 query [S1]。
- **凭证安全**：预签名 URL 里明文带 AK ID [S10]，日志里要脱敏。SK 只保存在本机代理里，不要下发到前端。

## 10. 仍未核实（gaps）
- Seedance 是否接受内网预签名 URL；
- Seedance 拉取素材的时机、超时和重试；
- 视频和音频的 Content-Type 是否参与 Seedance 校验；
- TOS 怎么默认推断 Content-Type，元数据管理页（docs-managing-file-metadata）读不出正文；
- SDK `expires` 的默认值；
- 内网域名在哪里可以解析或访问、怎么计费；
- `Content-Disposition: attachment` 是否影响 ModelArk 服务端拉取；
- 用预签名 URL 传入可信输出时，信任校验是否有效；人脸信任是否依赖 C2PA；
- ModelArk 链接的 `docs/tos/Data_subscription` 页本身仍读不出正文（已用 TOS 文档 [S18] 替代）。


## corrections
[
 {
  "claim": "§5：403 通常是源站的安全或 ACL 策略拦截了 BytePlus 的访问",
  "problem": "限定词被夸大了。原文说的是部分图片服务器可能有特殊的安全或 ACL 策略，没有说“通常”。而且这一条只出现在“视觉理解模型 InvalidParameter”的 FAQ 里。另外，同一 FAQ 在 Visual understanding 小节重复了这一条，那里写的是拦截来自 Volcengine 的访问，文档前后不一致。",
  "correct_fact": "原文：Some image servers may have special security/ACL policies that block access from BytePlus sources，建议检查图片所在服务器的安全策略。只适用于视觉理解的图片输入。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq"
 },
 {
  "claim": "§5 和 gaps：FAQ 里的 TOS 元数据链接 https://www.byteplus.com/docs/6349/145523 打开是 404",
  "problem": "不够准确。HTTP 返回的是 200，先跳转到 https://www.byteplus.com/en/docs/6349/145523，页面正文显示 Page not found，属于软 404。",
  "correct_fact": "链接确实失效（页面显示 Page not found），但状态码是 200，不是 404。",
  "source_url": "https://www.byteplus.com/en/docs/6349/145523"
 },
 {
  "claim": "§7 和 gaps：Data subscription（TOS 数据订阅）页面读不到正文",
  "problem": "漏读了。ModelArk 链接的 Data_subscription 页确实读不出正文，但 BytePlus TOS 文档的 Creating data subscription rules 页可以正常读取，而且内容对实现有影响。",
  "correct_fact": "该页的关键限制：只支持 Asia Pacific (Johor)；目标桶只能是 FNS 桶，不支持 HNS；只复制规则创建之后产生的数据；异步复制，可能乱序，可靠性至少 99.9%，有自动重试；数据源只能是 ModelArk（ARK）推理接入点产出；支持的视频模型有 dreamina-seedance-2-5、dreamina-seedance-2-0、dreamina-seedance-2-0-fast、dreamina-seedance-2.0-mini；首次创建要一键授权，生成服务关联角色 TosSubscribeToArkRole，权限是 tos:PutObject；目标桶在当前 region，且源数据与目标桶必须在同一国家，不支持跨境。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/Creating_data_subscription_rules"
 },
 {
  "claim": "§3：文件存进用户 TOS 桶后，不能在 TOS 控制台删除或修改，只能通过 Files API 删除",
  "problem": "写得不全。",
  "correct_fact": "Files API 教程原文：对象被托管后只能读取，不能通过 TOS 控制台或 TOS API 删除、覆盖、修改；生命周期删除、覆盖复制这类异步写/删/改操作也受托管保护限制；只能用 Files API 删除。另外，用 file_id 只能在 Responses API 和 Chat API 里做多模态理解。Upload file API 页对 tos 参数的注释只写了不能在 TOS 控制台删改，以 Files API 教程的完整表述为准。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/file-api"
 },
 {
  "claim": "§6.4：人脸素材否则会报 InputVideoSensitiveContentDetected.PrivacyInformation / InputImageSensitiveContentDetected.PrivacyInformation（400）[S2][S12]",
  "problem": "来源标注过头了。Seedance API 页（S2）只写了 2.5/2.0 不支持直接上传含真人脸的参考图或视频，没有提这两个错误码。错误码页只给了含义（输入可能包含真人），没有说只在 Seedance 下触发。把两者关联起来是推断。",
  "correct_fact": "应标为【推断】：错误码页列出 400 InputImageSensitiveContentDetected.PrivacyInformation 和 400 InputVideoSensitiveContentDetected.PrivacyInformation，含义是输入可能包含真人。Seedance 页只写不支持直接上传真人脸素材，并指向人像素材方案页。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/error-codes"
 },
 {
  "claim": "§6.1：TS 文件建议先转成 MP4（ffmpeg -i input.ts -c copy output.mp4）[S8]，列在 Seedance 视频规格下",
  "problem": "上下文挪错了。这条 FAQ 在 Online inference 小节，是通用说法，video-understanding 页引用过它，不是 Seedance 专属条目。-c copy 只换容器、不转码，所以转出的 MP4 仍要满足 Seedance 的编码要求。",
  "correct_fact": "FAQ（Online inference → Are TS video files supported?）建议把 TS 转成 MP4，可以用 ffmpeg -c copy 直接换容器。用于 Seedance 时，换容器后仍须是 H.264/H.265 视频加 AAC/MP3 音频（mp4），这条约束来自 Seedance API 页。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/modelark-faq"
 },
 {
  "claim": "§7：C2PA 页说明 ModelArk 默认给支持的图像和视频输出嵌入 C2PA",
  "problem": "漏了支持范围。C2PA 页列出的视频模型只有 Dreamina-Seedance-2.0、2.0-mini、2.0-fast，没有 Seedance 2.5。",
  "correct_fact": "C2PA 默认支持的视频生成模型：Dreamina-Seedance-2.0、Dreamina-Seedance-2.0-mini、Dreamina-Seedance-2.0-fast。图像模型：Seedream 4.0/4.5、Dola-Seedream-5.0-pro/lite。截图、转码、压缩或第三方处理可能移除或破坏凭证。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/c2pa-content-credentials-guide"
 }
]

## missing_items
- TOS 默认域名限制（BytePlus 公告 https://docs.byteplus.com/en/docs/tos/2116749）：从 2026-08-01 起，对之后新建的桶，用默认域名做预签名或匿名访问时，TOS 自动在响应头加 Content-Disposition: attachment，任何类型的对象都会直接下载而不是在线预览；.apk/.ipa/.hap 通过默认域名或预签名 URL 访问会被拒，返回 400 ApkDownloadForbidden。TOS FAQ（https://docs.byteplus.com/en/docs/tos/How-to-preview-objects-in-a-browser）也写了默认域名加 attachment，但给的时间分界是 2024-01-03 23:59:59，和公告不一致。今天（2026-10-08）新建的用户桶会受影响。【推断】本机页面预览素材应该用本地 blob URL，不要直接打开预签名 URL。ModelArk 服务端拉取是否受 attachment 影响，文档没写。
- 视频理解场景（内网预签名页示例正是这个场景）的 URL 上限：单个视频通过 URL 传入不超过 50 MB；Base64 也不超过 50 MB，请求体不超过 64 MB（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-understanding）。用内网预签名页的 Chat Completions 示例做自检时，200 MB 的视频会超限。
- video-understanding 页的视频格式表给了 Content Type（video/mp4、video/x-msvideo、video/quicktime），还指向 TOS 文件元数据配置页，说明上传视频到 TOS 时该配元数据。这是视频理解场景，对 Seedance 没有同等表述。被指向的 TOS 页 docs-managing-file-metadata 目前读不出正文。
- TOS 上传事实（https://docs.byteplus.com/en/docs/tos/docs-uploading-a-file、https://docs.byteplus.com/en/docs/tos/reference-putobject）：控制台简单上传最大 5 GiB；API 分片上传最大 48.8 TiB（每片最大 5 GiB，最多 10,000 片）；对象默认私有；IAM 用户默认没有任何权限，上传需要主账号授予 tos:PutObject；PutObject 可带 Content-MD5 做完整性校验；Content-Type、Content-Disposition 是可选请求头；并发写同一 key 时以最后一次为准。
- 预签名细节（https://docs.byteplus.com/en/docs/tos/reference-including-a-signature-in-the-url）：算法只支持 TOS4-HMAC-SHA256；X-Tos-Credential 的格式是 <ak>/<yyyyMMdd>/<region>/tos/request，region 写 ap-southeast-1；载荷用 UNSIGNED-PAYLOAD；CanonicalRequest 包含 host 头；用临时 AK/SK（STS）时必须带 X-Tos-Security-Token；URL 里明文带有 AK ID，任何拿到 URL 的人在有效期内都能执行该操作。
- BytePlus TOS Node.js SDK（https://docs.byteplus.com/en/docs/tos/Install-the-node-js-sdk、Initializing-the-client-side-node-js-sdk、Normal-pre-signature-node-js-sdk）：包名是 @volcengine/tos-sdk（BytePlus 文档原文如此），要求 Node.js 10 及以上；初始化要提供 accessKeyId、accessKeySecret、region、endpoint；requestTimeout 默认 120000 ms，connectionTimeout 默认 10000 ms；可设 maxRetryCount 和 enableCRC；预签名用 client.getPreSignedUrl({method, bucket, key})。Node 和 Python SDK 页都没写 expires 的默认值，Python 示例显式传 expires=3600。
- Seedance 2.5 新增的 mov 输出格式用的是 H.264、yuv444p 加 PCM 音频（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5）。2.5 教程的 mov 输入行含 PCM，API 页的 mov 输入行不含 PCM。把 2.5 的 mov 原始输出作为可信素材再输入时会碰到这处矛盾，而可信输出又要求不能转码。
- 官方示例里，ModelArk 生成结果的 video_url 域名是 ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial）。也就是说，BytePlus 官方文档本身就在 Johor 输出里用了 volces.com 域名，但 TOS Region and Endpoint 表没有列出它。
- 真人脸素材的另外两条官方路径（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-portrait-asset-guide、https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-real-person-portrait-assets）：一是预置数字人；二是经过真人核验和授权的真人素材入库（账号需完成实名或企业认证），之后用 asset://<asset_id> 传入。入库素材规格：图片 <30 MB，视频 mp4/mov 且 ≤200 MB，音频 wav/mp3 且 ≤15 MB。
- Files API 托管存储总容量 20 GB（每个账号免费）；expire_at 的取值范围是 [当前时间+86400, 当前时间+2592000]，默认当前时间+604800（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-api）。
- 2.5 教程里“确保 URL 公网可访问，推荐存 BytePlus TOS 并配置公共读”这句，后面的 For details 链接指向 Data subscription，而不是公共读配置页，属于文档链接错位。
- video-generation-tutorial 写 heic/heif 由 Seedance 1.5 Pro 和 Seedance 2.0 series 支持，API 页写的是 Seedance 1.5 pro 及以后的模型，两处表述不一致。

## gaps
- Seedance 视频生成接口是否接受 TOS 内网预签名 URL（ibytepluses.com）：没有任何 ModelArk 文档明确说明。内网预签名页只演示了 Chat Completions 视频理解；Seedance 文档只要求公网 URL，并推荐 TOS 公共读。
- Seedance 下载输入素材的时机（提交时还是执行时）、下载超时时间、可重试次数：文档未给出。FAQ 里 5 秒下载超时和 403 的说明只针对视觉理解的图片。
- 视频或音频素材的 Content-Type 是否参与校验：文档未说明。只有视觉理解图片的 FAQ 写了部分格式按 Content-Type 校验。
- ModelArk 侧对预签名 URL 有效期没有推荐值，只说可用 expires 设置。
- 使用预签名 URL（公网或内网）时，是否需要先在 ModelArk 控制台“项目授权 → TOS”中授权：内网预签名页没提。授权文档只说授权后可用于 Files API 的 tos 参数；OperationDenied.ArkAccessRoleNotFound / TosAccessDenied 在哪些接口路径下触发，没有逐一说明。
- 内网预签名页 Step 1 没有给出真正的 TOS 预签名代码，变量示例还混用了 volces.com 域名。General presigned (Python SDK) 页面只读到了 PUT/GET/DELETE 示例结构，没看到 expires 的默认值说明。
- Data subscription（TOS 数据订阅，自动把 ModelArk 输出转存到用户桶）页面：ai.byteplus.com/.../docs/tos/Data_subscription 和 docs.byteplus.com/en/docs/tos/Data_subscription 都读不到正文。
- FAQ 中“TOS 设置对象元数据”链接 https://www.byteplus.com/docs/6349/145523 返回 404；TOS 上传时 Content-Type 的默认推断规则未查到（属于 TOS 侧问题，未深挖）。
- 可信输出转存 TOS 后，用预签名 URL（含 query 签名）而不是公共读 URL 传入，信任校验是否仍然生效：文档没说，示例只用了公网可读 URL。人脸信任校验依赖什么机制（是否与 C2PA 有关）也没说。
- Seedance 2.5 与 API 页对 mov 音频编码是否包含 PCM 说法不一致，需以实测或官方澄清为准。
- TOS 内网 endpoint（ibytepluses.com）是否只在同 region 的 BytePlus 内网可解析或可达、内网流量怎么计费：Region and Endpoint 页只列了域名，没有说明。