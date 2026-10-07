# 公共临时文件托管：litterbox.catbox.moe / catbox.moe / uguu.se（对抗性复核版）

复核时间：2026-10-07 15:58–16:10 UTC，以服务器 Date 头为准。全程只读：只用 curl 做 GET/HEAD，外加 WebFetch 读一份 BunkerWeb 官方文档。没有上传文件，没有提交表单，没有注册账号。

## 复核结论

**属实的部分**：原报告的大多数技术事实，我回到原文逐条核对过，都对得上。包括：
- API 地址和字段名；
- 大小上限和保留档位；
- ShareX 配置；
- 状态页数据（Litterbox 24h 可用率 0.8598，2026-10-07 14:38–15:50 有 9 个失败心跳）；
- 博客原文（2026-02-22、2026-04-14、2026-07-02、2025-06-02 四篇）；
- Catbox ToS 和隐私政策条款；
- files.catbox.moe 的 GET、206 和 HEAD 表现。

**需要修正的部分**：
1. **漏报**：Litterbox 的直链域名 litter.catbox.moe 前面有 BunkerWeb WAF。
2. **评级偏乐观**：Litterbox 应该从“勉强”降为“不适合”。
3. **uguu 引用地址过时**：api.html 和 faq.html 已经 301 跳走。
4. **uguu 源码推断不可靠**：线上跑的是 1.9.7，仓库默认配置和线上明显不一致。
5. **补充**：uguu 的过期从上传时刻起算；另有去重（ANTI_DUPE）带来的风险。

---

## 1. litterbox.catbox.moe

### 1) 上传 API（已核实）
- **请求**：`POST https://litterbox.catbox.moe/resources/internals/api.php`，multipart/form-data。
  - 字段：`reqtype=fileupload`；`time` 取 `1h`、`12h`、`24h`、`72h`；`fileToUpload` 是文件本体。
  - 官方说明只有 fileupload 这一种请求，所有上传都是匿名的，不需要 userhash。
  - 来源：https://litterbox.catbox.moe/tools.php
- **首页隐藏字段**：`time=1h`、`fileNameLength=16`、`reqtype=fileupload`；页面上可以选 6 位或 16 位文件名。tools 页没有写 fileNameLength。
  - 来源：https://litterbox.catbox.moe/
- **返回格式**：纯文本，内容就是 URL。
  - ShareX 配置写的是 `"ResponseType": "Text"`，文件字段名 `fileToUpload`，默认 `time=1h`：https://litterbox.catbox.moe/resources/litterbox.catbox.moe.sxcu
  - 旧版配置 sharexcode.txt 用的是 `time=12h`：https://litterbox.catbox.moe/resources/sharexcode.txt
  - 网页 JS 直接把 responseText 当链接显示：https://litterbox.catbox.moe/resources/uploadform.js
- **直链域名**：litter.catbox.moe 在所有官方页面里都没出现。我逐页 grep 过 Litterbox 的首页、FAQ、tools、sxcu、sharexcode，以及 Catbox 的首页、FAQ、tools，命中数都是 0。
  - DNS 上 litter.catbox.moe 和 litterbox.catbox.moe 都解析到 108.181.20.36。
  - 所以这个域名只是推断。

### 2) 大小、保留、删除（已核实）
- **单文件上限**：1 GB。首页写的是“Temporary uploads up to 1 GB”，uploadform.js 里是 `maxFilesize: 1005`。来源：https://litterbox.catbox.moe/
- **保留档位**：1 小时、12 小时、1 天、3 天，网页默认 1h。来源：https://litterbox.catbox.moe/
- **付费档**：Tier 2（$10/月）和 Tier 3（$20/月）可以设更长的过期时间，也能跟踪自己的 Litterbox 上传。来源：https://store.catbox.moe/
  - 2025-06-02 的博客写的是 Tier 2 最长 7 天，可以跟踪上传、提前删除：https://blog.catbox.moe/post/785233399498555392/important-catbox-needs-your-help
- **删除**：匿名上传没有删除接口，也没有删除 token。

