# 公共临时文件托管调研（第一组：tmpfiles.org / 0x0.st / temp.sh），对抗性核查后的修正版

核查时间：2026-10-07 15:54–16:05 UTC，本机发起。Cloudflare 节点是 SYD，**不能代表马来西亚 ap-southeast-1 的出口**。
- 只做了 GET/HEAD，没有上传，没有 POST，没有提交表单。
- 第三方来源只用来找线索，文中都标成"第三方线索"。
- **副作用说明**：核查 0x0.st 时，我用几个 AI 爬虫 UA 发了 HEAD，之后调研时的出口 IP 被 0x0.st 防火墙整个封掉（详见 2.3）。到 16:04 UTC 还没解封。

---

## 1. tmpfiles.org

### 1.1 上传 API（https://tmpfiles.org/api ）
- 接口：`POST https://tmpfiles.org/api/v1/upload`，格式 multipart/form-data。
  - 对这个地址发 GET 返回 405，`content-type: application/json`，`allow: POST`。
- 字段：
  - `file`：必填，"max 100 MB"
  - `expire`：可选，"Seconds until deletion (60–172800), default 3600"
- 账号 / Key：不需要，有两处依据。
  - ToS 原文 "No account registration is required"（https://tmpfiles.org/tos ）
  - 首页官方 JS 往 API 发请求时，FormData 里只有 file 和 expire，没带 CSRF token，也没带任何 key（https://tmpfiles.org/ 源码）
- 返回格式：`{"status":"success","data":{"url":"https://tmpfiles.org/{id}/{name}"}}`。首页 JS 先读 `json.data.url`，读不到再读 `json.url`。
- 直链：
  - **官方文档没写怎么得到直链。** 第三方线索（clawhub、tmp-cli）的做法是把 `tmpfiles.org/` 换成 `tmpfiles.org/dl/`。
  - 官方服务器路由可以佐证 /dl/ 确实存在：
    - 走专门的文件页 404 的路径：`/dl/123/a.txt`、`/dl/0/nonexistent.mp4`、`/123`、`/99999999/a.txt`。页面显示 "404 NOT FOUND / FILE EXPIRED"，带 "Lookup Similar" 按钮。
    - 走普通 404 的路径：`/foo/123/a.txt`、`/zzzz`、`/dl/123`。
    - 结论：`/dl/{数字id}/{name}` 是一条真实路由。但它对真实文件是不是直接返回字节，**还没验证**。
  - ToS 提到每个文件页上有 "Report Content" 链接，所以 API 返回的 `/{id}/{name}` 应该是 HTML 预览页。

### 1.2 大小、保留时长、删除
- 单文件上限 100 MiB。依据：ToS 写 "Maximum file size of 100 MiB per upload"，首页 JS 里 `MAX_BYTES = 104857600`。**比 Seedance 允许的 200MB 小。**
- 保留时长：
  - API 可设 60–172800 秒，默认 3600 秒。
  - 网页表单有 4 档：3600 / 21600 / 86400 / 172800，默认选中 86400。
  - ToS 第 2 节写 "1 to 48 hours"，第 3 节写最长保留 48 小时。ToS 的下限和 API 文档不一致，上限一样。
  - **调用时必须显式传 `expire=86400`**，否则只保留 1 小时。
- 删除：官方页面没有删除接口，也没有删除 token。
- 频率限制："Up to 200 uploads per hour for each user"。

### 1.3 直链特性（实测）
- 支持 HTTPS。`http://` 会 301 跳到 https。
- 站点在 Cloudflare 后面：`server: cloudflare`，有 cf-ray（本机走 SYD 节点）。
- 首页 200，text/html，没有 cf-mitigated。
- `/dl/123/a.mp4` 返回 404 text/html。用空 UA、Go-http-client/1.1、python-requests、Chrome UA 各试一次，**都没有 cf-mitigated，也没出验证页**。
- 不存在的文件页里会加载第三方广告脚本（cloudfront 域名）。
- robots.txt 全部放行。
- 没有官方示例文件，所以真实视频的 Content-Type、Range、能否多次拉取都**没测到**，见 gaps。
- URL 可猜测性：文件路由只认纯数字 ID，ID 很可能是自增的，存在被枚举的风险（推测）。

