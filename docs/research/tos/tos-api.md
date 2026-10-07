# BytePlus TOS 上传与预签名 URL 技术合约（供 Node/Hono 代理实现）：核查修订版

**标注说明**
- 【已核实】：本次逐条读过 BytePlus 官方原文，内容一致。
- 【SDK 源码，非文档】：只在 BytePlus 文档链接的官方 SDK 仓库 github.com/volcengine/ve-tos-js-sdk 读到。
- 【推断】：设计判断，没有原文直接支持。
- 【未核实】：文档里找不到。

核查日期：2026-10-08。全部为只读 GET，没有发任何带凭证的请求。

---

## 0. 结论速览（修订后）

1. **上传 endpoint**【已核实】
   - 外网域名：`tos-ap-southeast-1.bytepluses.com`。
   - 只支持 virtual-hosted：`https://<bucket>.tos-ap-southeast-1.bytepluses.com/<key>`。用 PathStyle 会报 `InvalidPathAccess`。
   - 本机在公网，所以用外网域名，这一点属【推断】。
2. **给 ModelArk 的 URL**
   - ModelArk 最佳实践【已核实】：私有桶，与 ModelArk 同 region，用**内网 endpoint** `tos-ap-southeast-1.ibytepluses.com` 生成 **GET 预签名 URL**。
   - 但这篇文档的示例只演示了 chat.completions 视频理解。
   - Seedance 视频生成 API 只写了 "public URL of the video"。Seedance 是否接受内网预签名 URL【未核实】。
   - 建议同时准备外网预签名 URL 作为备选【推断】。
3. **SDK**
   - 官方 Node SDK 是 `@volcengine/tos-sdk`，BytePlus 文档用的就是它【已核实】。
   - 必须显式传 `endpoint`。不传时源码拼成 `tos-${region}.volces.com`（火山域名）【SDK 源码，非文档】。
4. **大小**【已核实】
   - 非分片上传最大 5 GiB。
   - Seedance 参考视频每个不超过 200 MB，单次 PutObject 足够。
5. **预签名有效期**
   - 协议层 `X-Tos-Expires` 取 1–604800 秒（最长 7 天），必填【已核实】。
   - SDK 默认 1800 秒【SDK 源码，非文档】。
   - Seedance 任务默认可以排队或执行 48 小时（`execution_expires_after` 默认 172800 秒），有效期要覆盖这段时间【推断】。
6. **临时素材自动删除**【已核实】
   - 对象级：上传时加 `x-tos-object-expires: <天数>`，或事后调 `SetObjectExpires`。
   - 桶级：`PutBucketLifecycle` 按前缀设 `Expiration.Days`。
7. **最小权限**【已核实】
   - 专用 IAM 用户。IAM 用户默认没有任何权限。
   - 策略只给 `tos:PutObject` + `tos:GetObject`，资源写 `trn:tos:::<bucket>/*`。

---

## 1. Endpoint 与桶域名

