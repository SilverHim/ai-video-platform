/**
 * 官方文档示例原样摘录（arkcli docs get 读取，docs revision 265，2026-10-08）。
 * 文本保持原样（含原文缩进与占位 ID），测试里 JSON.parse 后使用。
 */

/** 查询任务成功响应（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/get-video-generation-task-api，Code samples / Default / cURL Response） */
export const OFFICIAL_GET_SUCCEEDED_20 = `{
  "id": "cgt-2025******-****",
  "model": "dreamina-seedance-2-0-260128",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/xxx"
  },
  "usage": {
    "completion_tokens": 108900,
    "total_tokens": 108900
  },
  "created_at": 1743414619,
  "updated_at": 1743414673,
  "seed": 10,
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 5,
  "framespersecond": 24,
  "service_tier":"default",
  "execution_expires_after":172800,
  "generate_audio":true,
  "draft":false,
  "priority": 0
}`;

/** 1.5 pro 常规请求体（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/create-video-generation-task-api，Parameter input methods / Conventional method） */
export const OFFICIAL_CREATE_15 = `{
    "model": "seedance-1-5-pro-251215",
    "content": [
        {
            "type": "text",
            "text": "The kitten is yawning at the camera."
        }
    ],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 5,
    "seed": 11,
    "camera_fixed": false,
    "watermark": true
}`;

/** 1.5 pro 旧写法请求体（同上，Weak-validation method） */
export const OFFICIAL_CREATE_15_LEGACY = `{
    "model": "seedance-1-5-pro-251215",
    "content": [
        {
            "type": "text",
            "text": "The kitten is yawning at the camera. --rs 720p --rt 16:9 --dur 5 --seed 11 --cf false --wm true"
        }
    ]
}`;

/** 2.5 首尾帧请求体（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5#2.5_first-last-frame，cURL） */
export const OFFICIAL_S25_FIRST_LAST = `{
    "model": "dreamina-seedance-2-5-260628",
    "content": [
        {
            "type": "text",
            "text": "A strawberry sandwich cookie slowly completes one full rotation while the camera moves smoothly around it and keeps the product centered."
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://arkdocs-en.tos-ap-southeast-1.volces.com/images/video-generation/seedance2.5_reference1.png"
            },
            "role": "first_frame"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://arkdocs-en.tos-ap-southeast-1.volces.com/images/video-generation/seedance2.5_reference1.png"
            },
            "role": "last_frame"
        }
    ],
    "generate_audio": true,
    "ratio": "adaptive",
    "duration": 5
}`;

/** 2.5 编辑请求体，未指定 omni_reference_task_type（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5#2.5_edit，cURL） */
export const OFFICIAL_S25_EDIT_AUTO = `{
    "model": "dreamina-seedance-2-5-260628",
    "content": [
        {
            "type": "text",
            "text": "Video edit: remove everyone in @Video1 except the protagonist."
        },
        {
            "type": "video_url",
            "video_url": {
                "url": "https://arkdocs-en.tos-ap-southeast-1.volces.com/videos/video-generation/seedance2.5_edit_input.mov"
            },
            "role": "reference_video"
        }
    ],
    "generate_audio": true,
    "ratio": "adaptive",
    "duration": -1,
    "output_format": "mov"
}`;

/** 2.5 样片第 1 步（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/seedance-2-5#2.5_draft_mode，Step 1 cURL）；首帧图没写 role */
export const OFFICIAL_S25_DRAFT_STEP1 = `{
        "model": "dreamina-seedance-2-5-260628",
        "content": [
          {
            "type": "text",
            "text": "A girl holds a fox. She opens her eyes and looks gently at the camera as the camera slowly pulls back."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/i2v_foxrgirl.png"
            }
          }
        ],
        "duration": 5,
        "ratio": "adaptive",
        "resolution": "480p",
        "output_format": "mov",
        "service_tier": "default",
        "draft": true
      }`;

/** 2.5 样片第 2 步（同上，Step 2 cURL）；显式带了 resolution 1080p */
export const OFFICIAL_S25_DRAFT_STEP2 = `{
        "model": "dreamina-seedance-2-5-260628",
        "content": [
          {
            "type": "draft_task",
            "draft_task": {
              "id": "<DRAFT_TASK_ID>"
            }
          }
        ],
        "resolution": "1080p",
        "output_format": "mov"
      }`;

/** 1.5 pro 样片第 1 步（https://ai.byteplus.com/ark/region:ap-southeast-1/docs/video-generation-tutorial#5acd28c8，cURL）；没传 resolution */
export const OFFICIAL_TUT_15_DRAFT_STEP1 = `{
        "model": "seedance-1-5-pro-251215",
        "content": [
            {
                "type": "text",
                "text": "A girl holding a fox, the girl opens her eyes, looks gently at the camera, the fox hugs affectionately, the camera slowly pulls out, the girl’s hair is blown by the wind"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/i2v_foxrgirl.png"
                }
            }
        ],
        "seed": 20,
        "duration": 6,
        "draft": true
    }`;

/** 1.5 pro 样片第 2 步（同上，Step 2 cURL） */
export const OFFICIAL_TUT_15_DRAFT_STEP2 = `{
        "model": "seedance-1-5-pro-251215",
        "content": [
            {
                "type": "draft_task",
                "draft_task": {"id": "cgt-2026****-pzjqb"}
            }
        ],
          "watermark": false,
          "resolution": "720p",
          "return_last_frame": true,
          "service_tier": "default"
      }`;