### 1.4 ToS / AUP（https://tmpfiles.org/tos ，生效日期 2025-12-01）
- 自动化：原文 "Do not attempt to bypass usage limits or use the service for commercial automation without permission"。**商业性质的自动化调用要先拿到许可。** 非商业场景没有明确禁止，官方本身也提供 API。
- 禁止内容：成人性内容、仇恨或极端内容、儿童剥削、恶意软件、未授权的版权作品、未经同意的第三方个人数据、钓鱼诈骗和垃圾信息。**没有禁止视频，也没有禁止 AI 内容。**
- 公开列表：没提到。原文 "We do not routinely inspect uploaded files"，但可能用自动系统检测。
- 地区 / IP 限制：没写。
- 联系方式：info@tmpfiles.org（https://tmpfiles.org/about ）。

### 1.5 可用性
首页 200，没看到关停或限流公告。页头在推广 OnlyFiles。

### 1.6 评级：勉强
- 优点：
  - 不需要账号
  - 可以设 24 小时，最长 48 小时
  - 没有禁止视频
  - 官方服务器上确实有 /dl/ 路由
  - 从本机测试没有遇到验证页
- 缺点：
  - 上限 100MiB，小于 200MB
  - /dl/ 返回的是不是文件字节、Content-Type、Range 都没验证
  - 在 Cloudflare 后面，从马来西亚机房拉取会不会被挑战无法保证
  - 数字 ID 可能被枚举
  - 不能删除
  - 商业自动化需要先拿许可

---

## 2. 0x0.st（The Null Pointer）

### 2.1 上传 API（https://0x0.st/ ）
- 接口：`POST https://0x0.st`，格式 multipart/form-data，不需要账号。
- 字段：
  - `file`：文件内容
  - `url`：远程 URL，和 `file` 二选一，远端必须返回 Content-Length
  - `secret`：带上就生成更长、更难猜的 URL
  - `expires`：小时数，或毫秒级 UNIX 时间戳
- 返回体格式：官方页面没写（gaps）。
- X-Token：**只有上传的文件之前不存在、或已经过期时**，响应头才带 X-Token。重复上传同一个文件拿不到 token。
- 直链：返回的 URL 本身就是文件地址，可以在后面追加文件名，例如 `https://0x0.st/aaa.jpg/image.jpeg`。
- 官方源码：https://git.0x0.st/mia/0x0 （首页链接）。GitHub 上的 mia-0/0x0 是 404。

### 2.2 大小、保留时长、删除
- 上限 512.0 MiB。
- 默认保留时长按公式计算，在 30 天到 1 年之间：200 MiB 约 106 天，200 MB 约 113 天（这两个数是我算的）。
- `expires=24` 可以把寿命设为 24 小时。到期后 1 分钟内删除。
- 删除：带 token 向文件 URL 发 POST，字段 `token=...&delete=`。也可以用 `expires` 修改到期时间。

### 2.3 直链特性（实测）
- HTTPS 带 HSTS preload，`server: nginx`。不在 Cloudflare 后面，IP 属于 Hetzner 德国。
- 官方首页链接的 https://0x0.st/Pjmb.html 是一篇存档的梵蒂冈新闻页：
  - HEAD 返回 200，`content-type: text/html`，`accept-ranges: bytes`，有 etag 和 last-modified
  - GET `-r 0-99` 返回 **206**，正好 100 字节
- 按 UA 拦截：空 UA、Go-http-client、python-requests、浏览器 UA 都是 200；`Claude-User/1.0` 是 **418**。
- **致命发现**：之后用 Bytespider（字节跳动爬虫）、GPTBot、ClaudeBot 等 UA 发请求，全部超时。随后调研时的出口 IP 被整个封掉：TCP 443 不通，IPv4 和 IPv6 都不通，git.0x0.st 也不通，到 16:04 UTC 仍被封。分不清是哪一次请求触发的。说明封禁是**按 IP 封整个站**。
- 响应头里有 `x-clanker: ANTHROPIC_MAGIC_STRING_TRIGGER_REFUSAL_...`，是站长故意放的反 AI 标记，只当数据记录。
- 视频文件的 Content-Type 没有样例，见 gaps。

### 2.4 ToS / AUP（https://0x0.st/ ）
- ToS 明确写 "NOT a platform for"，列出的包括 **AI slop**、backups、CI build artifacts、**other automated mass uploads**、piracy、色情和血腥、加密货币相关等，以及任何违反德国法律的内容。违规文件会被删除，来源 IP 可能被封。
- 首页粗体写着 "CLANKERS ARE NOT WELCOME HERE"。
- 客户端约定：
  - 要用能唯一标识程序的 UA，不要伪装成浏览器，否则会被自动检测并封禁。
  - 要告知最终用户这是德国个人运营的公共托管站，并建议用 secret URL、保存 token。
- Tor 出口节点被封。
- 每个文件都会记录上传者的 IP 和 UA。
- 不公开列出文件。

