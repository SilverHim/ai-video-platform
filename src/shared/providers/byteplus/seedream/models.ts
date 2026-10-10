import type { MediaSpec, ModeDef, ModelDef, PromptSpec, SlotDef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T } from '../../../catalog/helpers.js';
import { SEEDREAM_ADAPTER, SEEDREAM_STREAM_ADAPTER } from './adapter.js';
import { GEN_FORMATS, LAYER_MIN_PIXELS, TRANSPARENT_FORMATS, buildConstraints, buildGuards } from './constraints.js';
import { buildFields } from './fields.js';
import { estimateSeedreamCost } from './pricing.js';
import { GROUP_TOTAL_LIMIT, PROFILES, type SeedreamProfile } from './profile.js';
import { ASPECT_RANGE } from './sizes.js';
import { SEEDREAM_PROMPT_GUIDES, scopeGuides } from '../prompt-guides.js';

const MAX_INPUT_PIXELS = 36_000_000;
// 未核实：原文 "Size: Up to 30 MB" 没说 MB 是 10^6 还是 2^20，取较小的 30,000,000 字节
export const MAX_INPUT_BYTES = 30_000_000;

/** 生成场景的输入图（全部模型） */
export const GEN_SPEC: MediaSpec = { formats: GEN_FORMATS, maxBytes: MAX_INPUT_BYTES, minSideExclusive: 14, pixels: [196, MAX_INPUT_PIXELS], aspect: ASPECT_RANGE };
/** 图层分解：只能 png/jpeg，总像素 ≥ 262,144（宽高下限不适用） */
export const LAYER_SPEC: MediaSpec = { formats: ['png', 'jpeg'], maxBytes: MAX_INPUT_BYTES, pixels: [LAYER_MIN_PIXELS, MAX_INPUT_PIXELS], aspect: ASPECT_RANGE };
/** 透明背景：恰好 1 张带 alpha 的输入，不支持 alpha 的 jpeg 会报错 */
export const TRANSPARENT_SPEC: MediaSpec = { ...GEN_SPEC, formats: TRANSPARENT_FORMATS, requireAlpha: true };

const SOURCES: SlotDef['sources'] = ['local', 'url', 'task-output'];

const referenceSlot = (p: SeedreamProfile): SlotDef => ({
  id: 'image',
  kind: 'image',
  label: T('参考图', 'Reference images'),
  min: 0,
  max: p.maxRefs,
  sources: SOURCES,
  spec: GEN_SPEC,
  help: T(
    `不传为文生图，最多 ${p.maxRefs} 张；引用时按上传顺序写成 Image 1、Image 2…（推导自官方示例，文档未规定）`,
    `Optional (text-to-image without any), up to ${p.maxRefs}; references are written as Image 1, Image 2… in upload order (inferred from official samples, not specified by the docs)`,
  ),
});

// 推导：官方交互式编辑 demo 按 image 数组顺序对应提示词里的 "Image N"，正文未明确规定；lite/4.x 样例用的是非正式写法
const refLabel: PromptSpec['refLabel'] = (_kind, n) => `Image ${n}`;
const SOFT_MAX = { zhChars: 300, enWords: 600 };

/** 提示词语言：全部模型中英文，pro/flash 另加 14 种 */
function langHint(p: SeedreamProfile): I18nText {
  return p.interactiveEdit
    ? T('支持中英文提示词，另支持俄、阿、菲、泰、土、韩、马来、西、葡、印尼、法、德、越、日 14 种语言', 'Prompts in Chinese and English, plus Russian, Arabic, Filipino, Thai, Turkish, Korean, Malay, Spanish, Portuguese, Indonesian, French, German, Vietnamese and Japanese')
    : T('支持中文、英文提示词', 'Chinese and English prompts are supported');
}

function promptSpec(p: SeedreamProfile, required: boolean, extra?: I18nText): PromptSpec {
  const lang = langHint(p);
  const edit = p.interactiveEdit
    ? T('可写 <point>x y</point> 或 <bbox>x1 y1 x2 y2</bbox>（0–999 归一化坐标）标注编辑位置，多图时用 Image n 指明哪一张', 'use <point>x y</point> or <bbox>x1 y1 x2 y2</bbox> (normalized 0–999) to mark edit regions; name the image with Image n when there are several')
    : undefined;
  const parts = [lang, ...(extra ? [extra] : edit ? [edit] : [])];
  const hint = T(parts.map((x) => x.zh).join('；'), parts.map((x) => x.en).join('; '));
  return { required, softMax: SOFT_MAX, refLabel, hint };
}

