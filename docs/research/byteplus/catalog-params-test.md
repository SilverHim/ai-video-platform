# Seedream 目录元数据参数实测与 Endpoint 内容过滤（2026-10-08）

## 1. 背景：两份 BytePlus 资料互相矛盾

`arkcli models get <model>` 返回的模型目录元数据（`supported_params`）给 Seedream 5.0 pro（260628）和 5.0 flash（260915）列了下面这些 `support=true` 的参数。5.0 lite（260128）没有；4.5、4.0 的目录是空（null）。

| 参数 | 目录元数据 | API 文档正文 + 官方 OpenAPI 合约（`arkcli docs apis spec --id image-generation-ImageGenerations_generate`） |
|---|---|---|
| `negative_prompt`（默认 `nsfw`） | 有 | 没有 |
| `seed`（[-1, 2147483647]，默认 -1） | 有 | 没有 |
| `optimize_prompt`（布尔，默认 true） | 有 | 没有（合约只有 `optimize_prompt_options.mode`） |
| `layer_image` / `layer_size` | 有 | 没有（合约是 `image` + `layer_decomposition: true` + `size`） |
| pro / flash 的 `stream` | 支持 | 正文写不支持 |

目录元数据本身也有明显错误：`api_support` 显示 5.0 pro 不支持 Image Generation，flash 却显示支持。

## 2. 实测（真实计费，用户确认后执行）

- 模型：`dola-seedream-5-0-flash-260915`，经 Endpoint `seedream-5-0-flash-nofilter` 调用（内容过滤关闭，见第 3 节）
- 请求：1K、`seed: 42`、`negative_prompt: "text, watermark"`、`optimize_prompt: false`（这时不发送 `optimize_prompt_options`），提示词是「橘猫坐在窗台、窗外下雨的街道、水彩」
- 同样的请求连发 2 次，费用约 $0.036

| 结论 | 依据 |
|---|---|
| 三个字段都**被接受**（HTTP 200，没有参数错误） | 两次都成功出图 |
| **seed 能复现结果** | 两张图字节不同，但 SSIM 0.9989、PSNR 48.1 dB（ffmpeg），构图和细节一致，差异只在 JPEG 噪点级别 |
| negative_prompt 的效果**未验证** | 背景招牌上仍有文字；这次的设计没法判断它有没有生效 |
| optimize_prompt=false 的效果**未验证** | 只确认会被接受 |

没做的对照组：同样的请求不带 seed 发两次，看是否不同，用来排除「flash 本来就是确定性输出」。Seedream 平常每次出图都不一样，所以目前判定 seed 生效。

图层分解的 `layer_image` / `layer_size` 没有测：它和官方合约的写法冲突，继续用官方写法。

处理：`seed` 转为正式参数；`negative_prompt`、`optimize_prompt` 保留「实验」。三者都只对 5.0 pro / flash 开放，图层分解模式不开放，默认不发送。

## 3. Endpoint 的内容过滤（Content filter）

- 官方文档（[ModelArk Content filter overview](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/Content_Pre-filter)）：按 Endpoint 设置，新建时默认开启，可以在创建或编辑时开关，修改立即生效；关闭后平台**仍保留基础内容安全策略**；不管开不开，都要遵守 BytePlus GenAI Acceptable Use Policy。
- 文档只写了控制台按钮，没写对应的接口取值。`arkcli +deploy --moderation` 的 Strategy 可选 `Basic` / `Customized` / `Default` / `Skip`，含义也没有文档说明。
- **实物对照**：用户在控制台建了一个关闭 Content filter 的 Endpoint，`arkcli infer endpoint get` 回读到 `Moderation.Strategy = "Skip"`。之后用 `arkcli +deploy --moderation '{"Strategy": "Skip"}'` 建了 flash 的 Endpoint，回读结果相同。所以「关闭内容过滤」在接口里就是 `Moderation.Strategy = Skip`。
- 管理 Endpoint 属于控制面，要用账号身份（SSO 或 AK/SK）；生成调用属于数据面，用 API Key，把请求里的 `model` 换成 `ep-…` 即可。
