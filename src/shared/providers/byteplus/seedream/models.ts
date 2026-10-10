import type { MediaSpec, ModeDef, ModelDef, PromptSpec, SlotDef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T } from '../../../catalog/helpers.js';
import { SEEDREAM_ADAPTER, SEEDREAM_STREAM_ADAPTER } from './adapter.js';
import { GEN_FORMATS, LAYER_MIN_PIXELS, TRANSPARENT_FORMATS, buildConstraints, buildGuards } from './constraints.js';
import { buildFields } from './fields.js';
import { estimateSeedreamCost } from './pricing.js';
import { GROUP_TOTAL_LIMIT, PROFILES, type SeedreamKey, type SeedreamModeId, type SeedreamProfile } from './profile.js';
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

/** 有 4.x 提示词指南覆盖的模型（指南正文只写 4.0 / 4.5，5.0 lite 不算） */
const GUIDE_4X: SeedreamKey[] = ['v45', 'v40'];

/** 参考图槽说明：Image n 的写法与编号依据按模型区分 */
function referenceHelp(p: SeedreamProfile): I18nText {
  const head = T(`不传为文生图，最多 ${p.maxRefs} 张；`, `Optional (text-to-image without any), up to ${p.maxRefs}; `);
  const tail = p.interactiveEdit
    ? T('引用时按上传顺序写成 Image 1、Image 2…（交互式编辑指南的 demo 代码同样把 Image N 对应到提交的第 N 张图）', 'references are written as Image 1, Image 2… in upload order (the interactive editing guide demo code also maps Image N to the Nth submitted image)')
    : GUIDE_4X.includes(p.key)
      ? T('多图时写成 Image 1、Image 2…（4.x 提示词指南的写法）；编号按上传顺序是推导，指南没写明', 'refer to several images as Image 1, Image 2… (the 4.x prompt guide wording); matching them to the upload order is inferred, the guide does not say so')
      : T('引用时按上传顺序写成 Image 1、Image 2…（推导自官方示例，文档未规定）', 'references are written as Image 1, Image 2… in upload order (inferred from official samples, not specified by the docs)');
  return T(head.zh + tail.zh, head.en + tail.en);
}

const referenceSlot = (p: SeedreamProfile): SlotDef => ({
  id: 'image',
  kind: 'image',
  label: T('参考图', 'Reference images'),
  min: 0,
  max: p.maxRefs,
  sources: SOURCES,
  spec: GEN_SPEC,
  help: referenceHelp(p),
});

/**
 * 4.x 提示词指南正式用 Image 1 / 2 / 3 指称多张输入图（没写编号与上传顺序的关系）；5.0 编辑指南的 demo 代码把 Image N 对应到提交的第 N 张图；
 * 5.0 lite 没有官方提示词指南，沿用同一写法
 */
const refLabel: PromptSpec['refLabel'] = (_kind, n) => `Image ${n}`;
const SOFT_MAX = { zhChars: 300, enWords: 600 };

/** 提示词语言：全部模型中英文，pro/flash 另加 14 种 */
function langHint(p: SeedreamProfile): I18nText {
  return p.interactiveEdit
    ? T('支持中英文提示词，另支持俄、阿、菲、泰、土、韩、马来、西、葡、印尼、法、德、越、日 14 种语言', 'Prompts in Chinese and English, plus Russian, Arabic, Filipino, Thai, Turkish, Korean, Malay, Spanish, Portuguese, Indonesian, French, German, Vietnamese and Japanese')
    : T('支持中文、英文提示词', 'Chinese and English prompts are supported');
}

