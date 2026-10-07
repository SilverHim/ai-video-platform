/** Seedance 字段：模型不支持的字段不声明；正片模式只保留允许重设的字段 */
import type { EnumOption, FieldDef, PredCtx } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T, doc } from '../../../catalog/helpers.js';
import { DOC_URLS, EXPIRES_DEFAULT, EXPIRES_RANGE, MODE, SEED_MAX, draftModesOf, userModesOf, type SeedanceProfile } from './profile.js';

const API = doc(DOC_URLS.create);
const TUT = doc(DOC_URLS.tutorial);

/** 当前模式开了样片（隐藏模式里残留的 draft=true 不算） */
export const draftOn = (p: SeedanceProfile, c: PredCtx): boolean => p.draft && c.values.draft === true && draftModesOf(p).includes(c.mode.id);

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];

function resolutionField(p: SeedanceProfile): FieldDef {
  const badge = (v: string): I18nText | null => {
    if (p.key === 'v25' && v === '1080p') return T('10-bit HEVC，浏览器可能放不了', '10-bit HEVC; browsers may not play it');
    if (v === '4k') return T('10-bit HEVC；4K 限流 15 RPM / 并发 1', '10-bit HEVC; 4K is limited to 15 RPM / 1 concurrent');
    return null;
  };
  const options: EnumOption[] = p.resolutions.map((v) => {
    const b = badge(v);
    return { value: v, ...(b ? { badge: b } : {}) };
  });
  return {
    key: 'resolution',
    type: 'enum',
    label: T('分辨率', 'Resolution'),
    group: 'basic',
    wire: 'resolution',
    default: p.defaultResolution,
    control: 'segmented',
    options,
    // 未核实：draft=true 不传 resolution 时是否自动 480p 文档没写（2.5 官方样片示例显式传 480p，1.5 pro 教程示例没传），锁定并显式发送
    // 2.5 正片由模式锁 1080p 并发送：S25 正片示例显式带了 "resolution":"1080p"
    locked: (c) => (draftOn(p, c) ? { value: '480p', reason: T('样片只能生成 480p', 'Drafts are 480p only') } : null),
    docs: [API],
  };
}

function ratioField(p: SeedanceProfile): FieldDef {
  const adaptive: EnumOption = {
    value: 'adaptive',
    label: T('自适应', 'Adaptive'),
    ...(p.t2vNoAdaptive ? { unavailable: (c: PredCtx) => (c.mode.id === MODE.t2v ? T('1.0 系列文生视频不支持 adaptive', 'Seedance 1.0 text-to-video does not support adaptive') : null) } : {}),
    ...(p.s20Conflict ? { badge: T('不发送 ratio，用 API 默认值 adaptive（Seedance 2.0 页能力表未列 adaptive）', 'ratio is omitted and the API default adaptive applies (the Seedance 2.0 page does not list adaptive)') } : {}),
  };
  return {
    key: 'ratio',
    type: 'enum',
    label: T('画面比例', 'Aspect ratio'),
    help: T('adaptive：文生 / 参考生视频由模型选比例，首帧任务跟随首帧图，编辑 / 延长跟随原视频；返回的实际比例可能不在枚举内', 'adaptive: the model picks for text / reference, follows the first frame for image-to-video and the source for edit / extend; the returned ratio may be outside the list'),
    group: 'basic',
    modes: userModesOf(p),
    wire: 'ratio',
    // 文档冲突（S20 未列 adaptive）：2.0 系列选 adaptive 时不发送，靠 API 写明的默认值
    ...(p.s20Conflict ? { fragment: (v: string) => (v === 'adaptive' ? null : { ratio: v }) } : {}),
    default: p.t2vNoAdaptive ? (c) => (c.mode.id === MODE.t2v ? '16:9' : 'adaptive') : 'adaptive',
    options: RATIOS.map((v) => (v === 'adaptive' ? adaptive : { value: v })),
    docs: [API],
  };
}

/** 1.0：duration 与 frames 二选一（同时传 frames 优先），只用于界面切换 */
function lengthModeField(p: SeedanceProfile): FieldDef {
  return {
    key: 'lengthMode',
    type: 'enum',
    label: T('时长方式', 'Length by'),
    help: T('按秒（duration）或按帧数（frames），只发送其中一个', 'Seconds (duration) or frame count (frames); only one is sent'),
    group: 'basic',
    modes: userModesOf(p),
    wire: null,
    send: 'never',
    default: 'duration',
    control: 'segmented',
    options: [
      { value: 'duration', label: T('按秒', 'Seconds') },
      { value: 'frames', label: T('按帧数', 'Frames') },
    ],
  };
}

