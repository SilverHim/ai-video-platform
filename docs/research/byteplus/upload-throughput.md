# 本地参考图内联与上传速度（2026-10-10 实测）

起因：MCP 提交 Seedance 2.5 时，两张 2752×1536 PNG（7.7 MB / 7.1 MB）按 base64 内联，请求体约 19.8 MB，提交一次 2–7 分钟；同样的素材改填 https 链接时请求体 1.6 KB，6 秒完成。

## 官方文档（BytePlus ModelArk，rev 298）

- Seedance 的图片（首帧、尾帧、参考图）只能用三种写法：公网 URL、`data:image/<小写格式>;base64,...`、`asset://<ASSET_ID>`。原文："Accepts image URL, Base64-encoded image, or asset ID."（create-video-generation-task-api）
- 单张图片小于 30 MB，请求体不超过 64 MB；"Do not use Base64 encoding for large files."（large 没有给阈值）
- Files API 只用于理解类接口（Responses / Chat API 用 file_id），生成接口的正文和 OpenAPI 合约里都没有 file_id；file 对象也不返回下载链接。私有素材库只收经过真人核验的肖像。所以没有官方的"先上传、再在生成里引用"通道。
- Seedance 2.5 提示词指南：用高分辨率 AI 生成图做参考时，密集纹理处可能出现指纹状纹理，建议 "Resize the input image so that it does not exceed the output video resolution."

## 到 BytePlus 的上传速度

方法：同样 18.9 MB 的请求体（内联那两张图）发到 `POST /contents/generations/tasks`，`model` 填一个不存在的名字。服务端读完请求体后返回 404 `InvalidEndpointOrModel.NotFound`，不建任务。请求体分片发送（256 KB 一片，带 Content-Length），按片被拉取的时间计速。

| 协议 | 上传用时 | 速度 |
|---|---|---|
| HTTP/1.1 | 85.7 s | 226 KB/s |
| HTTP/2 | 165.7 s | 117 KB/s |
| HTTP/1.1 | 113.8 s | 170 KB/s |

- 三次服务端都读完了整个请求体才响应：分片请求体加 Content-Length 在 HTTP/1.1 和 HTTP/2 下都被接受。
- 连接握手显示 BytePlus 的 HTTP/2 每流初始窗口 65,535 B、往返约 0.26–0.40 s，单流上限约 160–250 KB/s；HTTP/1.1 走 TCP 窗口，略快但同样受这条链路限制。
- 结论：改走 HTTP/1.1 只能快 1.5–2 倍，大请求体仍然要按分钟计；根本办法是不内联。

## 到临时托管站的上传速度

方法：随机噪点 PNG（每张 7.8 MB，内容无意义），用平台自己的上传实现（含直链自检）。

| 目标 | 用时 | 速度 |
|---|---|---|
| uguu.se 单张 | 17.3 s | 462 KB/s |
| uguu.se 两张并行 | 26.4 s（合计） | 约 590 KB/s |
| tmpfiles.org 单张 | 上传 9.1 s 后直链自检失败：直链返回网页（中间页或人机验证） | — |

## 采用的做法

- BytePlus 的本地图片：同意公开上传时先传到托管站，请求里只放链接；不同意就按 base64 内联照常提交，并提示可以同意以加快。本地视频仍然必须同意。
- 多个文件并行上传，同一文件只传一次；托管链接在有效期内复用。
- 本地文件与同一服务商的历史结果哈希相同、原始链接剩余 3 小时以上时，直接用原始链接。
- 超过 1 MB 的请求体分片发送并改走 HTTP/1.1，报上传进度；上传停滞 60 秒中止（请求没发完 → 失败、可重试），发完后再按接口超时等响应（超时 → 提交结果未知）。
- 请求体超过 5 MB 时预览给出警告。