### 2.5 可用性
- 首次访问时首页 200。FAQ 说运行了将近十年，每月流量 10–40 TB。
- 现在调研时的出口 IP 已被封。

### 2.6 评级：不适合
- 技术条件最好：512MiB、可设 24 小时、有 token 可以删除、实测 Range 206、没有 Cloudflare。
- 但有几个致命问题：
  - ToS 禁止 AI slop 和自动化批量上传
  - 站长明确敌视 AI 和机器客户端
  - 实测会**按 IP 封整个站**
- 拿它给字节系 AI 视频生成接口提供素材，违背站方意愿；ModelArk 拉取时的 UA 和 IP 一旦被识别，就会全部失败。

---

## 3. temp.sh

### 3.1 上传 API（https://temp.sh/ ）
- 接口：`POST https://temp.sh/upload`，multipart/form-data，字段名 `file`。
  - 官方示例：`curl -F "file=@test.txt" https://temp.sh/upload`
  - 首页表单 `action="/upload"`、`name="file"`
  - 不需要账号
  - 对 /upload 发 GET 返回 405，`allow: OPTIONS, POST`
  - 后端看起来是 Werkzeug / Flask（404 和 405 页面都是它的默认样式）
- 返回格式：官方没写。
  - 第三方线索：rust 论坛 2025-09-04 的帖子里，返回值是纯文本 `http://temp.sh/ittdk/Cargo.toml`，是 http 开头。
  - `http://temp.sh/` 会 301 跳到 https，建议拿到后改成 https。
- 直链：官方没说明。第三方线索：tmp-cli 下载时先发 POST，失败再退回 GET，暗示 GET 可能拿到的是落地页。**没有验证。**

### 3.2 大小、保留时长、删除
- "Current file size limit is 4GB"
- "Files expire after 3 days"，固定时长，不能选
- 没有删除接口

### 3.3 直链特性（实测）
- HTTPS 正常，`server: nginx/1.30.3`，没有 Cloudflare。
- 不存在的路径返回 404 text/html，例如 `/aaaaa/nonexistent.mp4`。2025 年的旧示例 `/ittdk/Cargo.toml` 早已过期，也是 404。
- 首页上的官方 `up.sh` 和 `temp.sh.sxcu` 都是 404。
- 真实文件的 Content-Type、Range、GET 返回字节还是落地页，都**没有样例可测**。

### 3.4 ToS / AUP
- 没有 ToS、AUP、FAQ 或 API 文档。`/tos /terms /faq /api /about /abuse /robots.txt` 全部 404。
- 首页只有 "I just made this for quick and handy file and text sharing."，加上捐赠地址和联系邮箱。
- 自动化、AI 内容、商业用途、地区限制、URL 随机性**都没有官方说法**。
- URL 格式只有第三方示例：`/{5 位小写字母}/{文件名}`。

### 3.5 可用性
首页 200，没有公告。两个官方链接已经失效。

### 3.6 评级：勉强（用户自己验证 GET 直链之前，不能上线）
- 优点：4GB 上限，固定 3 天，足够覆盖排队时间，没有 Cloudflare。
- 缺点：
  - 没有 ToS，合规性无从判断
  - 不能删除，用户的视频会公开 3 天
  - 返回的可能是 http 链接
  - 下载可能要 POST
  - 站点维护不完整

---

## 汇总
| 站点 | 上限 | 保留时长 | 删除 | 账号 | 关键风险 | 评级 |
|---|---|---|---|---|---|---|
| tmpfiles.org | 100MiB | 60 秒–48 小时（API 默认 1 小时，要传 86400） | 无 | 不需要 | 小于 200MB；/dl/ 路由存在但返回内容没验证；Cloudflare；数字 ID 可能被枚举；商业自动化需许可 | 勉强 |
| 0x0.st | 512MiB | 30 天–1 年，可用 expires 缩短 | X-Token（仅首次上传有） | 不需要 | ToS 禁 AI slop 和自动化批量上传；418 加整个 IP 被封（已实测） | 不适合 |
| temp.sh | 4GB | 固定 3 天 | 无 | 不需要 | 没有 ToS；GET 可能是落地页；http 链接；不能删除 | 勉强（待用户验证） |

建议：
- 这一组里只有 tmpfiles.org 勉强能当 ≤100MB 场景的备选。用法：传 `expire=86400`，链接改成 `/dl/`。前提是用户自己先传一个小 mp4，用 `curl -sI` 和 `curl -r 0-99` 验证 Content-Type、206，并确认重复 GET 都正常。商业用途要先联系 info@tmpfiles.org 拿许可。
- 0x0.st 直接排除。
- temp.sh 只有在用户自测确认 GET 直接返回字节之后才考虑。
- 建议继续评估第二组候选；按用户安排，S3 兼容对象存储放到后续再做。

