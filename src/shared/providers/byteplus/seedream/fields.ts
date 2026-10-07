import type { EnumOption, FieldDef, PredCtx } from '../../../catalog/types.js';
import { T, doc } from '../../../catalog/helpers.js';
import { DOC_URLS, GROUP_TOTAL_LIMIT, modeIdsOf, type SeedreamProfile } from './profile.js';
import { LAYER_DEFAULT, fmtInt, generateSizeSpec, layerSizeSpec, sizeToWire } from './sizes.js';

const API = doc(DOC_URLS.api);
const imageCount = (c: PredCtx): number => c.slots.image?.length ?? 0;

export function sizeField(p: SeedreamProfile): FieldDef {
  const gen = generateSizeSpec(p.size);
  const layer = p.layer ? layerSizeSpec(p.size) : null;
  const [min, max] = p.size.pixels;
  const tiers = p.size.tiers.join(' / ');
  // 原文 Pricing note：1.5K 与 1K 同价，生成场景画质更好（pro / flash）
  const mid = p.size.tiers.includes('1.5K');
  return {
    key: 'size',
    type: 'size',
    label: T('尺寸', 'Size'),
    help: T(
      `档位 ${tiers}，或自定义宽x高（单张总像素 ${fmtInt(min)}–${fmtInt(max)}，宽高比 1/16–16）。用档位时把宽高比写进提示词，实际尺寸以返回结果为准${mid ? '；1.5K 与 1K 同价、画质更好' : ''}${p.layer ? '；图层分解只支持档位或 auto' : ''}`,
      `Tier ${tiers}, or custom WxH (total pixels ${fmtInt(min)}–${fmtInt(max)}, aspect 1/16–16). With a tier, describe the aspect ratio in the prompt; the returned size is authoritative${mid ? '; 1.5K costs the same as 1K with better quality' : ''}${p.layer ? '; layer decomposition accepts tiers or auto only' : ''}`,
    ),
    group: 'basic',
    wire: null,
    default: (c) => ({ mode: 'preset', value: c.mode.id === 'layer' && layer ? LAYER_DEFAULT : p.size.defaultTier }),
    spec: (c) => (c.mode.id === 'layer' && layer ? layer : gen),
    fragment: (v) => sizeToWire(v),
    docs: [API, ...(p.layer ? [doc(DOC_URLS.pro)] : [])],
  };
}

export function outputFormatField(): FieldDef {
  return {
    key: 'output_format',
    type: 'enum',
    label: T('输出格式', 'Output format'),
    help: T('图层分解时只控制底图格式，图层固定 PNG', 'In layer decomposition this sets the base image only; layers are always PNG'),
    group: 'output',
    wire: 'output_format',
    default: 'jpeg',
    control: 'segmented',
    options: [
      { value: 'jpeg', label: T('JPEG', 'JPEG') },
      { value: 'png', label: T('PNG', 'PNG') },
    ],
    docs: [API],
  };
}

export function promptModeField(p: SeedreamProfile): FieldDef {
  const options: EnumOption[] = [{ value: 'standard', label: T('标准（质量更高、更慢）', 'Standard (higher quality, slower)') }];
  // 文档冲突：pro 教程写 "Only Seedream 5.0 pro supports this mode"（pro/flash 对比语境），通用教程正文与能力表正面写 pro 与 4.0 支持
  const fastConflict = p.key === 'v40';
  if (p.fast) {
    options.push({
      value: 'fast',
      label: T('快速（更快、质量可能略低）', 'Fast (faster, quality may drop slightly)'),
      ...(fastConflict ? { badge: T('pro 教程措辞不一致', 'Pro guide wording differs') } : {}),
    });
  }
  return {
    key: 'optimize_prompt_mode',
    type: 'enum',
    label: T('提示词优化', 'Prompt optimization'),
    group: 'advanced',
    // EnumOption 没有 experimental，只能整字段标实验（standard 本身无争议）
    ...(fastConflict ? { experimental: true } : {}),
    // 未核实：图层分解是否支持提示词优化（官方图层样例未传），保守不发
    modes: modeIdsOf(p).filter((m) => m !== 'layer'),
    wire: 'optimize_prompt_options.mode',
    default: 'standard',
    options,
    docs: [API, doc(DOC_URLS.tutorial)],
  };
}