### 3) 直链特性（只读探测）
- **首页 GET**：返回 200，带 HSTS 和 `access-control-allow-origin: *`，没有 server 头，没有 cf-* 头。
  - 正常响应里写着 `access-control-allow-methods: GET, HEAD, POST`，但首页 HEAD 却返回 405。
  - 这个 405 响应带的是 nonce 型 CSP 加 `require-trusted-types-for`，和 BunkerWeb 错误页的形态一致。推断是 WAF 拦掉了 HEAD。
- **【新增】直链域名前面有 BunkerWeb WAF**：
  - `https://litter.catbox.moe/` 的 GET 返回 403；
  - 不存在的文件（`https://litter.catbox.moe/zzzzzzzzzzzzzzzz.mp4`）GET 和 HEAD 都返回 404 text/html；
  - 这些响应体都是 BunkerWeb 错误页，页脚写着“This website is protected with BunkerWeb”。
  - 来源：https://litter.catbox.moe/
- **BunkerWeb 的默认能力**（来源：官方文档 https://docs.bunkerweb.io/latest/features/ ）：
  - antibot 默认关闭，但可以开启 JS 计算、captcha、reCAPTCHA、hCaptcha、Turnstile 等挑战；
  - bad behavior 默认在 60 秒内出现 10 次 400/401/403/404/405/429/444，就把该 IP 封 24 小时；
  - 默认黑名单包含已知坏 UA 和 Tor 出口 IP，还有 BunkerNet 共享情报。
  - Catbox 实际开了哪些，官方没有说明。
  - **风险**：ModelArk 的拉取端如果先发 HEAD（会拿到 405）或者反复重试，或者它的 UA、IP 命中黑名单，就可能被拦截或封禁。本次从本机访问没有出现挑战页。
- **对比**：files.catbox.moe 的 404 是 Catbox 自己的页面，响应头有 `server: nginx`，看不到 BunkerWeb 的痕迹。
- **视频响应头**：没有官方样例文件，mp4/mov 的 Content-Type、Range 和 HEAD 表现都没法验证。

### 4) ToS / AUP（已核实，并加重风险判断）
- **FAQ 内容**（来源：https://litterbox.catbox.moe/faq.php ）：
  - 禁止 .exe、.scr、.cpl、.doc*、.jar；
  - 禁止上传 CSAM、恶意软件、整集动画或电视剧、重度血腥；
  - 未经事先批准不得把 Catbox 用于商业服务，例子包括当 CDN，或者作为在 files.catbox.moe 以外播放的视频源；
  - 上传 IP 和文件一起存储。
- **商业用途的定义**：ToS 把“所在组织或项目有营收”算作商业用途，必须拿到书面许可。来源：https://catbox.moe/legal.php
- **2026-02-22 博客**（来源：https://blog.catbox.moe/post/809324731954266112/missing-files-blank-uploads-commercial ）：
  - 来自数据中心或非住宅 IP、属于“商业上传者”类别的内容，会被重度过滤或清除；
  - 来自非住宅 IP 的批量低质量 AI 生成内容会被过滤；
  - AI agent 的行为由用户自己负责。
- **2026-04-14 博客**（来源：https://blog.catbox.moe/post/813932072453455872/happy-11th-birthday-catbox ）：
  - 运营者点名 Claude 在编码项目里把 Catbox 当中转“垃圾场”，定性为“clearly an abuse of the service”；
  - 当天起限制来自数据中心和公共代理 IP 的匿名上传。
- **Litterbox 是否受影响**：原文没有单独提 Litterbox。但 Litterbox 的上传按设计全部是匿名的（https://litterbox.catbox.moe/tools.php ），如果限制也适用于它，就等于覆盖了所有来自数据中心或代理 IP 的 Litterbox 上传。
- **公开列表与可猜测性**：没看到公开列出文件的功能。文件名可以选 16 位，但字符集官方没写。
- **地区屏蔽**：Catbox FAQ 列出的访问受阻地区是澳大利亚、伊朗、阿富汗、土耳其，以及 Comcast、Spectrum、Rogers、Verizon、Quad9。马来西亚不在列表里。来源：https://catbox.moe/faq.php

