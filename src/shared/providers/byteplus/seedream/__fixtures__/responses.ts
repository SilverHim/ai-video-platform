/**
 * Seedream 响应样例。
 * - OFFICIAL_*：官方文档原样摘录（revision 265，2026-10-08 读取），注明出处；
 * - CONSTRUCTED_* / 其余：原文没有对应样例，按报告字段构造；message 统一以 "constructed:" 开头。
 */

/** [A] image-generation-api「Interactive editing > cURL > Response」（报告 image-api.md §4 同；usage 与公式对不上，只作演示） */
export const OFFICIAL_SYNC_PRO = `{
    "model": "dola-seedream-5-0-pro-260628",
    "created": 1757323224,
    "data": [
        {
            "url": "https://...",
            "size": "2048x2048"
        }
    ],
    "usage": {
        "generated_images": 1,
        "output_tokens": 18000,
        "total_tokens": 18000
    }
}`;

/** [A]「Text-to-Image > cURL > Response」：size=2K 实际返回 1760x2368，不在参考尺寸表里 */
export const OFFICIAL_T2I_PRO = `{
    "model": "dola-seedream-5-0-pro-260628",
    "created": 1757323224,
    "data": [
        {
            "url": "https://...",
            "size": "1760x2368"
        }
    ],
    "usage": {
        "generated_images": 1,
        "output_tokens": 16280,
        "total_tokens": 16280
    }
}`;

/** [A]「Multi-Reference Image-to-Batch-Image > cURL > Response」：lite 组图 3 张（请求带 output_format=png，响应未回 output_format） */
export const OFFICIAL_GROUP_LITE = `{
  "model": "seedream-5-0-260128",
  "created": 1757388756,
  "data": [
    {
      "url": "https://...",
      "size": "2720x1536"
    },
    {
      "url": "https://...",
      "size": "2720x1536"
    },
    {
      "url": "https://...",
      "size": "2720x1536"
    }
  ],
  "usage": {
    "generated_images": 3,
    "output_tokens": 48960,
    "total_tokens": 48960
  }
}`;

/**
 * [A]「Layer decomposition > cURL > Response」（Python/Java/Go/OpenAI 同一份）。
 * 原文 data 只列了底图和 1 个图层，usage.generated_images 却是 8：文档示例做了截断。
 */
export const OFFICIAL_LAYER_PRO = `{
    "model": "dola-seedream-5-0-pro-260628",
    "created": 1784696685,
    "data": [
        {
            "url": "https://...",
            "size": "2048x2048",
            "output_format": "jpeg",
            "z_index": 0
        },
        {
            "url": "https://...",
            "size": "1273x265",
            "output_format": "png",
            "z_index": 1,
            "bounding_box": {
                "absolute": [383, 120, 1655, 384],
                "normalized": [187, 59, 808, 188]
            },
            "name": "Seedream title text",
            "description": "Large yellow Seedream title text in a serif font"
        }
    ],
    "usage": {
        "input_images": 1,
        "generated_images": 8,
        "output_tokens": 23107,
        "total_tokens": 23107
    }
}`;

/** 实测 401（docs/research/byteplus/platform-cors.md §3） */
export const OFFICIAL_401 = `{"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid. request id: ...","param":"","type":"Unauthorized"}}`;

/** 构造：组图第 2 张被审核拦截（data[].error），其余成功；原文没有组图部分失败样例 */
export const GROUP_PARTIAL = JSON.stringify({
  model: 'seedream-5-0-260128',
  created: 1757323224,
  data: [
    { url: 'https://example.invalid/0.jpeg', size: '2720x1536' },
    { error: { code: 'OutputImageSensitiveContentDetected', message: 'constructed: output image blocked by moderation' } },
    { url: 'https://example.invalid/2.jpeg', size: '2720x1536' },
  ],
  usage: { generated_images: 2, output_tokens: 32640, total_tokens: 32640 },
});

