# 公共临时文件托管调研（核查修正版）：gofile.io、file.io、litterbox、x0.at、temp.sh

核查日期：2026-10-08（服务器时间为 2026-10-07 16:0x GMT）。全程只读：没有上传，没有提交任何表单。证据来自官方页面、官方 JS、官方 GitHub 源码，以及用 curl GET/HEAD 访问首页或不存在的路径。

## 结论速览（修正后）

| 站点 | 评级 | 理由 |
|---|---|---|
| litterbox.catbox.moe | **勉强**（原报告为「适合」） | 技术上最合适：匿名，单文件 1GB，保留 1h/12h/24h/72h 可选，没有 Cloudflare，官方 ShareX 配置写明返回纯文本。但条款把「在会产生收入的组织或项目中使用」都算作商业使用，需要书面许可；FAQ 也点名禁止把视频外链给其他站点当源。只适合纯个人、非营利用途。不能删除。 |
| x0.at | 勉强 | 匿名，单文件 1024MiB，按大小算保留 3–100 天（200MiB 约 66 天），不能自选时长，不能删除。没有 ToS。线上已部署 PoW 验证（还没接到上传流程）。源码默认上传超时 300 秒。 |
| temp.sh | 勉强（必须实测） | 匿名，4GB，固定 3 天。返回格式、直链行为、ToS 都没有写。首页链接的 up.sh 和 sxcu 文件都 404。 |
| gofile.io | 免费版不适合；Premium 勉强 | 免费/访客只能拿到 /d/ 的 HTML 落地页。直链和读取内容的 API 都只限 Premium。另有 10 天不活跃删除和冷存储。 |
| file.io | 不适合 | 免费版下载 1 次即删。根域和 /{key} 都 301 到 S3 静态站，下载页是 410 HTML。网页上传已改走 LimeWire，LimeWire 条款反自动化。 |

---

## 1. gofile.io

来源：https://gofile.io/js/pages/api.js 、https://gofile.io/js/pages/faq.js 、https://gofile.io/js/pages/terms.js 、https://gofile.io/js/checkout/checkout.js 、https://gofile.io/js/uploads/uploadRegions.js

**1) 上传 API**
- 端点：`POST https://upload.gofile.io/uploadfile`，multipart。
- 字段：`file`（必填）、`folderId`（可选）、`token`（可选，也可以用 `Authorization: Bearer` 传）。
- 不带 token 时会当场创建访客账号，返回 `guestToken`（api.js）。
- 区域端点：upload-eu-par / na-phx / na-nyc / ap-sgp / ap-hkg / ap-tyo / ap-syd / sa-sao.gofile.io（uploadRegions.js）。
- 返回值包含 `id`、`parentFolder`、`parentFolderCode`、`downloadPage:"https://gofile.io/d/xxxx"`、`code`、`size`、`md5`、`mimetype`、`servers`。**没有直链字段。**
- 直链要单独调用 `POST https://api.gofile.io/contents/{contentId}/directlinks`：
  - 标为 premium:true，原文 "A Premium feature"。
  - 可设 `expireTime`（Unix 时间戳）、`sourceIpsAllowed`（仅 IPv4）、`domainsAllowed`/`domainsBlocked`、`auth`。
  - 返回 `directLink: https://store.gofile.io/download/direct/{id}/{name}`。
- `GET /contents/{id}` 也是 premium:true，非 Premium 返回 `error-notPremium`。这个接口返回的 `link` 字段形如 `https://store-1.gofile.io/download/web/...`，所以免费用户连网页下载链接都拿不到。
- 官方提示 "Create one account and reuse its token — do not mint an account per upload"。
- 条款：API 处于 BETA，"Most API endpoints require a Premium account"（terms.js）。