### 5) 可用性（已核实）
- API 无参数 GET 返回 412 “No request type given.”，说明在线。
- 状态页 https://status.catbox.moe/status/catbox 的 API 数据：
  - Litterbox 24 小时可用率 0.8598，最近 100 个心跳里失败 9 个；
  - Catbox 主站同期是 0.9806；
  - 没有事故公告，也没有维护公告。

### 评级：不适合（原报告为“勉强”，下调）
- 技术参数最贴合需求：1 GB 上限，最长 72h，不用账号，返回纯文本 URL。
- 但有三个问题：
  1. 运营者明确把“Claude 编码项目把 Catbox 当中转站”定性为滥用，本工具正是这个用法；
  2. 商业用途需要书面许可；
  3. 前面有 WAF，可能自动封禁或挑战拉取方；24 小时可用率只有 86%；匿名上传不能删除。

---

## 2. catbox.moe

### 1) 上传 API（已核实）
- **请求**：`POST https://catbox.moe/user/api.php`。来源：https://catbox.moe/tools.php
  - 文件上传：`reqtype=fileupload`，`fileToUpload`，`userhash` 可选（不传就是匿名）；
  - URL 上传：`reqtype=urlupload`，`url`；
  - 删除：`reqtype=deletefiles`，`files` 用空格分隔，必须带 userhash；
  - 另有 5 种相册操作。
- **返回**：纯文本 URL。依据：
  - ShareX 配置用 MultipartFormData、字段 `fileToUpload`，没有 URL 模板：https://catbox.moe/resources/catbox.moe.sxcu
  - 网页 JS 把 responseText 直接当链接显示。
- **直链**：形如 `https://files.catbox.moe/174bac.jpg`（官方示例），不用改路径。

### 2) 大小、保留、删除（已核实）
- **上限**：首页写 200 MB（https://catbox.moe/ ），JS 里残留 `maxFilesize: 1000`。付费 Tier 2 是 500 MB，Tier 3 是 1 GB（https://store.catbox.moe/ ）。
- **保留**：
  - 匿名文件 2 年无访问才会被移除，账号上传的文件永久保留，官方建议临时用途用 Litterbox。来源：https://catbox.moe/faq.php
  - 2026-07-06 起追溯执行，被移除的文件转去非冗余存储，files.catbox.moe 上不能再访问。来源：https://blog.catbox.moe/post/821058172332769280/removing-idle-uploads
- **删除**：只有带 userhash 的账号才能删。
- **隐私政策**：上传的文件全球公开可访问，直到你删除为止。来源：https://catbox.moe/legal.php

### 3) 直链特性（对官方示例 https://files.catbox.moe/174bac.jpg 实测）
- **GET**：
  - 返回 200，`server: nginx`，`content-type: image/jpeg`，`content-length: 229453`，`accept-ranges: bytes`，`access-control-allow-origin: *`；
  - 带 `Range: bytes=0-15` 返回 206，`content-range: bytes 0-15/229453`；
  - 没有 cf-* 头。DNS 是 108.181.20.35。
- **HEAD**：返回 200，但 `content-length: 0`，也没有 accept-ranges。
  - 【补充】HEAD 的响应头整体和 GET 不同：带的是 catbox.moe 主站那套 CSP，还有 `x-frame-options: DENY`。推断 HEAD 被路由到了另一个后端。
- **视频响应头**：没有官方视频样例，无法验证。

### 4) ToS / AUP（已核实）
- **FAQ**（来源：https://catbox.moe/faq.php ）：
  - 禁止的文件类型和禁止的内容同 Litterbox；
  - 商业限制同上，并补充说明这条只针对在 Catbox 以外热链的文件；
  - 明确不和任何生成式 AI 公司达成协议。
- **AUP**（来源：https://catbox.moe/legal.php ）：
  - 禁止通过非公开支持的接口访问或搜索服务（官方 API 属于公开接口，这一点是推断）；
  - 禁止绕过存储限制；
  - 禁止转售服务。
- **去重**：ToS 写明可能对重复文件做去重处理。
- **博客**：2026-02 的内容同 Litterbox 一节。另外提到部分上传会失败，返回空链接，或者返回的链接打开是空白页或 404。所以上传后必须先自检。
- **文件名**：官方示例都是 6 位小写字母加数字（174bac、eh871k），可猜测性较高（推断）。

