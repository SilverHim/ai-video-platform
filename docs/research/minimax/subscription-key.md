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

## 实测（2026-10-08，用户的 M Plan 订阅 Key 与按量 Key）

- 两个 Key 的免费测试都通过：按量 Key 调 V2 视频任务列表返回 200；订阅 Key 调剩余额度接口返回 200。
- 剩余额度接口 `GET https://www.minimax.io/v1/token_plan/remains` 的真实返回（文档未写）：

  ```json
  { "model_remains": [ { "model_name": "general",
      "start_time": 1791447773879, "end_time": 1791465773879, "remains_time": 17999990,
      "current_interval_remaining_percent": 100, "current_interval_status": 1,
      "current_interval_total_count": 0, "current_interval_usage_count": 0,
      "weekly_start_time": 1791369726171, "weekly_end_time": 1791974526171, "weekly_remains_time": 526752282,
      "current_weekly_remaining_percent": 1, "current_weekly_status": 1,
      "current_weekly_total_count": 0, "current_weekly_usage_count": 0 } ],
    "base_resp": { "status_code": 0, "status_msg": "success" } }
  ```

  按字段名推断：`start_time` / `end_time` 是 5 小时窗口起止（毫秒），`remains_time` 是距窗口结束的毫秒数，`*_remaining_percent` 是剩余百分比；`weekly_*` 是周窗口。`*_count` 都是 0，含义不明。这次只返回了一项 `general`，有视频额度的档位是否另有一项未知。平台按这个结构显示，并注明「字段含义按实测推断，以控制台用量条为准」。

- **订阅 Key 调生成接口可用**（2026-10-08，image-01 文生图 1 张，用户确认后执行）：`/v1/image_generation` 用订阅 Key 返回成功；之后剩余额度的 5 小时窗口从 100% 降到 99%，并开始倒计时（窗口从第一次使用起算），周窗口不变。说明确实从订阅额度扣，也印证了 `current_interval_remaining_percent` 的含义。
- image-01 返回的图片链接是阿里云 OSS 的 **http** 签名链接（`http://…oss-us-east-1.aliyuncs.com/…?Expires=…&OSSAccessKeyId=…&Signature=…`）。平台只允许 https 下载，改为把 http 升级成 https 再下（OSS 支持 https，签名不含协议），实测下载成功。

## 未明确（需实测）

- 文档只笼统说「按量计价的 API 接口」可用订阅 Key 扣额度，没有逐个点名。`/v1/image_generation` 已实测可用；`/v2/video_generation`（H3）用订阅 Key 是否成功尚未实测。
- 额度用尽时的错误码：错误码页的 2056（usage limit exceeded，等下一个 5 小时窗口）最可能对应，但原文没写适用哪种 Key（推断）。
- 免费的 V2 List（我们用来"测试 Key"）能否用订阅 Key 调用，没有说明。

## 对平台的影响（待用户决定）

- 不需要新建服务商，同一个 MiniMax provider 即可。
- 可做：按前缀识别 Key 类型；订阅 Key 显示剩余额度（需要把 `www.minimax.io` 加进上游白名单）；费用预估注明「从订阅额度扣」；两种 Key 都存、提交时选用。