**2) 大小、保留、删除**
- 单文件上限：官方没写（缺口）。
- 免费账号最多 10,000 个内容，超出报 `error-limits`。
- 免费流量 100 GB / 30 天（checkout.js `PRICING.free`），FAQ 说可能按 IP 计。
- 保留时长：
  - FAQ："Content is kept for 10 days of inactivity"。
  - 过期内容可能进入 cold storage，要用 Premium 导入回账户后才能下载。
  - 条款："does not guarantee any specific retention duration … may delete inactive content at any time without notice"。
- 删除：`DELETE https://api.gofile.io/contents`（JSON `contentsId`），访客账号也可以用。

**3) 直链特性**
- gofile.io：200，nginx，text/html，没有 Cloudflare。首页加载 `/js/wt.obf.js` 和 `/js/app.js`（SPA）。
- store1.gofile.io：
  - ID 不是 UUID 格式时返回 400 text/plain「Invalid UUID」。
  - ID 是 UUID 格式但不存在时返回 404「Content not found in DB」。（原报告笼统写成 404，已修正。）
  - CORS 允许 `Range` 头，并暴露 `Content-Range`，由此推断支持 Range。
- core/config.js 把账号 cookie 设在父域上，由此推断 /download/web/ 依赖 cookie，未实测。

**4) 条款/AUP**
- "Platform Abuse"：禁止 "circumvent storage limits, traffic allowances, or rate limits through automated means, multiple accounts"。
- 限流按 IP 和账号执行，可能自动封 IP（api.js、faq.js）。
- 没有禁止 AI 内容或视频的条款，也没有明文禁止商业使用。
- Abuse 政策写有 AI 扫描和 PhotoDNA/SHA-256/MD5 哈希比对（https://gofile.io/js/pages/abusePolicy.js）。
- 存储机房在巴黎和凤凰城，代理节点含新加坡（faq.js）。

**5) 可用性**：gofile.io、api.gofile.io（返回 `{"status":"ok","data":"api-eu-par-1"}`）、upload.gofile.io 都返回 200。

**评级：免费版不适合；Premium 勉强。** Premium 每月 $9，或每年 $90（checkout.js）。

## 2. file.io

**1) API**
- 来源：https://www.file.io/developers （静态 Swagger 页）。
- `POST /`，字段：`file`、`expires`、`maxDownloads`、`autoDelete`。
- 返回 FileDetails：`id`、`key`、`name`、`link`、`expires`、`expiry`、`downloads`、`maxDownloads`、`autoDelete`、`size`、`mimeType`、`created`、`modified`。
- `GET /{key}` 返回 200 文件数据，或 302；`DELETE /{key}` 删除。
- Server 写的是 `https://file.io`，鉴权方案没展示出来（缺口）。

**2) 大小、保留**
- 定价页（https://www.file.io/plans）：
  - Free：2 GB，"Files auto-deleted after 1 download"，"Hourly upload limit: 4 GB"。
  - Basic：$25/月。
  - Premium：$99/月，含 "Direct downloads"。
- 首页 FAQ："limited to a total of 4 GB"，默认 14 天。
- 网页上传器提示 "maximum size of 4GB"（https://www.file.io/js/lw_upload.js）。
- 条款（https://www.file.io/tos，运营方 Mr Cowboy LLC）：首次下载后或到期日（默认两周）失效，以先到者为准。

**3) 当前状态**
- `https://file.io/` 和 `https://file.io/{key}` 都 301 到 www.file.io。www.file.io 是 S3 静态站（x-amz-request-id），放在 Cloudflare 后面。
- `https://www.file.io/download/{key}` 返回 410 HTML「This file is gone … Continue to LimeWire」。
- 网页上传走 `https://api.limewire.com`，传完跳转到 LimeWire 的 claim 链接（lw_upload.js）。
- 旧的 POST API 是否还能用，未验证（缺口）。

**4) 条款**
- file.io：禁止 "access them using a method other than the interface and the instructions that we provide"，并禁止 scraping。
- LimeWire（https://limewire.com/terms）：
  - 9.2.9 禁止 "unauthorized automated, scripted or bot-based activity"。
  - 28.10 禁止当作 "high-volume or professional file-storage service, CDN"。