function durationField(p: SeedanceProfile): FieldDef {
  const [min, max] = p.duration.range;
  return {
    key: 'duration',
    type: 'int',
    label: T('时长（秒）', 'Duration (s)'),
    help: p.duration.auto
      ? T(`${min}–${max} 秒，或 -1 由模型在范围内自选整秒；查询返回的时长为帧数 / 24 向下取整`, `${min}–${max} s, or -1 to let the model pick whole seconds; the returned duration is frames / 24 rounded down`)
      : T(`${min}–${max} 秒`, `${min}–${max} s`),
    group: 'basic',
    modes: userModesOf(p),
    wire: 'duration',
    default: p.duration.default,
    min,
    max,
    step: 1,
    ...(p.duration.auto ? { specials: [{ value: -1, label: T('自动', 'Auto') }] } : {}),
    ...(p.frames ? { visible: (c: PredCtx) => c.values.lengthMode !== 'frames' } : {}),
    docs: [API, TUT],
  };
}

function framesField(p: SeedanceProfile): FieldDef {
  return {
    key: 'frames',
    type: 'int',
    label: T('帧数', 'Frames'),
    help: T('[29, 289] 内满足 25+4n 的整数，帧数 = 时长 × 24，可生成非整秒视频', '25+4n within [29, 289]; frames = seconds × 24, allows non-integer lengths'),
    group: 'basic',
    modes: userModesOf(p),
    wire: 'frames',
    // 文档没给 frames 的默认值；这里只是界面预填 121（约 5 秒、满足 25+4n），切到按帧数后总是显式发送，不依赖服务端默认
    default: 121,
    min: 29,
    max: 289,
    step: 4,
    pattern: { base: 25, step: 4 },
    visible: (c) => c.values.lengthMode === 'frames',
    docs: [API, TUT],
  };
}

function generateAudioField(p: SeedanceProfile): FieldDef {
  return {
    key: 'generate_audio',
    type: 'bool',
    label: T('生成音频', 'Generate audio'),
    help: T('输出的音频为单声道', 'Generated audio is mono'),
    group: 'basic',
    modes: userModesOf(p),
    wire: 'generate_audio',
    default: true,
    docs: [API],
  };
}

function draftField(p: SeedanceProfile): FieldDef {
  return {
    key: 'draft',
    type: 'bool',
    label: T('样片（Draft）', 'Draft'),
    help: T('先出 480p 样片，满意后在结果卡片上"生成正片"（样片 7 天内有效）；两步分别计费', 'Generates a 480p draft first; turn it into the final from the result card within 7 days; both steps are billed'),
    group: 'advanced',
    modes: draftModesOf(p),
    wire: null,
    // 只在开启时发送 draft:true（"不填或 false"等价），避免给文档有冲突的 2.5 多发一个字段
    fragment: (v) => (v ? { draft: true } : null),
    default: false,
    docs: [API, ...(p.key === 'v25' ? [doc(DOC_URLS.s25)] : [TUT])],
    // 文档冲突：2.5 的 S25 / TUT / API 写支持样片，arkcli 目录 supported_params 写不支持
    ...(p.key === 'v25' ? { experimental: true } : {}),
  };
}

function seedField(p: SeedanceProfile): FieldDef {
  return {
    key: 'seed',
    type: 'seed',
    label: T('种子', 'Seed'),
    help: T('留空或 -1 为随机；相同种子只保证结果相似，不保证一致', 'Empty or -1 = random; the same seed gives similar, not identical, results'),
    group: 'advanced',
    modes: userModesOf(p),
    wire: 'seed',
    default: null,
    min: -1,
    max: SEED_MAX,
    docs: [API],
  };
}

function cameraFixedField(p: SeedanceProfile): FieldDef {
  return {
    key: 'camera_fixed',
    type: 'bool',
    label: T('固定镜头', 'Fixed camera'),
    help: T('平台会在提示词后追加固定镜头指令，效果不保证', 'Appends a fixed-camera instruction to the prompt; not guaranteed'),
    group: 'advanced',
    modes: userModesOf(p),
    wire: 'camera_fixed',
    default: false,
    docs: [API],
  };
}

function watermarkField(): FieldDef {
  return {
    key: 'watermark',
    type: 'bool',
    label: T('水印', 'Watermark'),
    help: T('开启时右下角加 "AI Generated" 水印', 'Adds an "AI Generated" mark at the bottom-right'),
    group: 'output',
    // API 的 watermark 段没列适用模型；"Parameter input methods" 写明 watermark 等 7 个参数所有模型都可在请求体里传
    wire: 'watermark',
    default: false,
    docs: [API],
  };
}

function outputFormatField(): FieldDef {
  return {
    key: 'output_format',
    type: 'enum',
    label: T('输出格式', 'Output format'),
    help: T('编辑 / 延长建议输入输出都用 mov', 'For edit / extend, mov is recommended for both input and output'),
    group: 'output',
    wire: 'output_format',
    default: 'mp4',
    control: 'segmented',
    options: [
      { value: 'mp4', label: T('MP4', 'MP4') },
      {
        value: 'mov',
        label: T('MOV', 'MOV'),
        badge: T('文档冲突：教程能力矩阵只写 MP4；H.264 4:4:4 + PCM，部分播放器放不了', 'Docs disagree: the tutorial matrix lists MP4 only; H.264 4:4:4 + PCM, some players cannot play it'),
      },
    ],
    docs: [API, doc(DOC_URLS.s25)],
    // 文档冲突：教程能力矩阵里 2.5 只写 MP4，S25 / API / 模型列表写 mp4 / mov（S25 样片示例两步、编辑 / 延长示例都用了 mov，作旁证）
    experimental: true,
  };
}