### 5) 可用性
- 状态页 24 小时可用率约 98%；API 无参数 GET 返回 412。

### 评级：不适合（维持原评级）
- 文件永久公开存储，匿名上传不能删；200 MB 正好卡在 Seedance 的上限上；有商业和 AI 方面的政策风险；HEAD 不可信。

---

## 3. uguu.se（Pomf AB，瑞典）

### 1) 上传 API（已核实，修正引用地址）
- **请求**：`POST https://uguu.se/upload`，字段 `files[]`（可以多文件），默认返回 JSON；加 `?output=` 可以换成 json、csv、text、html、gyazo。
  - 示例：`curl -i -F files[]=@yourfile.jpeg https://uguu.se/upload`
  - 来源：https://uguu.se/api
  - 【修正】原报告引用的 https://uguu.se/api.html 现在 301 到 http://uguu.se/api。
- **网页实际请求**：
  - JS 实际 POST 的是 `upload.php`，字段 `files[]`：https://uguu.se/uguu.min.js
  - 无 JS 时的表单 action 是 `upload?output=html`：https://uguu.se/
  - `/upload` 和 `/upload.php` 的无文件 GET 或 HEAD 都返回 400 JSON “No input file(s)”。
- **账号**：不需要。README 写着“no registration required”：https://github.com/nokonoko/Uguu
- **返回结构**：`{"success":true,"files":[{"hash","filename","url","size","dupe"}]}`，`url = https://<FILE_DOMAIN>/<filename>`，不用改路径；`?output=text` 时每行一个 URL。
  - 线上版本 1.9.7 的标签和 master 分支这部分代码一致，可以认为可靠。
  - 来源：https://github.com/nokonoko/Uguu/blob/master/src/Classes/Upload.php 、https://github.com/nokonoko/Uguu/blob/master/src/Classes/Response.php
- **线上直链域名**：未知。
  - d.uguu.se、h.uguu.se、n.uguu.se 都解析到 62.210.x.x；根路径 301 到 uguu.se；不存在的文件返回 nginx 404，而且有两个重复的 content-type 头。
  - a.uguu.se、o.uguu.se、files.uguu.se 连不上。
  - 状态页显示有 3 个“File Storage & Delivery”节点，但没写域名。

### 2) 大小、保留、删除（已核实，补充起算点）
- **上限和保留**：128 MiB，固定 3 小时。来源：https://uguu.se/ 、https://uguu.se/faq （原 faq.html 已 301）
- **【补充】过期起算**：源码 expireChecker 删除 `date <= now - expireTime` 的记录，所以从上传时刻起算，由定时任务执行，实际存活不少于 3 小时。来源：https://github.com/nokonoko/Uguu/blob/master/src/Classes/expireChecker.php
- **【补充】去重风险**：如果线上开了 ANTI_DUPE（默认关闭，线上未知），重复上传同一个文件会返回旧文件名，过期时间仍按第一次上传算。可以看返回里的 `dupe` 字段判断。
- **删除**：源码里没有面向用户的删除接口，也没有删除 token。

### 3) 直链特性
- **首页**：HTTP/2 200，`server: nginx`，有 HSTS，没有 Cloudflare 头。DNS 是 167.235.106.19。
- **文件子域名**：nginx，没有 cf 头，也没有 WAF 页面。
- **视频响应头（推断）**：官方 nginx 示例里文件域名是纯静态 root（https://github.com/nokonoko/Uguu/blob/master/src/static/nginxExamples/a.uguu.se.conf ）。按 nginx 默认行为，应该会按扩展名返回 video/mp4 或 video/quicktime 并支持 Range。线上没有样例文件，无法验证。