export function responseFormatField(): FieldDef {
  return {
    key: 'response_format',
    type: 'enum',
    label: T('返回方式', 'Response format'),
    help: T('url：链接 24 小时内有效（服务会自动下载）；b64_json：直接返回图片数据', 'url: link valid for 24 hours (downloaded automatically); b64_json: image data inline'),
    group: 'output',
    wire: 'response_format',
    default: 'url',
    control: 'segmented',
    options: [{ value: 'url', label: T('URL', 'URL') }, { value: 'b64_json', label: T('Base64', 'Base64') }],
    docs: [API],
  };
}

export function watermarkField(): FieldDef {
  return {
    key: 'watermark',
    type: 'bool',
    label: T('水印', 'Watermark'),
    help: T('开启时右下角加 "AI-generated" 水印', 'Adds an "AI-generated" mark at the bottom-right'),
    group: 'output',
    wire: 'watermark',
    default: true,
    docs: [API],
  };
}

export function streamField(): FieldDef {
  return {
    key: 'stream',
    type: 'bool',
    label: T('流式输出', 'Streaming'),
    help: T('每张图生成完就推送（SSE），单图和组图都适用', 'Pushes each image as soon as it is ready (SSE); works for single and group'),
    group: 'output',
    wire: 'stream',
    default: false,
    docs: [API, doc(DOC_URLS.stream)],
  };
}

/** 由模式锁定：组图 auto，其余 disabled（显式发送） */
export function sequentialField(): FieldDef {
  return {
    key: 'sequential_image_generation',
    type: 'enum',
    label: T('组图', 'Sequential generation'),
    group: 'advanced',
    wire: 'sequential_image_generation',
    default: 'disabled',
    options: [
      { value: 'disabled', label: T('关闭（只出 1 张）', 'Disabled (1 image)') },
      { value: 'auto', label: T('自动（由模型按提示词决定张数）', 'Auto (model decides the count)') },
    ],
    docs: [API],
  };
}

export function maxImagesField(): FieldDef {
  return {
    key: 'max_images',
    type: 'int',
    label: T('最多张数', 'Max images'),
    help: T('参考图数 + 生成张数 ≤ 15：纯文本最多 15 张，1 张参考图最多 14 张', 'Reference images + generated images ≤ 15: up to 15 from text only, 14 with one reference'),
    group: 'basic',
    modes: ['group'],
    wire: 'sequential_image_generation_options.max_images',
    // 文档默认 15；随参考图数收紧到可达上限
    default: (c) => Math.max(1, GROUP_TOTAL_LIMIT - imageCount(c)),
    min: 1,
    max: 15,
    docs: [API],
  };
}

/** 只在透明背景模式出现，并由模式锁定为 transparent */
export function backgroundField(): FieldDef {
  return {
    key: 'background',
    type: 'enum',
    label: T('背景', 'Background'),
    group: 'basic',
    modes: ['transparent'],
    wire: 'background',
    default: 'opaque',
    options: [{ value: 'opaque', label: T('不透明', 'Opaque') }, { value: 'transparent', label: T('透明', 'Transparent') }],
    docs: [API, doc(DOC_URLS.pro)],
  };
}

export function buildFields(p: SeedreamProfile): FieldDef[] {
  return [
    sizeField(p),
    ...(p.group ? [sequentialField(), maxImagesField()] : []),
    ...(p.outputFormat ? [outputFormatField()] : []),
    ...(p.transparent ? [backgroundField()] : []),
    promptModeField(p),
    responseFormatField(),
    ...(p.stream ? [streamField()] : []),
    watermarkField(),
  ];
}