**评级：不适合。**

## 3. litterbox.catbox.moe

**1) 上传 API**
- 来源：https://litterbox.catbox.moe/tools.php
- 端点：`POST https://litterbox.catbox.moe/resources/internals/api.php`，multipart。
- 字段：`reqtype=fileupload`、`time=1h|12h|24h|72h`、`fileToUpload`。
- 原文："All uploads are anonymous"；"There is only 1 request type for Litterbox - fileupload"（也就是没有删除接口）。
- 返回格式：官方 ShareX 配置 https://litterbox.catbox.moe/resources/litterbox.catbox.moe.sxcu 写的是 `"ResponseType": "Text"`，前端 uploadform.js 也把 responseText 直接当链接，所以返回的就是纯文本直链。返回的域名还没实测。
- 首页表单的隐藏字段：`time` 默认 `1h`，`fileNameLength` 默认 `16`（可选 6）。fileNameLength 在 API 文档和 ShareX 配置里都没有出现。
- API 不传 time 会怎样，官方没写。（原报告说「必须传、没有默认」，没有依据，已修正。）

**2) 大小、保留、删除**
- 首页原文 "Temporary uploads up to 1 GB are allowed"；前端 `maxFilesize: 1005`，`timeout: 1200000` 毫秒（20 分钟）。
- 保留只有 4 档：1h / 12h / 24h / 72h。
- 不能删除。
- 禁止的扩展名：.exe .scr .cpl .doc* .jar。
- 禁止上传：整集动画或电视剧、儿童色情、恶意软件、重度血腥；违规会删文件并封 IP（https://litterbox.catbox.moe/faq.php）。2–30 秒的参考片段不在禁止范围内。

**3) 直链特性**
- litterbox.catbox.moe：
  - 首页 GET 返回 200。
  - **HEAD 一律返回 405，连静态文件也是。** 但 CORS 头又声明了 GET, HEAD, POST。
  - 静态文件 GET 时带 `accept-ranges: bytes`。
- litter.catbox.moe：
  - 不存在的文件，HEAD 和 GET 都返回 404 text/html，说明 HEAD 能走到后端。
  - 带 HSTS preload。
  - 没有 server 头、cf-ray、cf-mitigated。
- 两个域名都解析到 108.181.20.36。
- 没有现成样例文件，真实文件的 Content-Type 和 Range 未验证（缺口）。

**4) 条款**
- 商业使用：
  - FAQ（https://catbox.moe/faq.php 、https://litterbox.catbox.moe/faq.php）："You cannot use Catbox for commercial services without prior approval"。举的例子包括 "a source for videos that are streamed on sites other than files.catbox.moe"，并补充说明这条只针对外链到 Catbox 以外的文件。
  - legal.php（https://catbox.moe/legal.php）："Commercial use includes using Catbox in your organization or project that generates a revenue from any merchandise or services sales"，需要 "written, express permission"。
  - **这意味着：只要在公司或营利项目里用，包括内部使用，就要书面许可，不只是「对外收费」的情况。**
- 禁止用 "publicly supported interfaces" 以外的方式访问；API 本身属于公开支持的接口。
- AI：只说不和生成式 AI 公司签任何协议，没有禁止 AI 内容。
- 地区/ISP 封锁：澳大利亚（DNS）、伊朗、阿富汗、土耳其、Comcast、Spectrum、Rogers、Verizon、Quad9。名单里没有马来西亚。
- 上传者 IP 会和文件一起保存。

**5) 可用性**：正常，首页显示捐款进度 $1,570/$1,660。

**评级：勉强。** 纯个人、非营利用途下，技术上最合适：用 time=24h，fileNameLength=16。凡涉及公司或营利，必须先拿到 Catbox 的书面许可，否则转向 ③ S3 方案。

## 4. x0.at