function buildModes(p: SeedreamProfile): ModeDef[] {
  const modes: ModeDef[] = [
    {
      id: 'generate',
      label: T('生成', 'Generate'),
      hint: T('文生图，或用 1 张 / 多张参考图生成 1 张图', 'Text-to-image, or one image from one or more references'),
      slots: [referenceSlot(p)],
      prompt: promptSpec(p, true),
      ...(p.group ? { locked: { sequential_image_generation: { value: 'disabled', reason: T('单图模式只出 1 张；要出多张请切换到「组图」', 'Single mode returns one image; switch to Group for more') } } } : {}),
    },
  ];
  if (p.group) {
    modes.push({
      id: 'group',
      label: T('组图', 'Group'),
      hint: T(`由模型按提示词决定出几张（不超过「最多张数」）；参考图数 + 生成张数 ≤ ${GROUP_TOTAL_LIMIT}`, `The model decides how many images to return (up to Max images); references + outputs ≤ ${GROUP_TOTAL_LIMIT}`),
      slots: [referenceSlot(p)],
      prompt: promptSpec(p, true),
      locked: { sequential_image_generation: { value: 'auto', reason: T('组图模式固定为 auto', 'Group mode always uses auto') } },
    });
  }
  if (p.layer) {
    modes.push({
      id: 'layer',
      label: T('图层分解', 'Layer decomposition'),
      hint: T(
        '输出 1 张底图 + 最多 16 个带透明通道的 PNG 图层；任一图层失败则整单失败。每次请求先预扣 17 张 IPM 额度（同账号同模型每分钟 500 张），完成后退回多扣部分，连续提交容易触发限流',
        'Returns one base image plus up to 16 PNG layers with alpha; any layer failure fails the whole request. Each request first reserves 17 images of IPM quota (500 per minute per account and model version) and refunds the unused part afterwards, so rapid submissions may hit the rate limit',
      ),
      slots: [
        {
          id: 'image',
          kind: 'image',
          label: T('待分解图片', 'Image to decompose'),
          min: 1,
          max: 1,
          sources: SOURCES,
          spec: LAYER_SPEC,
          help: T('恰好 1 张 PNG / JPEG，总像素 ≥ 512×512', 'Exactly one PNG / JPEG with at least 512×512 pixels'),
        },
      ],
      prompt: promptSpec(
        p,
        false,
        T(
          '可选：用自然语言或 <bbox> 指定要拆的元素，不填则自动识别主要元素；要求的图层超过 16 层时可能丢失部分图层信息',
          'optional: name the elements to split or mark them with <bbox>, or leave empty to detect the main elements automatically; asking for more than 16 layers may lose some layer information',
        ),
      ),
      wire: { layer_decomposition: true },
    });
  }
  if (p.transparent) {
    modes.push({
      id: 'transparent',
      label: T('透明背景', 'Transparent background'),
      hint: T('用恰好 1 张带透明通道的图做图生图，输出保留透明背景的 PNG', 'Edits exactly one image with an alpha channel and returns a PNG that keeps the transparency'),
      slots: [
        {
          id: 'image',
          kind: 'image',
          label: T('带透明通道的输入图', 'Input image with alpha'),
          min: 1,
          max: 1,
          sources: SOURCES,
          spec: TRANSPARENT_SPEC,
          help: T('恰好 1 张带 alpha 通道的图片（建议 PNG）；JPEG 不支持透明会报错', 'Exactly one image with an alpha channel (PNG recommended); JPEG has no alpha and fails'),
        },
      ],
      prompt: promptSpec(p, true),
      locked: {
        background: { value: 'transparent', reason: T('透明背景模式', 'Transparent background mode') },
        output_format: { value: 'png', reason: T('透明背景只能输出 PNG（jpeg 会报错）', 'Transparent background outputs PNG only (jpeg errors)') },
      },
    });
  }
  return modes;
}

function buildModel(p: SeedreamProfile): ModelDef {
  const modes = buildModes(p);
  return {
    id: p.id,
    providerId: 'byteplus',
    apiModel: p.apiModel,
    ...(p.aliases ? { aliases: p.aliases } : {}),
    family: 'seedream',
    label: p.label,
    description: p.description,
    output: 'image',
    kind: 'sync',
    lifecycle: { status: 'active' },
    docs: p.docs,
    ...(SEEDREAM_PROMPT_GUIDES[p.key].length ? { promptGuides: scopeGuides(SEEDREAM_PROMPT_GUIDES[p.key], modes) } : {}),
    endpoints: p.stream ? { submit: 'image.generate', stream: 'image.stream' } : { submit: 'image.generate' },
    modes,
    fields: buildFields(p),
    constraints: buildConstraints(p),
    wireGuards: buildGuards(p),
    adapter: p.stream ? SEEDREAM_STREAM_ADAPTER : SEEDREAM_ADAPTER,
    allowModelOverride: true,
    estimateCost: (c) => estimateSeedreamCost(p, c),
  };
}

export const SEEDREAM_MODEL_DEFS: ModelDef[] = PROFILES.map(buildModel);