### 4) FAQ 和条款（已核实；没有独立的 ToS/AUP 页面，/terms、/tos、/legal 都返回 500）
- **允许的内容**：在德国、瑞典、法国合法，且你有权发布的文件都可以；恶意软件可能被删除。FAQ 明确提到视频。来源：https://uguu.se/faq
- **日志**：保存文件名、哈希、上传 IP 和上传时间，文件过期时一并删除；不记录下载和访问。
- **没有看到**的限制：禁止自动化或 API 调用、禁止 AI 内容、禁止商业用途、数据中心 IP 限制、地区限制。
- **【修正】仓库配置不能代表线上**：
  - 线上 meta generator 是“Uguu 1.9.7”，GitHub master 是 1.9.9（2025-12-06）；
  - 仓库默认配置（包括 v.1.9.7 标签）是 expireTime=8 hours、LOG_IP=false，而线上是 3 小时、记录 IP；
  - 所以 NAME_LENGTH=8、字符集 51 个字母、RATE_LIMIT=false、过滤名单等，都只能算参考。
  - 来源：https://raw.githubusercontent.com/nokonoko/Uguu/v.1.9.7/src/config.json

### 5) 可用性（已核实）
- 状态页 https://status.pomf.se/status/services 的 API 数据：Uguu 的 6 个监控项（3 个存储节点、2 个上传节点、1 个负载均衡）24 小时可用率都是 1；没有事故公告，也没有维护公告。
- GitHub 仓库没有归档，最后推送是 2025-12-06。

### 评级：勉强（本组首选）
- **优点**：条款最宽松；没有 WAF 或 Cloudflare；节点稳定；JSON 里直接给出直链。
- **限制**：
  - 固定 3 小时，没有 24h 档；
  - 上限 128 MiB，低于 200MB；
  - 不能删除；
  - 线上直链域名、视频的 Content-Type 和 Range 都没有验证；
  - 如果任务排队超过 3 小时，拉取会失败。

---

## 总结对比

| 站点 | 上限 | 保留 | 删除 | 账号 | 拦截层 | 政策风险 | 评级 |
|---|---|---|---|---|---|---|---|
| litterbox | 1 GB | 1h/12h/24h/72h（默认 1h） | 匿名不可删 | 否 | BunkerWeb WAF | 高：运营者点名这种用法是滥用；商业需书面许可 | 不适合 |
| catbox | 200 MB | 2 年无访问才清理 | 需要 userhash | 否（删除需要） | 未见 | 高：永久公开，政策同上 | 不适合 |
| uguu | 128 MiB | 固定 3h（从上传起算） | 不可删 | 否 | 未见 | 低 | 勉强（首选） |