**ap-southeast-1（Asia Pacific (Johor)）**【已核实】（[Region and Endpoint](https://docs.byteplus.com/en/docs/tos/docs-region-and-endpoint)）

| 类型 | 外网（Extranet） | 内网（Intranet） |
|---|---|---|
| 标准 Endpoint | `tos-ap-southeast-1.bytepluses.com` | `tos-ap-southeast-1.ibytepluses.com` |
| S3 Endpoint | `tos-s3-ap-southeast-1.bytepluses.com` | `tos-s3-ap-southeast-1.ibytepluses.com` |

**桶域名格式与访问方式**【已核实】
- 只支持 VirtualHostStyle，不支持 PathStyle。
  - S3 兼容文档原文："TOS supports requests in virtual host style (VirtualHostStyle) but not in path style (PathStyle)"。
  - AWS S3 SDK 指南："only support virtual-hosted style"。
  - FAQ：PathStyle 请求会报 `InvalidPathAccess` 或 Forbidden path。
  - 来源：[S3 兼容](https://docs.byteplus.com/en/docs/tos/docs-compatibility-with-amazon-s3)、[AWS S3 SDK](https://docs.byteplus.com/en/docs/tos/Accessing_TOS_Using_AWS_S3_SDK)、[PathStyle FAQ](https://docs.byteplus.com/en/docs/tos/Error-invalidpathaccess-occurs-when-accessing-tos-using-PathStyle)
- PutObject 示例的 Host 是 `destbucketname.tos-ap-southeast-1.bytepluses.com`（[PutObject](https://docs.byteplus.com/en/docs/tos/reference-putobject)）。
- TOS 按 region 区分 endpoint，没有全局 endpoint；内网和外网是不同域名。
  - 文档错误：该段把 Johor 的这两个域名写成了 "TOS North China 2 (Beijing)"。
- 命名规则（[Common Concepts](https://docs.byteplus.com/en/docs/tos/docs-common-concepts)）：
  - 桶名：只能用小写字母、数字和 `-`，首尾必须是字母或数字，长度 3–63。
  - 对象名：UTF-8，1–1,024 字节，不能以 `\` 开头，不能包含 `\a \b \t \n \v \f \r`。

**默认域名限制（两份文档冲突）**
- 公告（[Notice 2116749](https://docs.byteplus.com/en/docs/tos/2116749)）【已核实】：
  - 2026-08-01 及以后新建的桶，通过默认域名做预签名或匿名访问时，响应会自动带 `Content-Disposition: attachment`。
  - `.apk/.ipa/.hap` 会返回 HTTP 400 `ApkDownloadForbidden`。
  - 想预览就要绑定自定义域名。公告说之前建的桶不受影响。
- FAQ（[How to preview objects in a browser](https://docs.byteplus.com/en/docs/tos/How-to-preview-objects-in-a-browser)）【已核实】：2024-01-03 23:59:59 之后创建的桶，经默认域名访问任何类型文件都会被加 attachment。**与公告冲突。**
- 今天（2026-10-08）新建的桶两份文档都覆盖到。这条规则是否影响内网域名、是否影响 ModelArk 服务端拉取【未核实】。
- 前端预览本地视频直接用 `blob:` URL【推断】。

**带宽 / QPS（每账号每 region）**【已核实】（[Restrictions](https://docs.byteplus.com/en/docs/tos/docs-restrictions)）
- Johor 带宽：外网上传和外网下载各 5Gbps；内外网合计的上传和下载各 10Gbps。
- QPS：GET 和 PUT 默认各 10,000，ListObjects 1,000。
- 超限会限流：响应带 `x-tos-qos-delay-time`，或者直接返回 429。
- 每账号最多 100 个桶。桶建好后不能改名，也不能改 region。

---

## 2. 鉴权

### 2.1 TOS 原生签名【已核实】

来源：[Signature Mechanism](https://docs.byteplus.com/en/docs/tos/reference-signature-mechanism_1)

**Authorization 头格式**
- `Authorization: TOS4-HMAC-SHA256 Credential={AccessKeyId}/{CredentialScope}, SignedHeaders={SignedHeaders}, Signature={Signature}`
- 算法只支持 HMAC-SHA256。

**CredentialScope**
- 格式：`yyyyMMdd/region/tos/request`，service 名为 `tos`。
- RequestDate 格式：`yyyyMMddTHHmmssZ`（UTC）。

**CanonicalRequest**
- 组成：`HTTPMethod\nCanonicalURI\nCanonicalQueryString\nCanonicalHeaders\nSignedHeaders\nHashedPayload`。
- CanonicalQueryString：查询参数按 ASCII 排序，必须包含全部参数。
- CanonicalHeaders 的要求：
  - 不必包含所有请求头。
  - 必须包含 `host`。
  - 请求里有 `Content-Type` 时必须签入。
  - 所有 `x-tos-*` 头都必须签入。
  - 使用临时 AK/SK 时，必须带上并签入 `x-tos-security-token`。
- 示例签的头是 `host;x-tos-content-sha256;x-tos-date`。
- HashedPayload：无 body 时是空串的 SHA-256；预签名场景用 `UNSIGNED-PAYLOAD`。

**SigningKey 推导**
- `HMAC(HMAC(HMAC(HMAC(SK, Date), Region), "tos"), "request")`

**UriEncode 规则**
- 除 `A–Z a–z 0–9 - . _ ~` 以外都要编码。
- 空格编码成 `%20`，十六进制用大写。
- `/` 只有在对象名里才不编码。

**示例自身不一致**
- Header 签名示例的 scope 写成 `20220101/tos-ap-southeast-1/tos/request`，Authorization 头里的日期又是 `20220322`。
- 应按参数定义填 Region ID `ap-southeast-1`。

**STS 文档里那句 "basically the same as AWS V4" 的适用范围**
- 原文是 "The signature algorithm for BytePlus API requests is basically the same as AWS V4 (with some Header differences)"。
- 这说的是 STS AssumeRole 这类 BytePlus OpenAPI 请求，不是 TOS 对象请求（[STS](https://docs.byteplus.com/en/docs/tos/Accessing-tos-with-temporary-credentials-of-security-token-service)）。

### 2.2 S3 兼容 / AWS SDK【已核实】

来源：[S3 兼容](https://docs.byteplus.com/en/docs/tos/docs-compatibility-with-amazon-s3)、[AWS S3 SDK](https://docs.byteplus.com/en/docs/tos/Accessing_TOS_Using_AWS_S3_SDK)

- 原文："TOS supports S3 Signature Version 4, but does not support Version 2"。
- 走 S3 协议时必须用 S3 专用 endpoint（`tos-s3-…`），AK/SK 用 IAM 的 AK/SK。
- 兼容的 API 包括 PutObject、GetObject、PostObject、CreateMultipartUpload、UploadPart、CompleteMultipartUpload、AbortMultipartUpload、ListParts 等。
- Node.js 示例：
  - 安装步骤只有 `npm install @aws-sdk/client-s3`。
  - 初始化配置 `endpoint`、`region`、`credentials`、`forcePathStyle: false`。
  - 代码 require 了 `@aws-sdk/s3-request-presigner` 的 `getSignedUrl`，但没有调用，安装步骤里也没装这个包。
- 示例 endpoint 全是 `https://tos-s3-cn-beijing.volces.com`（火山域名）。BytePlus Johor 应该用 `tos-s3-ap-southeast-1.bytepluses.com`【推断，依据 region 表】。
- S3 方式的预签名（X-Amz-*）在 TOS 上能不能用、最长有效期是多少【未核实】。
- 【SDK 源码，非文档】`@volcengine/tos-sdk` 只拒绝 4 个 **volces.com** 的 S3 域名，报错 "do not support s3 endpoint, please use tos endpoint"。`tos-s3-ap-southeast-1.bytepluses.com` 不会被拦，误配要靠自己的代码校验。

### 2.3 官方 Node.js SDK

**包与安装**【已核实】（[Install](https://docs.byteplus.com/en/docs/tos/Install-the-node-js-sdk)）
- `npm i @volcengine/tos-sdk`，源码在 github.com/volcengine/ve-tos-js-sdk，要求 Node.js ≥ 10。
- 没有单独的 BytePlus 包。
- 示例注释写明：SDK 版本 < 2.5.2 时，要把 `TosClient` 改成 `TOS`。

**初始化参数**【已核实】（[Initializing](https://docs.byteplus.com/en/docs/tos/Initializing-the-client-side-node-js-sdk)）
- 必填：`accessKeyId`、`accessKeySecret`、`region`。
- `endpoint`：可选，留空时由 region 决定。示例值 `tos-ap-southeast-1.bytepluses.com`。
- 可选参数与默认值：

| 参数 | 默认值 |
|---|---|
| `stsToken` | null |
| `requestTimeout` | 120000 ms |
| `connectionTimeout` | 10000 ms |
| `maxRetryCount` | 3 |
| `idleConnectionTime` | 60000 ms |
| `maxConnections` | 1024 |
| `enableCRC` | false |
| `autoRecognizeContentType` | true |
| `isCustomDomain` | false（为 false 时拼成 `${bucket}.${endpoint}`） |
| `proxyHost` / `proxyPort` | — |
| `enableVerifySSL` | 文档写 False；SDK 源码默认 true，两者冲突 |

- 文档错误：有一个示例 import 的是 `TosClient`，却写成 `new TOS(...)`。
- 【SDK 源码，非文档】`getEndpoint(region)` 返回 `tos-${region}.volces.com`，所以 BytePlus 必须显式传 `endpoint`。`secure` 默认 true（https）。

**上传**【已核实】（[Overview](https://docs.byteplus.com/en/docs/tos/Upload-object-overview-node-js-sdk)、[Standard](https://docs.byteplus.com/en/docs/tos/Normal-upload-node-js-sdk)、[Multipart](https://docs.byteplus.com/en/docs/tos/Shard-upload-node-js-sdk)、[Resumable](https://docs.byteplus.com/en/docs/tos/Breakpoint-resumption-node-js-sdk)）
- 普通上传：`putObject({ bucket, key, body })`。
  - `body` 可以是 string、Buffer、网络流或 `fs.createReadStream`。
  - 示例还用到 `storageClass`、`acl`、`meta`。
- 直接传本地文件：`putObjectFromFile({ bucket, key, filePath })`。
- 进度回调：`dataTransferStatusChange`；客户端限速：`rateLimiter: createDefaultRateLimiter(...)`。
- 需要 `tos:PutObject` 权限。文档建议对象名不要按字典序递增。
- 分片上传：`createMultipartUpload` → `uploadPart` → `completeMultipartUpload`，取消用 `abortMultipartUpload`（需要 `tos:AbortMultipartUpload`），列已传分片用 `listParts`。
- 断点续传：`uploadFile({ bucket, key, file, partSize, taskNum })`，会写 Checkpoint 文件，需要写权限。
- 【SDK 源码，非文档】
  - `PutObjectInput` 有 `contentLength`、`contentType`、`forbidOverwrite`，以及任意键的 `headers`（可以透传 `x-tos-object-expires`）。
  - body 大小拿不到时只会告警，进度回调也不触发。
  - PutObject API 要求 `Content-Length` 必填，所以代理转发流时应显式传 `contentLength`【推断】。

**预签名**【已核实】（[Node 预签名](https://docs.byteplus.com/en/docs/tos/Normal-pre-signature-node-js-sdk)、[POST 表单](https://docs.byteplus.com/en/docs/tos/Post-form-presignature-node-js-sdk)）
- `client.getPreSignedUrl({ method: 'GET'|'PUT'|'DELETE', bucket, key })`，同步返回 URL，示例用 axios 访问。
- POST 表单：`client.preSignedPostSignature({ bucket, key, expiresIn: 3600 })`。
- Node、Browser.js 的预签名文档和预签名总览页都**没有参数表**。
- 【SDK 源码，非文档】`GetPreSignedUrlInput` 的字段：
  - `bucket`、`key`
  - `method`：默认 'GET'，类型只声明了 'GET'|'PUT'
  - `expires`：单位秒，默认 1800
  - `alternativeEndpoint`：传了以后直接当 Host，不再拼 bucket
  - `response.{contentType, contentDisposition}`
  - `versionId`、`query`、`isCustomDomain`
- 【SDK 源码，非文档】URL 生成方式：
  - 在本地计算，不发网络请求。
  - URL 路径把 key 按 `/` 分段做 `encodeURIComponent`。
  - **预签名的 credential scope 里 region 取的是 `this.opts.endpoint`**，即 endpoint 字符串；普通 header 签名用的是 `this.opts.region`。
  - 服务端对此怎么校验【未核实】。手写签名时按文档填 Region ID。

---

## 3. 预签名 URL 合约

来源：[Including a signature in the URL](https://docs.byteplus.com/en/docs/tos/reference-including-a-signature-in-the-url)

**格式**【已核实】
- `https://bucket.tos-ap-southeast-1.bytepluses.com/object?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=<AK>/<YYYYMMDD>/<region>/tos/request&X-Tos-Date=…&X-Tos-Expires=86400&X-Tos-SignedHeaders=host&X-Tos-Signature=…[&X-Tos-Security-Token=…]`

**有效期**【已核实】
- `X-Tos-Expires` 是 1 到 604,800 之间的整数，单位秒，最长 7 天；必填，协议层没有默认值。
- SDK 默认 1800 秒【SDK 源码】。
- tosutil 文档写明：用临时密钥生成的预签名 URL，有效期不超过临时密钥本身的过期时间（[tosutil presign](https://docs.byteplus.com/en/docs/tos/Generate-pre-signed-url-presign)）。

**签名差异**【已核实】
- 用 `UNSIGNED-PAYLOAD`。
- `X-Tos-Signature` 不参与 CanonicalQueryString。
- 使用 STS 时必须包含 `X-Tos-Security-Token`。
- `X-Tos-SignedHeaders` 必须包含 host 和所有 `x-tos-*`。
- 示例内部不一致：参数表 Region 写 `tos-ap-southeast-1`，计算过程用 `ap-southeast-1`。

**编码**
- 示例里 `X-Tos-Credential` 中的 `/` 编码为 `%2F`【已核实】。
- ModelArk FAQ 要求排查 URL 是否 "truncated, repeatedly encoded, or lost query parameters"【已核实】。
- 代理拿到 URL 后原样放进 JSON，不要再 encode【推断】。

**能否用于 GET**
- 可以。Node SDK 文档有 GET、PUT、DELETE 三个示例【已核实】。

**桶私有还是公开**
- PutObject 原文："All objects are private by default"【已核实】。
- ModelArk 最佳实践要求私有桶加 GET 预签名【已核实】。
- Seedance 2.0 教程原文："Make sure the URL is publicly accessible. We recommend storing the file in BytePlus TOS and configuring public read access"（[Seedance 2.0](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-0)）【已核实】。两者冲突。
- 视频生成 API 对 video_url.url 只写 "public URL"（[API](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api)）。
- 预签名 URL 在有效期内任何拿到它的人都能访问（原文 "Anyone who uses the URL can perform the indicated operation within the validity period"），所以不需要把桶设成公开读【推断】。

**按前缀批量授权**【已核实】（[X-Tos-Policy](https://docs.byteplus.com/en/docs/tos/reference-presigned-url-with-the-x-tos-policy-query-parameter)）
- 用 `X-Tos-Policy` 查询参数，最长同样 7 天。
- 只适用于 ListObjects、ListObjectVersions、HeadObject、GetObject。

**ModelArk 内网 URL 的写法**【已核实】（[内网预签名最佳实践](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-via-tos-internal-presigned-url)）
- 原文："The URL must use the internal TOS endpoint that matches the region where you access ModelArk"。示例 `https://<YOUR_PRIVATE_BUCKET>.tos-ap-southeast-1.ibytepluses.com/path/to/object?...signature...`。
- 要求 "The TOS bucket and the ModelArk service must be in the same region"。
- 示例都是 `chat.completions`（seed-2-0-lite-260228）视频理解，**不是 Seedance 视频生成**。
- 文档错误：第一段代码误写了 `tos-ap-southeast-1.volces.com`。

**签内网 URL 的实现建议**【推断】
- 签名会把 host 算进去，所以要针对内网 host 签名。
- 推荐单独建一个 `endpoint: 'tos-ap-southeast-1.ibytepluses.com'` 的 TosClient，只用来调 `getPreSignedUrl`。
- 不推荐用 `alternativeEndpoint`。源码里那样会出现 host 是内网、scope 是外网 endpoint 字符串的不一致。

---

## 4. 大小限制与分片【已核实】

来源：[Restrictions](https://docs.byteplus.com/en/docs/tos/docs-restrictions)、[Node Overview](https://docs.byteplus.com/en/docs/tos/Upload-object-overview-node-js-sdk)、[UploadPart](https://docs.byteplus.com/en/docs/tos/reference-uploadpart)、[PostObject](https://docs.byteplus.com/en/docs/tos/reference-postobject)

**上限**
- 不分片上传最大 5 GiB。
- 分片上传：对象最大 48.8 TiB，最多 10,000 片，单片最大 5 GiB。
- PostObject 最大 5 GiB。表单字段加 boundary（不含 file）不超过 20 KiB。`file` 必须是最后一个字段。不带 policy 的 POST 视为匿名请求，只对公开可写的桶有效。

**最小分片：文档不一致**
- UploadPart API："at least 5 MB"，`partNumber` 取 [1,10000]。
- Node SDK 分片文档："minimum size of 4MiB"。

**PutObject 请求头**
- `Content-Length` 必填。
- 可选：`Content-Type`、`Content-MD5`、`x-tos-acl`（含 `default`）、`x-tos-forbid-overwrite`、`x-tos-object-expires`、`x-tos-meta-*`、`x-tos-traffic-limit`（245760–838860800 bit/s）、`if-match` / `if-none-match` 等。

**和 ModelArk 的对应关系**（[视频生成 API](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api)）
- 视频：mp4/mov（H.264/H.265），每个不超过 200 MB，FPS 范围 [24,60]。
  - url 只能填公网 URL 或 `asset://<ASSET_ID>`，**不支持 Base64**。
  - `role` 固定为 `reference_video`，仅 Seedance 2.5 和 2.0 系列支持。
- 音频：每个不超过 15 MB，支持 Base64。
- 图片：每张小于 30 MB，支持 Base64。
- 请求体不超过 64 MB。
- 结论：视频单次 PutObject 足够【推断】。

---

## 5. 浏览器直传与 CORS，对比 Node 代理中转

**CORS 配置**【已核实】（[PutBucketCORS](https://docs.byteplus.com/en/docs/tos/reference-putbucketcors)、[CORS 控制台](https://docs.byteplus.com/en/docs/tos/docs-cross-origin-resource-sharing-settings)、[Node CORS](https://docs.byteplus.com/en/docs/tos/Manage-cross-origin-resource-sharing-node-js-sdk)）
- API：`PUT /?cors`，body 为 `{"CORSRules":[{"AllowedOrigins":[...],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["*"],"ExposeHeaders":["x-tos-request-id"],"MaxAgeSeconds":1024,"ResponseVary":true}]}`。
- 字段规则：

| 字段 | 规则 |
|---|---|
| `AllowedOrigins` | 必须带 `http://` 或 `https://`，可以带端口，每行最多一个 `*` |
| `AllowedMethods` | 可选 PUT / GET / POST / DELETE / HEAD |
| `AllowedHeaders` | 默认建议 `*` |
| `ExposeHeaders` | 不能用 `*`，建议加 `X-Tos-Request-Id` 和 `ETag` |
| `MaxAgeSeconds` | 默认 3600 |
| `ResponseVary` | 默认 false |

- 所有规则合计不超过 20KiB。
- 控制台的 Origin 和 Allow-Headers 字段**各自最多 1,000 项**（不是 1,000 条规则）。
- 权限：设置和删除需要 `tos:PutBucketCORS`，读取需要 `tos:GetBucketCORS`。SDK 方法为 `putBucketCORS` / `getBucketCORS` / `deleteBucketCORS`。

**官方 Web 直传实践**【已核实】（[Web direct upload](https://docs.byteplus.com/en/docs/tos/Web-direct-upload-practice)）
- 走的是 PostObject，不是预签名 PUT。
- CORS 建议：Origin 填前端域名（可以用 `*`）；方法勾选 PUT/GET/POST/DELETE/HEAD；Allow-Headers 填 `*`；Expose-Headers 填 `ETag`、`x-tos-request-id`、`x-tos-version-id`。
- 服务端用 STS 临时凭证调 `preSignedPostSignature`。
- 前端示例 POST 到 `https://${bucket}.${endpoint}/${encodeURI(key)}`。
- 表单字段：`key, policy, x-tos-algorithm, x-tos-credential, x-tos-date, x-tos-signature, x-tos-security-token, file`。
- POST policy 必须有 `expiration` 和 `conditions`，可以用 `["content-length-range", min, max]` 限制大小（[Browser POST](https://docs.byteplus.com/en/docs/tos/reference-browser-based-upload-forms-include-signatures)）。

**预签名 URL 方案的优缺点**【已核实】（[Pre-signed URL 实践](https://docs.byteplus.com/en/docs/tos/Use-temporary-authorization-url-to-enable-secure-data-download)）
- 优点：对象级授权，安全；终端只要能发 HTTP 请求就行。
- 缺点：每次都要服务端签名；"Concurrent uploads are difficult, which is unfavorable for uploading large files"。
- Web 端需要配 CORS。
- 文档错误：该文档的 Go 示例用 Johor endpoint，却配了 region "cn-beijing"。

**两种方案对比**【推断，设计判断】
- 由 Hono 代理中转（浏览器 → localhost → putObject）的好处：
  - 桶不用配 CORS，也不用给 `tos:PutBucketCORS` 权限；
  - AK/SK 不出本机进程；
  - 可以统一加 `x-tos-object-expires`。
- 浏览器直接 PUT 预签名 URL 的前提：桶的 CORS 规则包含 `http://localhost:<port>` 和 PUT 方法。

---

## 6. 临时素材自动过期【已核实】

**方案 A：对象级过期**
- 来源：[PutObject](https://docs.byteplus.com/en/docs/tos/reference-putobject)、[PostObject](https://docs.byteplus.com/en/docs/tos/reference-postobject)、[CreateMultipartUpload](https://docs.byteplus.com/en/docs/tos/reference-createmultipartupload)。
- 用请求头 `x-tos-object-expires: <正整数天数>`。从 Last-Modified 起算，到期当天零点开始删除。
- 文档例子：值为 3、修改时间 2024-09-26 12:00，则 2024-09-30 00:00 过期。
- 对象过期优先于 lifecycle 删除规则。
- 可以用 GetObject / HeadObject 查询过期时间。
- 零点按哪个时区算【未核实】。

**方案 A'：事后设置或修改过期时间**（[SetObjectExpires](https://docs.byteplus.com/en/docs/tos/SetObjectExpires)）
- `POST /<ObjectName>?objectExpires`，body 为 `{"ObjectExpires": N}`；N 为 0 时表示永不过期。
- 对应的 IAM Action 名称和 Node SDK 方法【未核实】。

**方案 B：桶 lifecycle**（[PutBucketLifecycle](https://docs.byteplus.com/en/docs/tos/reference-putbucketlifecycle)、[Node Lifecycle](https://docs.byteplus.com/en/docs/tos/Manage-the-bucket-lifecycle-node-js-sdk)）
- API：`PUT /?lifecycle`，body 示例 `{"Rules":[{"ID":"id","Prefix":"prefix","Status":"Enabled","Expiration":{"Days":120}}]}`。
- 可以加 `"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":N}` 清理没合并的分片（这一项不支持按标签过滤）。
- `Days` 和 `Date` 互斥。
- **覆盖式写入**：要追加规则，先 GetBucketLifecycle 拿到现有规则，合并后再 Put。
- 规则 JSON 不超过 20 KB，最多 1,000 条。
- Node SDK：`putBucketLifecycle({ bucket, rules: [{ ID, Prefix, Status: LifecycleStatusType.Enabled, Expiration: { Days: 30 } }] })`，另有 `getBucketLifecycle` / `deleteBucketLifecycle`。
- 权限：设置和删除用 `tos:PutLifecycleConfiguration`，读取用 `tos:GetLifecycleConfiguration`。API 文档的写法是 "PutBucketLifecycle permission"，写策略以 IAM Action 列表为准。

**生效时机：两份文档说法不同**
- [Restrictions](https://docs.byteplus.com/en/docs/tos/docs-restrictions)：创建后 24 小时内加载，之后每天北京时间 2:00 AM 执行。
- [Lifecycle Overview](https://docs.byteplus.com/en/docs/tos/Lifecycle-rules-overview)：加载后 24 小时内开始执行；文件清单每 24 小时只拉取一次。

**和 Seedance 任务时长的关系**【推断】
- 视频任务的 `execution_expires_after` 默认 172800 秒（48 小时），取值范围 [3600, 259200]。
- 如果 `x-tos-object-expires` 设为 1，对象可能在上传后 24 到 48 小时之间被删。
- 建议对象过期天数和预签名有效期都不短于任务超时时间，或者任务结束后再调 SetObjectExpires。

---

## 7. AK/SK 与最小权限【已核实】

**AK/SK 在哪里获取**（[Access Key & API Key](https://docs.byteplus.com/en/docs/IAM/about-access-keys)、[Creating](https://docs.byteplus.com/en/docs/IAM/creating-an-access-key)、[Managing](https://docs.byteplus.com/en/docs/byteplus-platform/docs-managing-an-accesskey)）
- 入口：右上角头像或用户名 > IAM > Key management / Access key management，地址 https://console.byteplus.com/iam/keymanage/。
- 也可以在 IAM 用户详情页的 Access key 标签页创建。每个用户最多两个 AccessKey；删除前必须先禁用。
- 生产或企业场景不建议用主账号密钥，推荐给专用 IAM 用户建密钥。
- 主账号 AK 默认拥有全部权限；IAM 用户密钥的权限等于该用户的权限。
- **IAM 用户默认没有任何权限**（[CORS 控制台文档](https://docs.byteplus.com/en/docs/tos/docs-cross-origin-resource-sharing-settings)）。

**策略写法**（[Configuring IAM policies](https://docs.byteplus.com/en/docs/tos/docs-configuring-an-iam-policy)、[IAM policy examples](https://docs.byteplus.com/en/docs/tos/docs--common-iam-policies)、[Supported actions](https://docs.byteplus.com/en/docs/tos/docs-overview_6)）
- Action 格式 `tos:<Action>`，大小写不敏感，支持 `*`。
- Resource 格式：`trn:tos:::{Bucket}` 表示桶，`trn:tos:::{Bucket}/{Object}` 表示对象。
- Allow 和 Deny 同时命中时，Deny 优先。
- IAM 授权大约 1 分钟后生效。

**相关 Action**
- `PutObject`：覆盖 PUT 上传、分片上传、分片初始化和合并。
- `GetObject`
- `AbortMultipartUpload`
- `ListMultipartUploadParts`
- `PutLifecycleConfiguration` / `GetLifecycleConfiguration`
- `PutBucketCORS` / `GetBucketCORS`

**最小策略**（STS 文档原样示例，桶名换成你的）：
```json
{"Statement":[{"Effect":"Allow","Action":["tos:PutObject","tos:GetObject"],"Resource":["trn:tos:::tos-sts/*"]}]}
```

**额外权限**【推断】
- 如果由本工具配置 lifecycle 或 CORS，需要再加一条 Statement：对 `trn:tos:::<bucket>` 授予 `tos:PutLifecycleConfiguration`、`tos:GetLifecycleConfiguration`，以及按需的 `tos:PutBucketCORS`。
- 用分片时加 `tos:AbortMultipartUpload`。

**STS（可选）**
- 调 `AssumeRole`（`sts.ap-southeast-1.byteplusapi.com`），可以设 `DurationSeconds`。
- 临时凭证的权限是角色权限与传入策略的交集；角色没有预关联策略时，实际权限为空。
- 文档错误：STS 文档的 Python 示例里写着 `endpoint='https://open.volcengineapi.com'`（火山域名）。

---

## 8. 推荐实现流程【推断，依据上述事实】

1. **配置**
   - Hono 端把用户填的 AK/SK、bucket、region（`ap-southeast-1`）只放在进程内存里，并校验 endpoint 不是 `tos-s3-*`。
   - 上传 client：`new TosClient({ accessKeyId, accessKeySecret, region: 'ap-southeast-1', endpoint: 'tos-ap-southeast-1.bytepluses.com' })`。
   - 签名 client：另建一个，`endpoint: 'tos-ap-southeast-1.ibytepluses.com'`。
2. **上传**
   - 前端把文件流式 POST 给本机代理。
   - 代理调 `putObject({ bucket, key: 'ark-tmp/<uuid>.<ext>', body: stream, contentLength, contentType, headers: { 'x-tos-object-expires': '<天数，覆盖任务超时>' } })`。
   - key 用随机 UUID，符合文档"避免字典序递增命名"的建议。
3. **签名**
   - 调 `internalClient.getPreSignedUrl({ method: 'GET', bucket, key, expires: N })`，N 在 1–604800 之间，建议不短于任务的 `execution_expires_after`。
   - 把 URL 原样填进 `content[].video_url.url`，`role` 设为 `reference_video`。
   - Seedance 是否接受内网 URL 未核实。失败时可以退回外网 endpoint 的预签名 URL，但要注意新桶的 attachment 规则是否影响拉取（未核实）。
4. **兜底删除**
   - 给前缀 `ark-tmp/` 配 lifecycle `Expiration.Days` 加 `AbortIncompleteMultipartUpload`，写入前先 Get 再合并。
5. **排查**
   - 按 ModelArk FAQ 逐项检查：region 是否一致、是否用了内网 endpoint、URL 是否过期、key 是否和签名时一致、URL 是否被截断、重复编码或丢了 query、模型是否支持该输入类型。

---

## 9. 文档自身不一致与风险点

- **签名示例的 region**：
  - Header 签名示例：scope 写 `tos-ap-southeast-1`，Authorization 头日期是 20220322。
  - URL 签名示例：参数表写 `tos-ap-southeast-1`，计算过程用 `ap-southeast-1`。
  - SDK 源码：预签名 scope 用的是 endpoint 字符串。
- **混用火山域名或 region**：
  - ModelArk 内网预签名文档第一段代码；
  - AWS S3 SDK 指南全部示例；
  - SDK 默认 endpoint（`tos-${region}.volces.com`）；
  - STS 文档的 Python 示例 endpoint；
  - 预签名实践 Go 示例里 Johor endpoint 配了 region cn-beijing；
  - S3 兼容文档把 Johor 域名写成 Beijing。
- **最小分片**：4 MiB（Node SDK 文档）对 5 MB（UploadPart API）。
- **lifecycle 执行时机**：Restrictions 和 Lifecycle Overview 说法不同。
- **默认域名强制 attachment 的起始时间**：公告写 2026-08-01，FAQ 写 2024-01-03。
- **`enableVerifySSL` 默认值**：文档写 False，SDK 源码是 true。
- **公开 URL 还是私有桶加内网预签名**：Seedance 2.0 教程建议公开读，视频生成 API 写 public URL，ModelArk 最佳实践（视频理解示例）要求私有桶加内网预签名。

---

## 10. Gaps（未核实 / 文档缺失）

- `getPreSignedUrl` 的参数表：Node、Browser.js 文档和预签名总览页都没有。`expires`（默认 1800）、`alternativeEndpoint` 等只在 SDK 源码里读到。
- SDK 预签名 scope 里 region 填的是 endpoint 字符串，服务端是否校验 region 字段，文档没写。
- S3 方式的预签名（X-Amz-*，`@aws-sdk/s3-request-presigner`）能否用于 TOS 的 S3 endpoint、最长有效期多少，文档没写。
- 预签名 PUT 是否必须签入 Content-Type，不一致时会不会返回 403，文档没写。
- Seedance 视频生成是否接受内网（ibytepluses.com）或外网预签名 URL，文档没写。最佳实践只演示了 chat.completions 视频理解。
- ModelArk 视频任务在什么时间点拉取参考视频，没读到。只知道任务最长可存活 `execution_expires_after`（默认 48 小时，最长 72 小时）。
- 默认域名强制 attachment 是否适用于内网 endpoint、是否影响 ModelArk 服务端拉取，文档没写，两份文档的生效日期也冲突。
- `x-tos-object-expires` 和 `SetObjectExpires` 的"零点"按哪个时区算；SetObjectExpires 需要哪个 IAM Action、Node SDK 有没有对应方法，都没写。
- ModelArk 项目授权（Project authorization）里 Files API 的 `tos` 参数，视频生成 API 文档没提，不能确认可用于 Seedance。
- 没有找到 BytePlus 文档明说"预签名 URL 的权限等于签名 AK 所属身份的权限"，这一点属推断。tosutil 文档只说明临时密钥签出的 URL 有效期不超过密钥本身的有效期。


## corrections
[
 {
  "claim": "第 5 节 CORS：'所有规则合计不超过 20KiB（控制台写法是最多 1,000 条）'",
  "problem": "控制台文档写的上限是单个字段最多填 1,000 项，不是最多 1,000 条规则。原报告把它说成了规则条数。",
  "correct_fact": "PutBucketCORS 规定所有规则合计不超过 20KiB。控制台的 Origin 和 Allow-Headers 两个字段各自最多可填 1,000 项（\"You can type up to 1,000 items\"）。文档没有给出规则条数的上限。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/docs-cross-origin-resource-sharing-settings"
 },
 {
  "claim": "第 5 节官方 Web 直传实践：'前端用 FormData POST 到 https://<bucket>.<endpoint>/'",
  "problem": "示例代码 POST 的目标 URL 带了对象 key 路径，不是桶根路径。",
  "correct_fact": "示例代码是 `const url = \\`https://${bucketHost}/${encodeURI(key)}\\``，其中 bucketHost = `${bucket}.${endpoint}`，然后用 fetch(url, {method:'POST', body: formData}) 提交。PostObject API 本身的请求语法是 POST 到桶根 `/`。两种写法文档都出现过，以示例代码为准时要带上 key 路径。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/Web-direct-upload-practice"
 },
 {
  "claim": "第 9 节：'URL 签名示例写的是 ap-southeast-1'",
  "problem": "说得不完整。URL 签名示例自己内部也不一致。",
  "correct_fact": "URL 签名示例的参数表里 Region 写的是 `tos-ap-southeast-1`，但 CanonicalRequest、StringToSign、SigningKey 和最终 URL 里用的都是 `ap-southeast-1`。Header 签名示例从参数表到计算过程都写 `tos-ap-southeast-1`（Region 行除外，写的是 `ap-southeast-1`）。按参数定义，应填 Region ID `ap-southeast-1`。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/reference-including-a-signature-in-the-url"
 },
 {
  "claim": "第 0、3 节：'ModelArk 官方最佳实践是把对象放在私有桶，用内网 endpoint 生成 GET 预签名 URL，再填进 video_url.url'（直接套到 Seedance 视频生成）",
  "problem": "这份最佳实践的两个代码示例都是 chat.completions 视频理解（model=seed-2-0-lite-260228，messages[].content[].video_url），不是 Seedance 的 content generation 任务。文档通篇没提 Seedance 或视频生成任务，原报告把适用范围说大了。文档里还有一句限定语：\"When the URL uses the internal endpoint supported by your environment\"。",
  "correct_fact": "文档原文是 \"Store files in a private TOS bucket in the same region as the ModelArk service... generate GET presigned URLs with the internal TOS endpoint and use those URLs to pass files to ModelArk\"，并要求 \"The URL must use the internal TOS endpoint that matches the region where you access ModelArk\"。Seedance 视频生成 API 文档对 video_url.url 只写了 \"Enter the public URL of the video\"，没有提 TOS、内网或预签名。所以 Seedance 是否接受内网预签名 URL 属于【未核实/推断】。",
  "source_url": "https://ai.byteplus.com/ark/region:ap-southeast-1/docs/upload-files-via-tos-internal-presigned-url"
 },
 {
  "claim": "第 2.2 节：'【SDK 源码】@volcengine/tos-sdk 会拒绝 S3 endpoint……TOS SDK 要配标准 endpoint，不要配 tos-s3-*'",
  "problem": "源码只是拿 endpoint 和 4 个 volces.com 的 S3 域名做完全匹配，BytePlus 的 `tos-s3-ap-southeast-1.bytepluses.com` 不在名单里，SDK 不会拦。原报告的说法会让人以为 SDK 能兜住这个配置错误。",
  "correct_fact": "S3_REGION_LIST 只有 'tos-s3-cn-beijing.volces.com'、'tos-s3-cn-guangzhou.volces.com'、'tos-s3-cn-shanghai.volces.com'、'tos-s3-ap-southeast-1.volces.com' 四项。BytePlus 的 S3 域名误配进去时 SDK 不会报错，要靠代码自己校验。",
  "source_url": "https://github.com/volcengine/ve-tos-js-sdk/blob/main/src/methods/base.ts"
 },
 {
  "claim": "第 3 节：签内网 URL 可以'传 alternativeEndpoint: \"<bucket>.tos-ap-southeast-1.ibytepluses.com\"（SDK 源码行为）'，和单独建一个内网 client 等价",
  "problem": "两种做法在 SDK 源码里不等价。预签名的签名器用的是 `region: this.opts.endpoint`，也就是 client 自己的 endpoint 字符串，不是 region。用 alternativeEndpoint 时，签名的 host 是内网域名，但 credential scope 里的 region 字段还是外网 endpoint 字符串。",
  "correct_fact": "【SDK 源码，非文档】base.ts 的 getSignatureQuery 构造 SignersV4 时传的是 `region: this.opts.endpoint`；普通 header 签名传的是 `region: this.opts.region`。所以 SDK 生成的预签名 URL，X-Tos-Credential 的 scope 是 `<date>/<endpoint 字符串>/tos/request`，和文档要求的 Region ID 不一致。服务端对 scope 里 region 字段怎么校验，文档没写。为了让 host 和 scope 至少一致，建议单独建一个 `endpoint: 'tos-ap-southeast-1.ibytepluses.com'` 的 client 来签名。",
  "source_url": "https://github.com/volcengine/ve-tos-js-sdk/blob/main/src/methods/base.ts"
 },
 {
  "claim": "第 1 节默认域名限制：'只对 2026-08-01 及以后新建的桶生效……在此之前创建的桶不受影响'",
  "problem": "BytePlus 另一篇 FAQ 的说法不同：2024-01-03 23:59:59 之后创建的桶，用默认域名访问任何类型的文件都会被加上 Content-Disposition: attachment。原报告只引了公告，没有指出文档互相矛盾。另外，今天是 2026-10-08，现在新建的桶一定受公告约束。",
  "correct_fact": "公告（2116749）：2026-08-01 及以后创建的桶，通过默认域名做预签名或匿名访问时，响应自动带 `Content-Disposition: attachment`；访问 .apk/.ipa/.hap 返回 HTTP 400 `ApkDownloadForbidden`。FAQ（How-to-preview-objects-in-a-browser）：2024-01-03 23:59:59 之后创建的桶，任何类型文件经默认域名访问都会带 attachment。两处说法冲突，以哪份为准文档没有说明。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/How-to-preview-objects-in-a-browser"
 },
 {
  "claim": "第 2.3 节初始化参数列表（只列了 stsToken / requestTimeout / connectionTimeout / maxRetryCount / enableCRC / autoRecognizeContentType / isCustomDomain / proxyHost / proxyPort）",
  "problem": "漏了文档参数表里的几项，其中 enableVerifySSL 的文档默认值和 SDK 源码默认值相反。",
  "correct_fact": "文档参数表还有 `idleConnectionTime`（默认 60000 ms）、`maxConnections`（默认 1024）、`enableVerifySSL`（文档写 default False）。SDK 源码里是 `enableVerifySSL: _default(_opts.enableVerifySSL, true)`，即默认 true。文档另有一个示例 import 的是 `TosClient`，却写成 `new TOS({...})`。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/Initializing-the-client-side-node-js-sdk"
 },
 {
  "claim": "第 6 节：'需要的权限：tos:PutLifecycleConfiguration，以及读取用的 tos:GetLifecycleConfiguration'",
  "problem": "结论没错，但 API 文档用的权限名不一样，原报告没指出。另外 Node SDK 文档写明删除 lifecycle 也要 PutLifecycleConfiguration，原报告漏了。",
  "correct_fact": "PutBucketLifecycle API 文档写的是 \"with the PutBucketLifecycle permission\"。IAM 支持的 Action 列表和 Node SDK 文档用的是 `PutLifecycleConfiguration`（设置或删除）和 `GetLifecycleConfiguration`。写 IAM 策略时应以 Action 列表为准。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/docs-overview_6"
 },
 {
  "claim": "第 2.1 节把 STS 文档的 'basically the same as AWS V4 (with some Header differences)' 放在 TOS 签名下",
  "problem": "这句话描述的是调 STS AssumeRole 这类 BytePlus OpenAPI 请求的签名，不是 TOS 对象请求的签名。放在 TOS 签名一节容易让人误以为 TOS 对象请求也是 AWS V4。",
  "correct_fact": "TOS 对象请求的签名算法是 TOS4-HMAC-SHA256，service 名为 `tos`，请求头前缀为 x-tos-*。STS 文档这句话只针对 BytePlus OpenAPI 请求（service='sts'，host sts.ap-southeast-1.byteplusapi.com）。注意该文档的 Python 示例里还写着 `endpoint = 'https://open.volcengineapi.com'`，这是火山域名，属于文档错误。",
  "source_url": "https://docs.byteplus.com/en/docs/tos/Accessing-tos-with-temporary-credentials-of-security-token-service"
 }
]

## missing_items
- ModelArk 视频生成任务参数 `execution_expires_after`：默认 172800 秒（48 小时），取值范围 [3600, 259200]，从 created at 开始计算，超时后任务标为 expired。文档没写 ModelArk 什么时候拉取参考视频。所以预签名有效期和对象过期时间都应覆盖这段时长，否则排队中的任务可能读不到素材。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api
- 原报告第 8 节建议 `x-tos-object-expires: 1`。按文档规则（从 Last-Modified 起算，到期当天零点开始删除），对象可能在上传后 24 到 48 小时之间被删，可能早于任务的 48 小时超时。来源：https://docs.byteplus.com/en/docs/tos/reference-putobject
- SetObjectExpires API：`POST /<ObjectName>?objectExpires`，body 为 `{"ObjectExpires": N}`，N 是正整数天数，0 表示永不过期。可以在上传后再设置或修改对象过期时间，优先级高于 lifecycle。对应的 IAM Action 名称文档没写。来源：https://docs.byteplus.com/en/docs/tos/SetObjectExpires
- SDK 源码：预签名 credential scope 里的 region 取的是 client 的 endpoint 字符串，不是 region ID；header 签名用的是 region。自己手写签名时应按文档填 Region ID。来源：https://github.com/volcengine/ve-tos-js-sdk/blob/main/src/methods/base.ts
- Seedance 视频生成 API：video_url.url 只接受公网 URL 或 `asset://<ASSET_ID>`，视频不支持 Base64（图片和音频支持）。role 固定为 `reference_video`，仅 Dreamina Seedance 2.5 和 2.0 系列支持。FPS 范围 [24,60]。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api
- ModelArk 项目授权（Project authorization）：可在控制台给项目授权访问 TOS 桶，授权后项目的 API Key 可以在 Files API 请求里用 `tos` 参数访问已授权对象。视频生成 API 文档没提 Files API、file_id 或 tos 参数，所以文档没有表明它能用于 Seedance。来源：https://ai.byteplus.com/ark/region:ap-southeast-1/docs/project-configuration
- IAM 用户默认没有任何权限，必须由主账号通过 IAM 策略或 Bucket 策略授权。来源：https://docs.byteplus.com/en/docs/tos/docs-cross-origin-resource-sharing-settings
- STS：如果角色没有预关联策略，即使请求里传了 IAM policy，实际权限也为空。tosutil 文档写明，用临时密钥生成的预签名 URL 最长有效期不超过临时密钥本身的过期时间。来源：https://docs.byteplus.com/en/docs/tos/Accessing-tos-with-temporary-credentials-of-security-token-service ；https://docs.byteplus.com/en/docs/tos/Generate-pre-signed-url-presign
- PathStyle 访问会报 `InvalidPathAccess` 或 Forbidden path，TOS 只支持 VirtualHostStyle。来源：https://docs.byteplus.com/en/docs/tos/Error-invalidpathaccess-occurs-when-accessing-tos-using-PathStyle
- AWS S3 SDK 指南的安装步骤只装 `@aws-sdk/client-s3`，没装 `@aws-sdk/s3-request-presigner`，但示例里 require 了它。来源：https://docs.byteplus.com/en/docs/tos/Accessing_TOS_Using_AWS_S3_SDK
- S3 兼容文档把 Johor 的 endpoint（tos-ap-southeast-1.[i]bytepluses.com）误写成 'TOS North China 2 (Beijing)'；'Using pre-signed URLs for secure data downloads' 的 Go 示例里 Johor endpoint 配的 region 是 'cn-beijing'。两处都是文档错误。
- PutObject API 要求 Content-Length 必填。SDK 拿不到 body 大小时只会告警，进度回调也不触发。代理把浏览器上传的流直接转给 putObject 时，应显式传 `contentLength`【推断】。来源：https://docs.byteplus.com/en/docs/tos/reference-putobject ；https://github.com/volcengine/ve-tos-js-sdk/blob/main/src/methods/object/putObject.ts
- X-Tos-Policy 预签名只能用于 ListObjects / ListObjectVersions / HeadObject / GetObject，是只读的批量授权；CanonicalRequest 只包含 CanonicalQueryString 和 HashedPayload。来源：https://docs.byteplus.com/en/docs/tos/reference-presigned-url-with-the-x-tos-policy-query-parameter
- Restrictions：ListObjects 默认 1,000 QPS（每账号每 region）。每账号最多 100 个桶，桶建好后不能改名也不能改 region。来源：https://docs.byteplus.com/en/docs/tos/docs-restrictions
- Lifecycle Overview：执行前会拉取文件清单（含前缀和标签），每 24 小时只拉一次；24 小时内最多完成 5,000 万或 1 亿次生命周期操作（取决于是否开启版本控制），超出可能延后。来源：https://docs.byteplus.com/en/docs/tos/Lifecycle-rules-overview

## gaps
- BytePlus 的 Node.js SDK 文档没有列 getPreSignedUrl 的参数表（expires 参数名、默认值、能否指定内网 host）。参数名 expires、默认 1800 秒、alternativeEndpoint 只在官方 SDK 源码里读到，文档未确认。
- Node SDK 初始化文档说 endpoint 留空时由 region 决定，但没说默认拼成什么域名。SDK 源码显示默认是 tos-${region}.volces.com（火山域名），BytePlus 文档没有对此提醒。
- 文档没有说明 S3 方式预签名（X-Amz-* 查询参数，@aws-sdk/s3-request-presigner 的 getSignedUrl）能否用于 TOS 的 S3 endpoint，也没有给最长有效期。只写了支持 SigV4、不支持 V2，Node 示例 import 了 getSignedUrl 但没有调用。
- 文档没有说明预签名 PUT 是否要求签入 Content-Type；浏览器 PUT 带的 Content-Type 和签名不一致时会不会 403，也未说明。Header 签名要求请求带 Content-Type 时必须签入，但预签名示例只签了 host。
- ModelArk 是否也接受外网（tos-ap-southeast-1.bytepluses.com）预签名 URL，没有明确写。视频任务 API 写的是'public URL'，内网最佳实践写的是'must use the internal TOS endpoint'，Seedance 2.0 教程又建议公开读。
- ModelArk 视频生成任务在什么时间点拉取参考视频（创建任务时还是排队后执行时）没读到，因此无法从文档确定预签名有效期最少要设多长。
- 2026-08-01 起默认域名强制 Content-Disposition: attachment 的规则，是否也适用于内网 endpoint（ibytepluses.com），是否影响 ModelArk 服务端拉取，公告都没有说明。
- x-tos-object-expires 的到期'midnight'按哪个时区算没有写明；Node SDK 文档也没说明如何设置这个头（源码里 headers 可以透传任意键，属推断）。
- 最小分片大小文档不一致：UploadPart API 写至少 5 MB，Node SDK 分片文档写最小 4MiB。
- lifecycle 执行时机文档不一致：Restrictions 写加载后每天北京时间 2:00 AM 执行，Lifecycle Overview 写加载后 24 小时内开始执行。
- 签名机制示例本身不一致：CredentialScope 里的 region 写成 tos-ap-southeast-1，Authorization 示例日期是 20220322；URL 签名示例用的是 ap-southeast-1。
- 没有找到 BytePlus 文档明确说'预签名 URL 的权限等于签名 AK 所属身份的权限'，这一点属推断。
- 没有读 BytePlus 的 Browser.js SDK 预签名 POST 页面（Post-form-pre-signature-browser-js-sdk）和 Node CORS 管理页（Manage-cross-origin-resource-sharing-node-js-sdk）的完整参数，只确认了页面存在。
- 没有读 ModelArk 的 'Project authorization'（project-configuration）文档，它讲的是给 ModelArk 项目授权访问 TOS 桶，可能和预签名方案无关，但没有核实。