# MiniMax 订阅 Key 与按量 Key（2026-10-08 核对）

结论：两种 Key 调用**同一套接口**（`https://api.minimax.io`，同样的 `/v1/image_generation`、`/v2/video_generation`，同样用 `Authorization: Bearer <Key>`），区别只在 Key 类型和扣费方式。

## 原文要点

| 事实 | 来源 |
|---|---|
| 订阅 Key 前缀 `sk-cp-`，按量 Key 前缀 `sk-api-`，两者分开计费 | [MiniMax CLI](https://platform.minimax.io/docs/m-plan/minimax-cli.md) |
| 两种 Key 不能互换 | [M Plan FAQ](https://platform.minimax.io/docs/m-plan/faq.md)（Can the Subscription Key and the standard API Key be used interchangeably?） |
| 订阅 Key 调用按量计价的 API 接口时，按该接口单价从订阅额度扣；按量 Key 扣账户余额 | 同上；Token Plan 文档有同样表述：[Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq.md)、[Token Plan 概览](https://platform.minimax.io/docs/token-plan/intro.md) |
| 文档没有给订阅 Key 另配域名或请求头；订阅入门页示例用的也是 `api.minimax.io` | [Subscribe to M Plan](https://platform.minimax.io/docs/m-plan/quickstart.md) |
| M Plan：三档都含图像与音频；Explore、Build 含 H3 视频，Go 不含视频 | [M Plan 概览](https://platform.minimax.io/docs/m-plan/intro.md)、[M Plan FAQ](https://platform.minimax.io/docs/m-plan/faq.md) |
| 旧 Token Plan：含图像、语音，**不支持 MiniMax H3** | [Token Plan 概览](https://platform.minimax.io/docs/token-plan/intro.md) |
| 额度窗口：文本、图像、音频受 5 小时窗口 + 周窗口；视频只受周窗口 | [Usage](https://platform.minimax.io/docs/m-plan/usage-rules.md) |
| 查剩余额度：`GET https://www.minimax.io/v1/token_plan/remains`（注意域名是 `www.minimax.io`） | [M Plan FAQ](https://platform.minimax.io/docs/m-plan/faq.md)、[Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq.md) |

## 未明确（需实测）

- 文档只笼统说「按量计价的 API 接口」可用订阅 Key 扣额度，没有逐个点名 `/v2/video_generation`、`/v1/image_generation`。用订阅 Key 调 H3 是否成功，以真实调用为准。
- 额度用尽时的错误码：错误码页的 2056（usage limit exceeded，等下一个 5 小时窗口）最可能对应，但原文没写适用哪种 Key（推断）。
- 免费的 V2 List（我们用来"测试 Key"）能否用订阅 Key 调用，没有说明。

## 对平台的影响（待用户决定）

- 不需要新建服务商，同一个 MiniMax provider 即可。
- 可做：按前缀识别 Key 类型；订阅 Key 显示剩余额度（需要把 `www.minimax.io` 加进上游白名单）；费用预估注明「从订阅额度扣」；两种 Key 都存、提交时选用。