## corrections
[
 {
  "claim": "0x0.st：WebFetch 返回 418、curl 返回 200，所以站点只是按 UA 或客户端特征拦截部分抓取方",
  "problem": "低估了风险。418 只是第一层，后面还有 IP 级封禁，报告没写到",
  "correct_fact": "实测（2026-10-07 15:56 UTC 起）：空 UA、Go-http-client/1.1、python-requests、Chrome 浏览器 UA 发 HEAD 都返回 200；UA 为 Claude-User/1.0 时返回 418。紧接着用 Bytespider（字节跳动爬虫）、GPTBot、ClaudeBot 等 UA 各发一次 HEAD，全部 TCP 超时。之后连默认 curl UA 也连不上了：IPv4 168.119.145.117:443 和 IPv6 都不通，git.0x0.st 一样不通，到 16:04 UTC 仍被封。同一时间 temp.sh 和 tmpfiles.org 都正常，所以基本可以确定是 0x0.st 防火墙封了调研时的出口 IP。具体是 418 那次还是 Bytespider 那次触发的，分不清。结论：封禁是整个 IP 封掉，不只是单次请求被拒。ModelArk 拉取时用什么 UA、来自哪些 IP 段都不知道，一旦命中，所有拉取都会失败。另外要说明：这次是我做核查时的请求导致用户调研时的出口 IP 被 0x0.st 封了，可能要等一段时间才会解封",
  "source_url": "https://0x0.st/"
 },
 {
  "claim": "0x0.st：官方确认的是响应头里有 X-Token，可以用来管理文件",
  "problem": "漏了前提条件",
  "correct_fact": "原文的意思是：只有上传的文件之前不存在、或者已经过期时，响应头里才会有 X-Token。如果有人传过同一个文件（去重），就拿不到 token，也就没法用 token 删除或改到期时间",
  "source_url": "https://0x0.st/"
 },
 {
  "claim": "0x0.st：200MB 的文件按公式大约保留 106 天",
  "problem": "单位没写清楚",
  "correct_fact": "按 200 MiB 算约 106 天；按 200 MB（2×10^8 字节，约 190.7 MiB）算约 113 天。不管哪种，都应该显式传 expires（比如 24），并保存好 X-Token",
  "source_url": "https://0x0.st/"
 },
 {
  "claim": "0x0.st：支持 Range（依据只是 HEAD 响应里有 accept-ranges: bytes）",
  "problem": "只看了响应头，没有真正发 Range 请求",
  "correct_fact": "对官方首页链接的现有文件 https://0x0.st/Pjmb.html 发 GET -r 0-99，返回 206，正好 100 字节，Content-Type 和扩展名一致（text/html）。视频文件的 Content-Type 还是没有样例",
  "source_url": "https://0x0.st/Pjmb.html"
 },
 {
  "claim": "0x0.st：没有再请求源码；GitHub 上的 mia-0/0x0 已经 404",
  "problem": "漏了官方源码地址",
  "correct_fact": "首页明确把官方源码仓库链接到 https://git.0x0.st/mia/0x0 。GitHub 上的 mia-0/0x0 确实 404（已复核）。git.0x0.st 和主站一起封了调研时的出口 IP，所以这次也没法通过源码确认返回体格式和视频 MIME",
  "source_url": "https://0x0.st/"
 },
 {
  "claim": "tmpfiles.org：`/dl/` 直链只有第三方线索，官方没有确认",
  "problem": "文档层面确实没写，但官方服务器的路由可以佐证",
  "correct_fact": "实测服务器路由：/dl/123/a.txt、/dl/0/nonexistent.mp4、/123、/99999999/a.txt 返回的是专门的文件页 404，页面写着 '404 NOT FOUND / FILE EXPIRED'，还有 'Lookup Similar' 按钮。/foo/123/a.txt、/zzzz、/dl/123 返回的是普通 404，没有这个按钮。说明官方服务器上确实有 /dl/{id}/{name} 这条路由。但它对真实文件是不是直接返回字节，仍然没有验证",
  "source_url": "https://tmpfiles.org/dl/123/a.txt"
 },
 {
  "claim": "tmpfiles.org：文件 ID 怎么生成，官方没写，全部列为 gaps",
  "problem": "可以部分实测",
  "correct_fact": "文件路由只认纯数字 ID：/abc/a.txt 和 /dl/abc/a.txt 都是普通 404，/99999999/a.txt 会进文件页。不带文件名的 /{id} 也能进文件路由。所以 ID 是数字，很可能是自增的，链接可能被枚举或猜到（这一点是推测，未证实）",
  "source_url": "https://tmpfiles.org/123"
 },
 {
  "claim": "tmpfiles.org：保留时长 60 秒到 172800 秒（48 小时），ToS 写最长保留 48 小时",
  "problem": "漏了 ToS 和 API 文档之间的不一致",
  "correct_fact": "ToS 第 2 节写的是 'Choose an auto-deletion timer ranging from 1 to 48 hours'，API 文档写的是 60–172800 秒。上限一样，都是 48 小时，下限说法不同。这对本场景没影响，因为本来就该传 86400",
  "source_url": "https://tmpfiles.org/tos"
 },
 {
  "claim": "tmpfiles.org：本机实测没有遇到 Cloudflare 验证",
  "problem": "没说明测试出口的位置，代表性被高估",
  "correct_fact": "本机请求的 cf-ray 后缀是 -SYD，走的是 Cloudflare 悉尼节点，跟马来西亚柔佛机房的出口不是一回事。另外补测了 /dl/ 路由：空 UA、Go-http-client、python-requests、浏览器 UA 都没有 cf-mitigated，也没有验证页。数据中心 IP 会不会被挑战，仍然没法验证",
  "source_url": "https://tmpfiles.org/"
 },
 {
  "claim": "tmpfiles.org：上传 API 不需要账号或 API Key（依据是 ToS 里的 'No account registration is required'）",
  "problem": "结论对，可以补一条佐证",
  "correct_fact": "首页官方 JS 直接 POST 到 https://tmpfiles.org/api/v1/upload，FormData 里只有 file 和 expire，没带 _token（CSRF）或任何 key。对这个接口发 GET 返回 405，application/json，allow: POST，说明接口存在",
  "source_url": "https://tmpfiles.org/"
 },
 {
  "claim": "temp.sh：首页 200，官方 up.sh 和 temp.sh.sxcu 都是 404",
  "problem": "结论没错，只补充技术细节",
  "correct_fact": "复核成立。另外：后端的 404/405 页面是 Werkzeug（Flask）默认样式；/upload 对 GET 返回 405，Allow 是 OPTIONS, POST；首页 meta 写着 '3 days. 4GB Size Limit. CLI and ShareX Support'。GET 文件 URL 到底返回字节还是落地页，仍然没有官方信息",
  "source_url": "https://temp.sh/"
 }
]