function returnLastFrameField(p: SeedanceProfile): FieldDef {
  const reason =
    p.key === 'v15pro'
      ? T('1.5 pro 样片不支持返回尾帧', 'Seedance 1.5 pro drafts cannot return the last frame')
      : // 未核实：文档没写 2.5 样片能否返回尾帧（只列为正片可重设参数），样片阶段不发送
        T('文档没写 2.5 样片能否返回尾帧，样片阶段不发送', 'Docs do not say whether 2.5 drafts return a last frame; not sent for drafts');
  return {
    key: 'return_last_frame',
    type: 'bool',
    label: T('返回尾帧', 'Return last frame'),
    help: T('额外返回一张 jpeg 尾帧（与视频同尺寸、无水印），可用来接续生成', 'Also returns a JPEG last frame (same size, no watermark) for chaining'),
    group: 'output',
    wire: 'return_last_frame',
    default: false,
    ...(p.draft ? { disabled: (c: PredCtx) => (draftOn(p, c) ? reason : null) } : {}),
    docs: [API, TUT],
  };
}

function serviceTierField(p: SeedanceProfile): FieldDef {
  return {
    key: 'service_tier',
    type: 'enum',
    label: T('服务等级', 'Service tier'),
    help: T('flex 为离线推理，价格为在线的 50%；提交后不能修改', 'Flex is offline inference at 50% of the online price; cannot be changed after submission'),
    group: 'advanced',
    wire: 'service_tier',
    default: 'default',
    control: 'segmented',
    options: [
      { value: 'default', label: T('在线', 'Online') },
      {
        value: 'flex',
        label: T('离线（flex）', 'Offline (flex)'),
        unavailable: (c) => {
          if (!p.flex) return T('Seedance 2.5 / 2.0 系列不支持离线推理', 'Seedance 2.5 / 2.0 do not support flex');
          return draftOn(p, c) ? T('样片不支持离线推理', 'Drafts do not support flex') : null;
        },
      },
    ],
    docs: [API, TUT],
  };
}

function priorityField(): FieldDef {
  return {
    key: 'priority',
    type: 'int',
    label: T('优先级', 'Priority'),
    help: T('0–9，越大越优先；只调整同一 Endpoint 内排队任务的顺序，不打断运行中的任务；实际值由平台按策略分配', '0–9, higher runs first; only reorders queued tasks within one endpoint and never preempts running ones; the platform assigns the effective value'),
    group: 'advanced',
    wire: 'priority',
    default: 0,
    min: 0,
    max: 9,
    step: 1,
    docs: [API],
  };
}

function expiresField(p: SeedanceProfile): FieldDef {
  return {
    key: 'execution_expires_after',
    type: 'int',
    label: T('任务超时（秒）', 'Task timeout (s)'),
    help: T('从创建时刻起算，超时后任务终止并标记为 expired', 'Counted from creation; the task is terminated as expired afterwards'),
    group: 'advanced',
    wire: 'execution_expires_after',
    // 1.5 pro 正片：教程写"其他参数可手动指定、不填用默认值"，官方示例没带这个字段；取默认值时不发送，与官方示例同形
    ...(p.key === 'v15pro' ? { fragment: (v: number | null, c: PredCtx) => (v === null || (c.mode.id === MODE.final && v === EXPIRES_DEFAULT) ? null : { execution_expires_after: v }) } : {}),
    default: EXPIRES_DEFAULT,
    min: EXPIRES_RANGE[0],
    max: EXPIRES_RANGE[1],
    docs: [API],
  };
}

/**
 * 正片可重设的字段（不含 callback_url / safety_identifier，本平台不暴露）：
 * - 2.5：return_last_frame、output_format、watermark、service_tier、execution_expires_after、priority；resolution 锁 1080p 并发送（同 S25 示例）
 * - 1.5 pro：resolution、watermark、service_tier、return_last_frame（教程示例原样）；execution_expires_after 只在改过时发送；被沿用的参数一律不在正片出现
 * 不在正片出现的字段用 modes: userModesOf(p) 排除。
 */
export function buildFields(p: SeedanceProfile): FieldDef[] {
  return [
    resolutionField(p),
    ratioField(p),
    ...(p.frames ? [lengthModeField(p)] : []),
    durationField(p),
    ...(p.frames ? [framesField(p)] : []),
    ...(p.generateAudio ? [generateAudioField(p)] : []),
    ...(p.draft ? [draftField(p)] : []),
    // 文档冲突：2.x 是否接受 seed 未明确（API 只列 1.x，S25 正片规则又提到 seed），2.x 不暴露
    ...(p.seedCamera ? [seedField(p), cameraFixedField(p)] : []),
    watermarkField(),
    ...(p.outputFormat ? [outputFormatField()] : []),
    returnLastFrameField(p),
    serviceTierField(p),
    ...(p.priority ? [priorityField()] : []),
    expiresField(p),
  ];
}