## 建议
- **默认方案**：uguu.se，适用于文件 ≤128 MiB、预计 3 小时内会被拉取的情况。
  - 尽量在提交 ModelArk 任务前一刻再上传；
  - 检查返回的 `dupe` 字段；
  - 上传后由本地服务用 GET（带 `Range: bytes=0-1023`）自检一次，确认是 200 或 206、Content-Type 是 video/*；
  - 不要依赖 HEAD。
- **超过 3 小时或文件超过 128 MiB 的情况**：本组没有合适的方案，留给后续的 S3 兼容对象存储预签名 URL 方案（用户已说明放到后续）。
- **Catbox 和 Litterbox**：不建议接入。

## gaps（读不到或无法验证）
- litter.catbox.moe 不在任何官方页面上，只能从 DNS 推断。Litterbox 的 mp4/mov Content-Type、Range、HEAD 表现无法验证。
- Litterbox 的 BunkerWeb 实际配置未知：antibot 是否开启、bad behavior 阈值、UA/IP 黑名单，以及是否会拦截 ModelArk 拉取端的 IP 或 UA。
- Litterbox 不传 time 时的默认值；API 是否接受 fileNameLength；过期是否从上传时刻起算。
- Catbox 2026-04 的数据中心和代理 IP 限制是否覆盖 Litterbox，判定标准是什么。
- 个人工具调用付费 ModelArk 是否算 Catbox 定义的商业用途，需要邮件 admin@catbox.moe 确认。
- Catbox 写的 200 MB 是 MB 还是 MiB；files.catbox.moe 的 HEAD 为什么和 GET 不一致。
- uguu 的线上 FILE_DOMAIN、文件名长度、是否开启 RATE_LIMIT 和 ANTI_DUPE、线上过滤名单；视频的 Content-Type 和 Range。
- uguu 没有独立的 ToS/AUP，对自动化、商业、AI 内容的态度只能从 FAQ 没有禁止来推断。
- 三个站对来自 ModelArk ap-southeast-1 数据中心 IP 的下载是否有限制，官方都没说明。
- 本次从本机发出的请求能直接访问三个站，但本机出口的网络环境（是否经过代理等）没有确认，长期可达性也没有官方信息。


## corrections
[
 {
  "claim": "Litterbox 响应头里没有 cf-ray 或 cf-mitigated，看不到 Cloudflare 验证（言下之意是直链前面没有拦截层）",
  "problem": "漏掉了一个关键问题。litter.catbox.moe 前面有 BunkerWeb WAF：根路径 GET 返回 403，不存在的文件 GET/HEAD 返回 404，响应体都是 BunkerWeb 错误页，页脚写着 \"This website is protected with BunkerWeb\"。没有 Cloudflare 不等于没有人机验证或自动封禁层。",
  "correct_fact": "litter.catbox.moe 由 BunkerWeb WAF 保护，litterbox.catbox.moe 的 HEAD 405 响应头形态也和 BunkerWeb 错误页一致（这一点是推断）。BunkerWeb 官方文档列出的默认行为：antibot 默认关闭，可以开 JS、captcha、Turnstile 等挑战；bad behavior 默认在 60 秒内出现 10 次 400/401/403/404/405/429/444 就封 IP 24 小时；默认黑名单包含已知坏 UA 和 Tor 出口等。Catbox 实际开了哪些，官方没有说明。本次从本机访问没有遇到挑战页。",
  "source_url": "https://litter.catbox.moe/"
 },
 {
  "claim": "Litterbox 评级为“勉强”，在个人、非商业、住宅 IP 直连的条件下可以用",
  "problem": "评级偏乐观。运营者 2026-04-14 的博客原文点名：Claude 在编码项目里把 Catbox 当中转“垃圾场”，并定性为滥用。本工具的场景正是这个模式：AI 辅助开发的本地工具自动上传文件，再交给付费 AI API 拉取。改用住宅 IP 只是避开了技术上的限制，运营者明确表达的意愿并没有变。再加上商业使用要书面许可、前面有 WAF、24 小时可用率只有 86%，不应该作为方案。",
  "correct_fact": "不适合。技术参数最贴合需求，但运营者明确反对这种用法；如果一定要用，先邮件 admin@catbox.moe 拿到书面许可。",
  "source_url": "https://blog.catbox.moe/post/813932072453455872/happy-11th-birthday-catbox"
 },
 {
  "claim": "uguu 的事实来源为 https://uguu.se/api.html 和 https://uguu.se/faq.html",
  "problem": "这两个 URL 现在返回 301，Location 分别是 http://uguu.se/api 和 http://uguu.se/faq（还降级成了 http）。内容和报告的描述一致，只是引用地址过时了。",
  "correct_fact": "现行页面是 https://uguu.se/api 和 https://uguu.se/faq。API 页内容：POST https://uguu.se/upload，字段 files[]，默认返回 JSON，?output= 可选 json/csv/text/html/gyazo。",
  "source_url": "https://uguu.se/api"
 },
 {
  "claim": "uguu 的文件名长度、字符集、限流、过滤名单等，按开源默认配置（master 分支 config.json）推断",
  "problem": "线上首页的 meta generator 是 \"Uguu 1.9.7\"，GitHub master 已经是 1.9.9。更关键的是，仓库默认配置（包括 v.1.9.7 标签）是 expireTime=8 hours、LOG_IP=false，而线上实际是 3 小时、FAQ 写明记录 IP。这说明线上配置和默认值明显不同，NAME_LENGTH=8、RATE_LIMIT=false、FILTER 名单这些推断的可信度比报告写的更低。",
  "correct_fact": "只有响应结构（JSON 的 files[].url = https://<FILE_DOMAIN>/<filename>）在 v.1.9.7 和 master 中一致，可以视为可靠；其余配置项一律当作未知。",
  "source_url": "https://raw.githubusercontent.com/nokonoko/Uguu/v.1.9.7/src/config.json"
 },
 {
  "claim": "（遗漏）uguu 的过期起算方式和去重行为没有说明",
  "problem": "源码可以回答过期起算点，但报告没写；另外漏掉了一个和重试有关的风险。",
  "correct_fact": "expireChecker.php 删除的条件是 date <= now - expireTime，所以过期从上传时刻起算，由定时任务执行，实际存活时间不少于 3 小时。如果线上开启了 ANTI_DUPE（默认关闭，线上未知），重复上传同一个文件会返回旧文件名，过期时间仍按第一次上传计算。返回 JSON 里的 dupe 字段能看出来是否命中去重。",
  "source_url": "https://github.com/nokonoko/Uguu/blob/master/src/Classes/expireChecker.php"
 },
 {
  "claim": "Litterbox 首页 HEAD 返回 405，说明首页不允许 HEAD",
  "problem": "表述不准确。正常 GET 响应头里写着 access-control-allow-methods: GET, HEAD, POST，而 405 响应带的是 nonce 型 CSP 和 require-trusted-types-for，和 BunkerWeb 生成的错误页同一形态。所以更可能是 WAF 层拦掉了 HEAD，而不是应用本身不支持。另外，405 在 BunkerWeb 默认规则里属于计入封禁的“坏状态码”。",
  "correct_fact": "litterbox.catbox.moe 的 HEAD 返回 405，推断是 BunkerWeb 拦截。拉取方或自检脚本反复发 HEAD 可能累积坏请求计数。",
  "source_url": "https://litterbox.catbox.moe/"
 },
 {
  "claim": "报告末尾 Sources 列出 docs.rs 和 npm 上的第三方库页面",
  "problem": "任务要求事实只能来自官方页面。报告正文虽然声明了没有把它们当依据，但放进 Sources 容易被误读成事实来源。",
  "correct_fact": "litter.catbox.moe 在所有官方页面中都没有出现（逐页 grep，命中数为 0），只能从 DNS 推断，应该只在 gaps 里说明。",
  "source_url": "https://litterbox.catbox.moe/tools.php"
 }
]

## gaps
- Litterbox 直链域名 litter.catbox.moe 在任何官方页面都没写明，只能从 DNS（与 litterbox 同IP）和第三方库推断
- Litterbox 没有官方样例文件，无法确认 mp4/mov 的 Content-Type、Accept-Ranges/206 支持以及 HEAD 行为（不存在文件的 HEAD 返回 404 text/html）
- Litterbox API 是否接受 fileNameLength 字段、默认值是多少（官方 tools 页未写，只在首页表单隐藏字段出现），以及 time 缺省时的默认值
- Litterbox 的过期时间是否从上传时刻起算，官方没说明
- Catbox 2026-04 的'限制数据中心/公共代理IP匿名上传'是否同样适用于 Litterbox，原文没区分；具体判定标准和是否影响住宅宽带走 VPN 的情况也未知
- Catbox/Litterbox 的商业使用边界：个人工具调用付费的 ModelArk API 是否算需要书面批准的商业用途，需向 admin@catbox.moe 确认
- Catbox 首页写 200 MB，但没说明是 MB 还是 MiB，和 Seedance 200MB 的口径是否一致不明
- Catbox 没有官方 mp4/mov 样例，无法验证视频 Content-Type；且 files.catbox.moe 对 HEAD 返回 content-length: 0、无 accept-ranges，与 GET 不一致，原因未知
- uguu.se 线上直链域名（FILE_DOMAIN）、文件名长度、是否启用限流、扩展名/MIME 过滤名单都没有官方说明（GitHub config.json 是开发值）
- uguu.se 没有线上样例文件，无法验证 video/mp4、video/quicktime 的 Content-Type 和 Range 支持（只能从官方 nginx 静态配置示例推断）
- uguu.se 没有找到独立的 ToS/AUP 页面，对自动化、商业、AI 内容的态度只能根据 FAQ 未作禁止来判断
- 三个站对来自 ModelArk 马来西亚柔佛（ap-southeast-1）数据中心 IP 的下载是否有限制，官方都没说明；Catbox 只列出了访问受阻的国家和ISP，马来西亚不在其中
- 本机（可能在中国大陆）直连这三个站的可达性没有官方信息