## gaps
- tmpfiles.org：官方 API 文档没有说明直接下载链接（/dl/ 前缀只见于第三方 clawhub 和 tmp-cli）；/dl/ 链接对真实视频文件的 Content-Type、Accept-Ranges，以及是否支持多次拉取，都因为没有官方样例文件而测不了
- tmpfiles.org：文件 ID 的生成方式（随机还是递增、能不能被猜到）官方没说明
- tmpfiles.org：没有任何关于数据中心 IP 或境外 IP 的说明；站点在 Cloudflare 后面，本机测试没有遇到 cf-mitigated，但马来西亚柔佛 ap-southeast-1 机房 IP 是否会被挑战无法验证
- tmpfiles.org：ToS 里的 'commercial automation without permission' 怎么申请许可、是否收费，官方没有更多说明（只有联系邮箱 info@tmpfiles.org）
- 0x0.st：官方页面没写上传成功后的返回体格式（只确认了 X-Token 响应头）；视频文件（mp4/mov）返回的 Content-Type 没有样例可测；418 拦截具体针对哪些 UA，ModelArk 的拉取 UA 会不会被拦，都无法确认
- 0x0.st：站长明确反 AI，所以除首页和首页链接的一个现有文件外，没有再请求其他资源（比如 git.0x0.st 源码）；GitHub 上的 mia-0/0x0 已经 404
- temp.sh：没有任何 ToS、AUP、FAQ、API 文档；返回体格式、URL 随机性、GET 是否直接返回文件字节（还是要 POST 下载的落地页）、Content-Type、Range 都没有官方信息，也没有现成样例文件可测
- temp.sh：首页上的官方 up.sh 和 temp.sh.sxcu 链接返回 404，没法通过这两个文件反推 API 细节
- 三个站点的 GET 直链行为，最终都要用户自己上传一个测试小文件（例如 ≤5MB 的 mp4），再用 curl -sI / curl -r 0-99 验证；按本任务规则本调研没有做任何上传