/** 构造：组图第 1 张就遇到内部错误，后续不再生成 */
export const GROUP_ALL_FAILED = JSON.stringify({
  model: 'seedream-4-0-250828',
  created: 1757323224,
  data: [{ error: { code: 'InternalServiceError', message: 'constructed: internal error' } }],
  usage: { generated_images: 0, output_tokens: 0, total_tokens: 0 },
});

/** 构造：b64_json 返回 */
export const B64 = JSON.stringify({
  model: 'dola-seedream-5-0-flash-260915',
  created: 1757323224,
  data: [{ b64_json: 'iVBORw0KGgo=', size: '1024x1024', output_format: 'png' }],
  usage: { generated_images: 1, output_tokens: 4096, total_tokens: 4096 },
});

/** 构造：一张图都没生成时的顶层 error */
export const TOP_LEVEL_ERROR = JSON.stringify({ error: { code: 'InvalidParameter', message: 'constructed: invalid size. Request ID: 0217abc123def4567' } });

/**
 * [A]「Streaming Output > cURL > Response」逐字摘录。
 * 文档展示格式：data: 之后的 JSON 续行没有 "data:" 前缀，按 SSE 规范解析会丢掉续行，不是合法帧。
 */
export const OFFICIAL_STREAM_DOC = `event: image_generation.partial_succeeded
data: {
  "type": "image_generation.partial_succeeded",
  "model": "seedream-5-0-260128",
  "created": 1757396757,
  "image_index": 0,
  "url": "https://...",
  "size": "2496x1664"
}

event: image_generation.partial_succeeded
data: {
  "type": "image_generation.partial_succeeded",
  "model": "seedream-5-0-260128",
  "created": 1757396785,
  "image_index": 1,
  "url": "https://...",
  "size": "2496x1664"
}

event: image_generation.partial_succeeded
data: {
  "type": "image_generation.partial_succeeded",
  "model": "seedream-5-0-260128",
  "created": 1757396825,
  "image_index": 2,
  "url": "https://...",
  "size": "2496x1664"
}

event: image_generation.completed
data: {
  "type": "image_generation.completed",
  "model": "seedream-5-0-260128",
  "created": 1757396825,
  "usage": {
    "generated_images": 3,
    "output_tokens": 48672,
    "total_tokens": 48672
  }
}

data: [DONE]`;

/** 未核实：线上帧格式。把文档样例机械转成规范 SSE（JSON 续行补 "data: " 前缀），内容不变 */
export const OFFICIAL_STREAM_SSE = OFFICIAL_STREAM_DOC.split('\n')
  .map((l) => (l === '' || /^(event|data):/.test(l) ? l : `data: ${l}`))
  .join('\n');

/** [B] image-generation-streaming-responses「image_generation.partial_failed response example」 */
export const OFFICIAL_EVENT_PARTIAL_FAILED = `{
  "type": "image_generation.partial_failed",
  "model": "seedream-5-0-260128",
  "created": 1589478378,
  "image_index": 2,
  "error": {
    "code": "OutputImageSensitiveContentDetected",
    "message": "The request failed because the output image may contain sensitive information."
  }
}`;

/** [B]「image_generation.completed response example」 */
export const OFFICIAL_EVENT_COMPLETED = `{
  "type": "image_generation.completed",
  "model": "seedream-5-0-260128",
  "created": 1589478378,
  "usage": {
    "generated_images": 2,
    "output_tokens": 16280,
    "total_tokens": 16280
  }
}`;

/**
 * [B]「error response example」原文只是片段 "error": {...}；按字段路径 error.error.code 补外层 {}。
 * message 里的 Request ID 是占位符 {id}。
 */
export const OFFICIAL_STREAM_ERROR = `{"error": {
  "code": "BadRequest",
  "message": "The request failed because it is missing one or multiple required parameters. Request ID: {id}"
}}`;