**1) 上传 API**
- 来源：https://x0.at/
- `POST https://x0.at/`，multipart，字段 `file`。
- 可选参数：`id_length`（最长 24）、`keep_name=1`；网页表单还会传 `formatted=true`（返回 HTML）。
- 不需要账号。
- 返回纯文本，每行一个 URL（format_links，https://raw.githubusercontent.com/Rouji/filehost2/master/src/handlers.rs ）。
- ShareX 配置 https://x0.at/?config=sharex 可用。首页链接是大写的 `?config=ShareX`，访问会报错。

**2) 大小、保留、删除**
- "The maximum allowed file size is 1024 MiB"。
- 保留 3–100 天，公式 `MIN_AGE + (MAX_AGE - MIN_AGE) * (1-(FILE_SIZE/MAX_SIZE))^2`，200MiB 约 65.8 天。不能自选。
- 路由只有 `/`、`/captcha*`、`/{slug}` 和 `/admin`，用户没有删除接口。

**3) 直链特性**
- nginx/1.31.6，没有 Cloudflare，带 HSTS。
- 根路径 HEAD 返回 403；不存在的文件 GET/HEAD 返回 404（nginx 默认页，153 字节）。核查时遇到过一次 502。
- 源码行为：
  - 用 actix NamedFile 输出，带 etag 和 last-modified，推断支持 Range。
  - video/* 用 inline 方式返回。
  - **Content-Type 取自数据库里的 content_type（优先用客户端声明的类型），所以上传时 multipart 分段必须带 video/mp4 或 video/quicktime。**
- 默认 `min_id_length=3`，ID 很短，应该传 id_length=24。
- 托管在 Hetzner（rDNS your-server.de，属推断）。

**4) 条款**
- 没有 ToS，只留了 abuse 邮箱 root@x0.at。
- 源码里可以封 IP、封 UA，限制每日上传次数和字节数、上传限速，还有 clamd 和 NSFW 扫描（settings.rs）。
- **`upload_timeout` 默认 300 秒**：200MB 文件需要上行至少约 5.6 Mbit/s，线上实际配置未知。
- **PoW 验证已经部署到线上**：`GET /captcha/challenge` 返回 difficulty 20 的挑战。但 master 分支 `is_upload_suspect` 恒返回 false，提交说明是 "not wired into anything yet"（2026-09-02）。运营者随时能打开。

**5) 可用性**：首页 200；GitHub 最后一次推送是 2026-09-06，仍在维护。

**评级：勉强。**

## 5. temp.sh

- 来源：https://temp.sh/
- 上传：`curl -F "file=@test.txt" https://temp.sh/upload`，POST multipart，字段 `file`，网页表单还会传 `submit`。不需要账号。
- 返回格式没写（缺口）。
- "Current file size limit is 4GB"，"Files expire after 3 days"。没有写删除方式，也没有 ToS。
- nginx/1.30.3，没有 Cloudflare。
  - GET /upload 返回 405。
  - 错误页是 Werkzeug/Flask 默认样式（推断）。
  - 首页链接的 https://temp.sh/up.sh 和 https://temp.sh/temp.sh.sxcu 都返回 404。
- 托管在 OVH VPS（rDNS，推断）。
- **评级：勉强（必须实测直链行为）。**

## 已排除

| 站点 | 排除原因 | 来源 |
|---|---|---|
| 0x0.st | 原报告引用了反 AI slop、反自动化的条款。本次从本机连接超时，WebFetch 也失败，原文没能复核；但至少当前不可达 | https://0x0.st/ |
| filebin.net | 没有验证 cookie 时返回 HTML 验证页；有 cookie 时 302 到默认 1 分钟过期的 S3 预签名 URL；还可能返回 "bin is not approved"（已复核） | https://filebin.net/api.yaml |
| pixeldrain | "Anonymous uploading is not supported"；外链要上传者或下载者有 Premium（已复核） | https://pixeldrain.com/api |
| buzzheavier.com | 403，cf-mitigated: challenge（已复核） | curl 首页 |
| oshi.at | 302 到 nicsell.com/domain/oshi.at（已复核） | curl 首页 |
| envs.sh | "This domain may be for sale"（已复核） | curl 首页 |
| uguu.se | 128 MiB / 3 小时（已复核） | https://uguu.se/ |
| tmpfiles.org | 最大 100 MB，保留 60 分钟 / 6 小时 / 24 小时 / 48 小时（已复核） | https://tmpfiles.org/ |
| isrv.it.com（新发现，未核实） | 走 Cloudflare（server: cloudflare），页面是 SPA。页面配置为 maxFileSizeMb 1024、minAgeDays 7、maxAgeDays 365。API 和条款都读不到，有 Cloudflare 验证风险 | https://isrv.it.com/ |

## 建议
1. 先确认使用场景：只要和公司或营利有关，Litterbox 就需要 Catbox 书面许可。这种情况下，本组没有一个是合规又可控的方案，应提前做 ③ S3。
2. 纯个人场景：首选 Litterbox（time=24h，fileNameLength=16），备选 x0.at（id_length=24，multipart 分段要带正确的 Content-Type）。
3. 经用户批准后，各做一次测试上传，用 curl -sI 和 Range GET 检查 Content-Type、Accept-Ranges、HEAD 是否可用。注意 litterbox.catbox.moe 这个主机拒绝 HEAD。

## 缺口
- 各站真实文件的直链响应头（Content-Type、Accept-Ranges）都没实测。
- Litterbox：返回的域名、不传 time 时的行为、是否公开列出文件、限流规则，都未知。
- gofile：单文件上限未知。
- file.io：旧 POST API 是否可用、鉴权方案，都未知。
- x0.at：线上配置（上传超时、限额、PoW 是否启用）未知。
- temp.sh：返回格式和直链行为未知。
- 0x0.st：当前不可达，原文没能复核。
- 各站是否屏蔽数据中心 IP、ModelArk 从 ap-southeast-1 拉取能否成功、拉取时会不会先发 HEAD，都只能实测。

## corrections
[
 {
  "claim": "Litterbox 评为「适合（非商业前提）」，并称「如果 ARK 工具对外收费，需要先拿到 Catbox 的书面许可」",
  "problem": "把商业使用的范围说窄了，评级偏高。条款并不只管对外收费：只要在会产生收入的组织或项目里用 Catbox，就算商业使用。FAQ 还专门点名「把视频外链到 files.catbox.moe 以外的站点当源」，并说明这条只针对 Catbox 之外的外链。把链接交给 ModelArk 去拉取，正好就是这种情况。",
  "correct_fact": "legal.php 原文：\"Commercial use includes using Catbox in your organization or project that generates a revenue from any merchandise or services sales... only allowed with written, express permission\"。所以只要在公司或营利项目里用（包括内部使用），就要先拿到书面许可。评级应降为「勉强（仅纯个人、非营利用途可用）」",
  "source_url": "https://catbox.moe/legal.php"
 },
 {
  "claim": "Litterbox「没有默认档，必须传 time」",
  "problem": "官方没有任何文字支持这个说法，属于凭推测补的。",
  "correct_fact": "官方网页表单里的隐藏字段默认 time=1h。官方 ShareX 配置分别用 time=1h（litterbox.catbox.moe.sxcu）和 time=12h（sharexcode.txt）。API 不传 time 会怎样，官方没写（列入缺口）",
  "source_url": "https://litterbox.catbox.moe/"
 },
 {
  "claim": "Litterbox 返回纯文本 URL 只是从 uploadform.js 推断出来的",
  "problem": "有更直接的官方证据，报告没用上，结论可以说得更确定。",
  "correct_fact": "官方 ShareX 配置 https://litterbox.catbox.moe/resources/litterbox.catbox.moe.sxcu 里写的是 \"ResponseType\": \"Text\"，也没有配置 URL 解析规则，说明响应正文本身就是链接。返回的域名是不是 litter.catbox.moe 仍未实测。另外这份 sxcu 没有 fileNameLength 字段",
  "source_url": "https://litterbox.catbox.moe/resources/litterbox.catbox.moe.sxcu"
 },
 {
  "claim": "litterbox.catbox.moe：GET 200 / HEAD 405（报告只当成首页的现象）",
  "problem": "漏了细节。不只是首页，这个主机上连静态文件也拒绝 HEAD，可是响应头里又声明了 access-control-allow-methods: GET, HEAD, POST。",
  "correct_fact": "litterbox.catbox.moe/resources/*.sxcu：HEAD 返回 405，GET 返回 200，并带 accept-ranges: bytes。litter.catbox.moe 上访问不存在的文件，HEAD 返回 404 而不是 405，说明文件主机上 HEAD 能走到后端。两个主机都没有 server 头，也没有 cf-ray",
  "source_url": "https://litterbox.catbox.moe/resources/litterbox.catbox.moe.sxcu"
 },
 {
  "claim": "gofile store1.gofile.io 访问不存在的 /download/web/… 或 /download/direct/… 返回 404 text/plain",
  "problem": "不准确，要看 ID 的格式。",
  "correct_fact": "ID 不是 UUID 格式时返回 400 text/plain「Invalid UUID」；ID 是合法 UUID 格式但不存在时返回 404 text/plain「Content not found in DB」",
  "source_url": "https://store1.gofile.io/download/direct/7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d/report.pdf"
 },
 {
  "claim": "gofile 免费版只说了「10 天不活跃删除」",
  "problem": "漏了冷存储机制和条款里的原话。",
  "correct_fact": "FAQ 写明内容过了存储期后可能被移入 cold storage，在 Premium 账号把它导入回账户空间之前不能直接下载。条款写明 \"Most API endpoints require a Premium account\"，并列出 direct links 和 cold storage import 都是 Premium 专属。GET /contents 返回的 link 字段（https://store-1.gofile.io/download/web/...）也只有 Premium 能拿到",
  "source_url": "https://gofile.io/js/pages/faq.js"
 },
 {
  "claim": "x0.at 的 PoW 门槛「源码里有、目前没启用」",
  "problem": "说轻了。PoW 已经部署到线上，只是还没接到上传流程里。",
  "correct_fact": "线上 GET https://x0.at/captcha/challenge 返回 200 JSON，含 token 和 difficulty:20。master 分支 is_upload_suspect 恒返回 false；提交「captcha basics ... not wired into anything yet」的日期是 2026-09-02。运营者只要改一个函数就能拦截脚本上传，返回 428 并提示「Please verify you're not a script」",
  "source_url": "https://raw.githubusercontent.com/Rouji/filehost2/master/src/handlers.rs"
 },
 {
  "claim": "x0.at 容量和保留时长都够，直链也干净",
  "problem": "漏了几处会影响大文件上传和 Content-Type 的源码事实。",
  "correct_fact": "settings.rs 里 upload_timeout 默认 300 秒（\"max. time an upload can take\"）。如果线上用的是默认值，200MB 文件要在 5 分钟内传完，上行至少需要约 5.6 Mbit/s。还可以配置每 IP 每日上传次数、每日字节数和上传限速。get_file 返回的 Content-Type 取自数据库里的 content_type，优先用客户端上传时声明的类型，所以 multipart 分段必须带 Content-Type: video/mp4 或 video/quicktime",
  "source_url": "https://raw.githubusercontent.com/Rouji/filehost2/master/src/settings.rs"
 },
 {
  "claim": "x0.at ShareX 配置在 https://x0.at/?config=sharex",
  "problem": "这个小写地址能用。但首页上的链接是 /?config=ShareX（大写），访问会报错，报告没说明。",
  "correct_fact": "https://x0.at/?config=ShareX 返回「Query deserialize error: unknown variant `ShareX`」；小写 sharex 返回 POST multipart、FileFormName=file 的配置。核查时还遇到一次 502 Bad Gateway，之后重试 5 次都正常",
  "source_url": "https://x0.at/?config=sharex"
 },
 {
  "claim": "file.io 根域 API 已经 301 到 S3 静态站",
  "problem": "结论对，但漏了更直接的证据。",
  "correct_fact": "https://file.io/{key} 也是 301 到 www.file.io/{key}。https://www.file.io/download/{key} 返回 410 text/html「This file is gone ... Continue to LimeWire」，下载页本身就是 HTML。运营方是 Mr Cowboy LLC（tos 页）",
  "source_url": "https://www.file.io/download/abc123XYZ"
 },
 {
  "claim": "file.io 定价页写 2GB、FAQ 写 4GB，官方自相矛盾",
  "problem": "不完全是矛盾，4GB 有出处。",
  "correct_fact": "定价页 Free 档写的是单文件 2 GB，外加「Hourly upload limit: 4 GB」。首页上传脚本 lw_upload.js 的提示是 \"we can only support files with a maximum size of 4GB\"，超过就引导用户去 LimeWire。FAQ 里的「total of 4 GB」对应的是网页上传器的上限",
  "source_url": "https://www.file.io/js/lw_upload.js"
 },
 {
  "claim": "0x0.st 已核实排除（引用了首页原文）",
  "problem": "这次核查没能重新读到原文。",
  "correct_fact": "2026-10-08 从本机访问 0x0.st，IPv4/IPv6 的 TCP 连接都超时（40 秒），WebFetch 也失败，引用的原文无法复核。不过排除结论不变：至少从这里看，它当前不可达",
  "source_url": "https://0x0.st/"
 }
]

## gaps
- gofile.io：官方页面没写免费/访客的单文件大小上限
- gofile.io：没有样例文件，无法确认访客网页下载链接（store-N.gofile.io/download/web/...）是否必须带账号 cookie；只能从 config.js 把账号 cookie 设在父域 gofile.io 上推断
- gofile.io / litterbox / x0.at / temp.sh：没有现成样例文件，真实直链的 Content-Type 和 Accept-Ranges 都未实测；需用户批准一次测试上传后用 curl -sI 验证
- file.io：旧 API POST https://file.io/ 现在是否还能用，只能 POST 验证，未做；根域 GET/HEAD 返回 301 到 www（S3 静态站）
- file.io：developers 页有 Authorize 按钮，但没展示具体鉴权方案（API Key 还是 Bearer）
- file.io：免费上限定价页写 2GB、FAQ 写 4GB，官方自相矛盾
- litterbox：tools 页没写响应格式，'返回纯文本 URL'是从官方前端 uploadform.js 推断的；返回域名 litter.catbox.moe 也未实测
- litterbox：官方没写限流、是否公开列出文件、服务器所在地
- litterbox：fileNameLength 参数只出现在首页表单隐藏字段里，API 文档没写
- x0.at：没有 ToS/AUP 页；线上部署的代码是否和 GitHub master 一致、PoW 上传门槛是否对数据中心 IP 启用，都无法确认
- x0.at：服务器所在地未知
- temp.sh：官方没写返回格式、GET 链接是否直接给文件字节、能否删除、ToS；首页链接的 up.sh 和 temp.sh.sxcu 都 404
- 各站都没有关于屏蔽数据中心 IP 的官方说明（只有 0x0.st 写了屏蔽 Tor、Catbox 列了国家/ISP 封锁名单），ModelArk 从马来西亚柔佛 ap-southeast-1 拉取能否成功只能实测
- ModelArk 拉取方的行为（会不会先发 HEAD、是否跟随 302、用什么 UA）不在本组调研范围内，但会影响 file.io、filebin 这类跳转型链接