/** 5.0 pro / flash 交互式编辑指南 */
const EDIT_HINT = T(
  '交互式编辑：用 <point>x y</point> 标点（只指向物体，范围由模型判断）或 <bbox>x1 y1 x2 y2</bbox> 标框（左上 + 右下，精确限定区域）；每个坐标前写所属图片，如 Image 1 <point>520 460</point>（只有一张图也写）；坐标按那张图自身归一化到 0–999：x = round(x 像素 ÷ 图宽 × 1000)，y 同理，超出范围截到 0–999；框里有多个主体时用文字点明目标，要保持不变的区域也可以框出来并写 keep … unchanged',
  'interactive editing: mark a point with <point>x y</point> (points at an object, the model decides the extent) or a box with <bbox>x1 y1 x2 y2</bbox> (top-left + bottom-right, exact region); put the image label before each tag, e.g. Image 1 <point>520 460</point> (even with one image); coordinates are normalized 0–999 per image: x = round(x_px / width × 1000), y likewise, clamped to 0–999; name the target in words when a box holds several subjects, and you may box regions to keep and write "keep … unchanged"',
);

/** 4.0 / 4.5 提示词指南的核心写法 */
const GUIDE_4X_HINT = T(
  '用自然语言写主体 + 动作 + 环境，措辞简洁、不要堆砌形容词；画面里要出现的文字放在双引号里；编辑时说清改哪里、保留什么，多张图按 Image 1 / Image 2 分别交代作用；区域难用文字说清时，可以在输入图上画框或箭头，提示词按颜色指代（如 the red box）',
  'describe subject + action + environment in natural language, concisely and without piling up adjectives; put any text that must appear in the image in double quotes; for edits say what to change and what to keep, and with several images say what each of Image 1 / Image 2 contributes; when a region is hard to describe, mark it on the input image with a box or arrow and refer to it by color (e.g. "the red box")',
);
const GROUP_4X_HINT = T('组图要逐张列出各自的内容，并写明需要统一的风格、主色或角色', 'for a set, list what each image shows and state the shared style, main color or character');

/**
 * extra：模式自己的说明，代替默认的写法说明。
 * 交互式编辑提示只给 pro / flash 的生成模式：编辑指南只演示了普通参考图编辑，透明背景模式能不能用坐标标注没写
 */
function promptSpec(p: SeedreamProfile, modeId: SeedreamModeId, required: boolean, extra?: I18nText): PromptSpec {
  const parts = [langHint(p)];
  if (extra) parts.push(extra);
  else if (p.interactiveEdit && modeId === 'generate') parts.push(EDIT_HINT);
  else if (GUIDE_4X.includes(p.key)) parts.push(GUIDE_4X_HINT, ...(modeId === 'group' ? [GROUP_4X_HINT] : []));
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
      prompt: promptSpec(p, 'generate', true),
      ...(p.group ? { locked: { sequential_image_generation: { value: 'disabled', reason: T('单图模式只出 1 张；要出多张请切换到「组图」', 'Single mode returns one image; switch to Group for more') } } } : {}),
    },
  ];
  if (p.group) {
    modes.push({
      id: 'group',
      label: T('组图', 'Group'),
      hint: GUIDE_4X.includes(p.key)
        ? // 4.x 提示词指南：用 a series / a set 或直接写张数来触发组图
          T(
            `由模型按提示词决定出几张（不超过「最多张数」），提示词里写 a series / a set 或直接写张数来触发多张；参考图数 + 生成张数 ≤ ${GROUP_TOTAL_LIMIT}`,
            `The model decides how many images to return (up to Max images); trigger a set with "a series", "a set" or an explicit count in the prompt; references + outputs ≤ ${GROUP_TOTAL_LIMIT}`,
          )
        : T(`由模型按提示词决定出几张（不超过「最多张数」）；参考图数 + 生成张数 ≤ ${GROUP_TOTAL_LIMIT}`, `The model decides how many images to return (up to Max images); references + outputs ≤ ${GROUP_TOTAL_LIMIT}`),
      slots: [referenceSlot(p)],
      prompt: promptSpec(p, 'group', true),
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
        'layer',
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
      prompt: promptSpec(p, 'transparent', true),
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
