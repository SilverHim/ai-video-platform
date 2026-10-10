/**
 * Seedance 约束（C-SE-*）与 wireGuard。
 * 能写成声明的硬规则放在 SlotDef / FieldDef / ModeDef 上（数量、格式、大小、像素、单段时长、锁定值），
 * 这里只补引擎查不到的跨槽位规则、文档冲突提示和提示词 lint；wireGuard 对最终请求体兜底（含 rawOverrides）。
 */
import type { AssetRef, Constraint, MediaKind, PredCtx, WireGuard } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T } from '../../../catalog/helpers.js';
import { formatOf } from '../../../engine/media.js';
import { computeRefOrder, renderPrompt } from '../../../engine/refs.js';
import { getPath, isPlainObject } from '../../../request/wire.js';
import { draftOn } from './fields.js';
import { EDIT_CLIP_SEC, IMAGE_ASPECT, IMAGE_SIDE } from './modes.js';
import { DRAFT_TTL_MS, FINAL_BANNED_KEYS, MODE, SLOT, type SeedanceProfile } from './profile.js';

type Obj = Record<string, unknown>;

/** 只看当前模式声明过的槽位（其他槽位由引擎报 slot-unknown） */
function assetsOf(c: PredCtx, kind?: MediaKind): AssetRef[] {
  return c.mode.slots.filter((s) => !kind || s.kind === kind).flatMap((s) => c.slots[s.id] ?? []);
}

const stripRefs = (prompt: string): string => prompt.replace(/\{\{ref:[^}]+\}\}/g, ' ');

/* ---------------- 提示词 ---------------- */

// S25 与 2.5 提示词指南要求编辑 / 延长的提示词含这类英文词（指南另列了 insert、change to）；未核实：中文意图词能否被识别没写，只匹配文档列出的词
const EDIT_WORDS = /\b(edit(s|ed|ing)?|add(s|ed|ing)?|insert(s|ed|ing)?|delet(e|es|ed|ing)|remov(e|es|ed|ing)|modif(y|ies|ied|ying)|replac(e|es|ed|ing)|chang(e|es|ed|ing))\b/i;
const EXTEND_WORDS = /\b(extend(s|ed|ing)?|continu(e|es|ed|ing))\b/i;
/**
 * 文本命令：API 示例用缩写 --rs --rt --dur --seed --cf --wm，1.0 / 1.5 pro 提示词指南的示例另用全称
 * --resolution --ratio --duration --camerafixed --watermark（frames 的命令名没读到，不匹配）
 */
const LEGACY_FLAGS = /(^|\s)--(rs|rt|dur|seed|cf|wm|resolution|ratio|duration|camerafixed|watermark)(?=\s|=|$)/i;
/**
 * 2.0 指南：编辑 / 延长时写 reference Video N 会被当成参考任务。这是启发式 lint，只认几种明确把 reference Video N 当编辑 / 延长对象的句式，宁可漏报：
 * 动词直接带它（Extend / Strictly edit / continue from reference Video N）；remove / delete … from 它；add / insert … to / into 它；
 * generate … before / after 它（指南的延长句式）；followed by 它（指南的多段衔接句式）。
 * 中间最多隔 3 个词且不跨标点，中间出现 with / like / using / as / by 就不算（那是拿它当参考来源）；同一句里命中位置之前有 not / never / without 等否定也不算（含 Do not edit, modify or extend …）。
 * "改 … in reference Video N"不认：和"改成 reference Video N 里那样"字面上分不开。
 * "参考 Video 1、编辑 Video 2"这类组合任务（指南的 Combined tasks）、只参考某段运镜、普通的 continues walking 都不算
 */
const filler = (stop = 'with|like|using|as|by'): string => String.raw`(?:\s+(?!(?:${stop})\b)[^\s.,;:!?。，；：！？]+){0,3}?`;
/** 动词的词形（不用 \w*，免得 add 匹配到 additionally / address） */
const VERB_FORMS = {
  edit: 'edit(?:s|ed|ing)?',
  extend: 'extend(?:s|ed|ing)?',
  continue: 'continu(?:e|es|ed|ing)',
  modify: 'modif(?:y|ies|ied|ying)',
  replace: 'replac(?:e|es|ed|ing)',
  change: 'chang(?:e|es|ed|ing)',
  remove: 'remov(?:e|es|ed|ing)',
  delete: 'delet(?:e|es|ed|ing)',
  add: 'add(?:s|ed|ing)?',
  insert: 'insert(?:s|ed|ing)?',
  generate: 'generat(?:e|es|ed|ing)',
} as const;
const verbs = (...names: (keyof typeof VERB_FORMS)[]): string => String.raw`\b(?:${names.map((n) => VERB_FORMS[n]).join('|')})\b`;
const REF_VIDEO = String.raw`\s+(?:the\s+)?reference\s+@?video\s*\d`;
const REFERENCE_VIDEO_TARGET = new RegExp(
  [
    verbs('edit', 'extend', 'continue', 'modify', 'replace', 'change', 'remove', 'delete', 'add', 'insert') + String.raw`(?:\s+from)?` + REF_VIDEO,
    verbs('remove', 'delete') + filler() + String.raw`\s+from` + REF_VIDEO,
    verbs('add', 'insert') + filler('with|like|using|as|by|from|in') + String.raw`\s+(?:to|into)` + REF_VIDEO,
    verbs('generate') + filler() + String.raw`\s+(?:before|after)` + REF_VIDEO,
    String.raw`\bfollowed\s+by` + REF_VIDEO,
  ].join('|'),
  'gi',
);
/** 否定范围只以句号、分号、问叹号、换行为界：逗号常连着并列动词（Do not edit, modify or extend …） */
const CLAUSE_BREAK = /[.;!?。；！？\n]+/;
const NEGATION = /\b(?:not|never|dont|without|no)\b|n['’]t\b/i;

/** 按句找 reference Video N 作编辑 / 延长对象的写法；命中位置之前同一句里有否定词的不算 */
function editsReferenceVideo(text: string): boolean {
  return text.split(CLAUSE_BREAK).some((clause) => [...clause.matchAll(REFERENCE_VIDEO_TARGET)].some((m) => !NEGATION.test(clause.slice(0, m.index))));
}
const ASSET_URI = /asset:\/\//i;
/** 启发式：PORT 的错误示例是 asset-2026****，会误伤 asset-based 之类的词，只给 warn */
const ASSET_ID = /\basset-[A-Za-z0-9*]/i;

const editIntent: Constraint = {
  id: 'C-SE-3',
  severity: 'warn',
  check: (c) => {
    const text = stripRefs(c.input.prompt ?? '').trim();
    if (c.mode.id !== MODE.edit || !text || EDIT_WORDS.test(text)) return null;
    return {
      fields: ['prompt'],
      message: T(
        '编辑任务的提示词需写明编辑意图（edit the video / add / insert / delete / remove / modify / replace / change to 这类词），否则模型可能判定为其他任务类型并异步失败（TaskTypeMismatch）',
        'Edit prompts must state the intent (edit the video / add / insert / delete / remove / modify / replace / change to …); otherwise the model may detect another task type and fail asynchronously (TaskTypeMismatch)',
      ),
    };
  },
};

const extendIntent: Constraint = {
  id: 'C-SE-4',
  severity: 'warn',
  check: (c) => {
    const text = stripRefs(c.input.prompt ?? '').trim();
    if (c.mode.id !== MODE.extend || !text || EXTEND_WORDS.test(text)) return null;
    return {
      fields: ['prompt'],
      message: T(
        '延长任务的提示词需写明延长意图（extend forward / extend backward / continue / continue from / continue the story / extend the story 这类词），否则可能异步失败（TaskTypeMismatch）',
        'Extend prompts must state the intent (extend forward / extend backward / continue / continue from / continue the story / extend the story …); otherwise the task may fail asynchronously (TaskTypeMismatch)',
      ),
    };
  },
};

/**
 * C-SE-16：提示词末尾的 --参数 文本命令。方案写"不能用"，这里只给 warn：API 的 Parameter input methods 写明所有模型仍支持这种写法
 * （称为 Legacy / weak-validation method），1.0 / 1.5 pro 提示词指南也把它当作可选写法介绍；直接拦截与官方文档相悖。与表单字段同时出现时谁优先未核实。
 */
const legacyFlags: Constraint = {
  id: 'C-SE-16-legacy',
  severity: 'warn',
  check: (c) =>
    c.mode.id !== MODE.final && LEGACY_FLAGS.test(stripRefs(c.input.prompt ?? ''))
      ? {
          fields: ['prompt'],
          message: T(
            '提示词里有 --rs / --dur / --resolution / --duration 这类文本命令（API 称为旧写法）：弱校验，非法或不支持的参数可能被忽略、也可能报错，与表单字段同时出现时谁优先文档没写；请改用表单字段',
            'The prompt contains text commands such as --rs / --dur / --resolution / --duration (the legacy method in the API docs): they are weakly validated, so invalid or unsupported values may be ignored or cause an error, and precedence over request fields is undocumented; use the form fields instead',
          ),
        }
      : null,
};

/** 有素材编号写法的模型给出编号示例；1.x 官方没有编号写法，改为直接描述图中主体 */
function assetMsg(p: SeedanceProfile): I18nText {
  const label = p.refLabel?.('image', 1);
  return label
    ? T(`不要把 asset ID 写进提示词；请用素材编号（如 ${label}）引用，并把 asset:// 填进素材槽`, `Do not put asset IDs in the prompt; refer to assets by number (e.g. ${label}) and put asset:// URIs into the slots`)
    : T('不要把 asset ID 写进提示词；把 asset:// 填进素材槽，提示词里直接描述图中的主体', 'Do not put asset IDs in the prompt; put asset:// URIs into the slots and describe the subject in the image directly');
}

/** C-SE-16：提示词里写了 asset:// URI（PORT 定为错误用法） */
function assetUriInPrompt(p: SeedanceProfile): Constraint {
  const message = assetMsg(p);
  return {
    id: 'C-SE-16-asset',
    severity: 'error',
    check: (c) => (c.mode.id !== MODE.final && ASSET_URI.test(stripRefs(c.input.prompt ?? '')) ? { fields: ['prompt'], message } : null),
  };
}

/** C-SE-16：疑似 asset-xxx 形式的 ID（启发式，只给 warn） */
function assetIdInPrompt(p: SeedanceProfile): Constraint {
  const message = assetMsg(p);
  return {
    id: 'C-SE-16-asset-id',
    severity: 'warn',
    check: (c) => {
      const text = stripRefs(c.input.prompt ?? '');
      return c.mode.id !== MODE.final && !ASSET_URI.test(text) && ASSET_ID.test(text) ? { fields: ['prompt'], message } : null;
    },
  };
}

/*
 * 中文提示词不再提示：API 的语言清单没列中文，但 S25 写 2.5 支持中文，1.0 / 1.5 pro 提示词指南写支持中英文，
 * 2.0 提示词指南有中文对白的写法规则；用户决定各模型都按支持中文处理（原 C-SE-16-zh 已删除）
 */

/** C-SE-20-ref：2.0 系列在全模态参考里编辑 / 延长时写成 reference Video N（指南警告会被当成参考任务） */
const referenceVideo: Constraint = {
  id: 'C-SE-20-ref',
  severity: 'warn',
  check: (c) => {
    if (c.mode.id !== MODE.omni) return null;
    const { text } = renderPrompt(c.input.prompt ?? '', computeRefOrder(c.mode, c.slots), c.mode.prompt.refLabel);
    if (!editsReferenceVideo(text)) return null;
    return {
      fields: ['prompt'],
      message: T(
        '提示词把 reference Video N 当成了编辑 / 延长的对象：要编辑 / 延长这段视频时请直接写 Video N，写成 reference Video N 会被当成参考任务（Seedance 2.0 提示词指南）；只是参考它的动作、运镜等时可以忽略',
        'The prompt edits / extends "reference Video N": write "Video N" directly for the video to edit / extend, otherwise it is treated as a reference task (Seedance 2.0 prompt guide); ignore this if you only reference its motion, camera work etc.',
      ),
    };
  },
};

/* ---------------- 素材 ---------------- */

/** C-SE-7：全模态参考至少 1 个素材（只有文本请用文生视频） */
const omniNotEmpty: Constraint = {
  id: 'C-SE-7-empty',
  severity: 'error',
  check: (c) =>
    c.mode.id === MODE.omni && assetsOf(c).length === 0
      ? { slots: [SLOT.image, SLOT.video, SLOT.audio], message: T('全模态参考至少需要 1 个参考素材；只有文本请用「文生视频」', 'Omni reference needs at least one asset; use Text to video for prompt-only') }
      : null,
};

/** C-SE-7：2.0 系列不能只传音频 */
const noAudioOnly: Constraint = {
  id: 'C-SE-7-audio-only',
  severity: 'error',
  check: (c) => {
    if (c.mode.id !== MODE.omni) return null;
    const audio = assetsOf(c, 'audio').length;
    if (!audio || assetsOf(c, 'image').length || assetsOf(c, 'video').length) return null;
    return { slots: [SLOT.audio], message: T('Seedance 2.0 系列不能只传音频，至少还要 1 张参考图或 1 段参考视频', 'Seedance 2.0 needs at least one reference image or video alongside audio') };
  },
};

function totalDuration(kind: 'video' | 'audio', limit: number): Constraint {
  const zh = kind === 'video' ? '参考视频' : '参考音频';
  const en = kind === 'video' ? 'Reference videos' : 'Reference audio';
  return {
    id: `C-SE-7-${kind}-total`,
    severity: 'error',
    check: (c) => {
      const sum = assetsOf(c, kind).reduce((s, a) => s + (a.meta?.durationSec ?? 0), 0);
      if (sum <= limit) return null;
      return { slots: [kind === 'video' ? SLOT.video : SLOT.audio], message: T(`${zh}总时长 ${sum.toFixed(1)} 秒，超过上限 ${limit} 秒`, `${en} total ${sum.toFixed(1)} s, over the ${limit} s limit`) };
    },
  };
}

/** 引擎只对 local / task-output 提示"规格未读取"；URL / asset:// 没有时长时补一条 */
function unverifiedDuration(totalVideo: number, totalAudio: number): Constraint {
  return {
    id: 'C-SE-7-unverified',
    severity: 'warn',
    check: (c) => {
      const unknown = [...assetsOf(c, 'video'), ...assetsOf(c, 'audio')].filter((a) => a.meta?.durationSec === undefined && (a.source.type === 'url' || a.source.type === 'provider-asset'));
      if (!unknown.length) return null;
      return {
        slots: [SLOT.video, SLOT.audio],
        message: T(
          `有 ${unknown.length} 个参考视频 / 音频读不到时长，单段时长和总时长（视频 ≤ ${totalVideo} 秒、音频 ≤ ${totalAudio} 秒）未在本地校验`,
          `${unknown.length} reference video / audio item(s) have no known duration; per-clip and total limits (video ≤ ${totalVideo} s, audio ≤ ${totalAudio} s) are not checked locally`,
        ),
      };
    },
  };
}

/** C-SE-8：图片区间开闭文档冲突，恰好落在边界时提示 */
const imageBoundary: Constraint = {
  id: 'C-SE-8-boundary',
  severity: 'warn',
  check: (c) => {
    const hit = assetsOf(c, 'image').some(({ meta }) => {
      if (meta?.width === undefined || meta.height === undefined) return false;
      const r = meta.width / meta.height;
      return [meta.width, meta.height].some((s) => s === IMAGE_SIDE[0] || s === IMAGE_SIDE[1]) || r === IMAGE_ASPECT[0] || r === IMAGE_ASPECT[1];
    });
    return hit
      ? {
          slots: [SLOT.first, SLOT.last, SLOT.image],
          message: T(
            '图片宽高恰好是 300 / 6000 px 或宽高比恰好是 0.4 / 2.5：API 写闭区间、教程写开区间，可能被拒，建议稍作裁剪',
            'Image side is exactly 300 / 6000 px or aspect exactly 0.4 / 2.5: the API says inclusive but the tutorial says exclusive; it may be rejected, consider cropping slightly',
          ),
        }
      : null;
  },
};

const VIDEO_CODECS = /^(h\.?264|avc1?|h\.?265|hevc|hvc1|hev1)$/i;

/** C-SE-8：视频编码只写了 H.264 / H.265 */
const videoCodec: Constraint = {
  id: 'C-SE-8-codec',
  severity: 'warn',
  check: (c) => {
    const bad = assetsOf(c, 'video').find((a) => a.meta?.codec && !VIDEO_CODECS.test(a.meta.codec));
    return bad ? { slots: [SLOT.video], message: T(`视频编码 ${bad.meta!.codec} 不在文档列出的 H.264 / H.265 之内，可能被拒`, `Video codec ${bad.meta!.codec} is not one of the documented H.264 / H.265 and may be rejected`) } : null;
  },
};

/** 素材格式：元数据 mime → 本地文件 mime → URL 最后一段的扩展名 */
function formatOfAsset(a: AssetRef): string | undefined {
  const src = a.source;
  if (a.meta?.mime) return formatOf(a.meta.mime);
  if (src.type === 'local') return formatOf(src.mime || src.filename);
  if (src.type !== 'url') return undefined;
  const path = src.url.split(/[?#]/)[0] ?? '';
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.includes('.') ? formatOf(file) : undefined;
}

/** 文档冲突：教程写 heic / heif 只适用 1.5 Pro 与 2.0 系列，API 与 S25 都列了 2.5 */
const heicImage: Constraint = {
  id: 'C-SE-8-heic',
  severity: 'warn',
  check: (c) =>
    assetsOf(c, 'image').some((a) => ['heic', 'heif'].includes(formatOfAsset(a) ?? ''))
      ? {
          slots: [SLOT.first, SLOT.last, SLOT.image],
          message: T(
            '文档冲突：教程写 heic / heif 只适用 1.5 Pro 与 2.0 系列，API 与 2.5 页写 2.5 也支持；如被拒请转成 jpeg / png',
            'Docs disagree: the tutorial lists heic / heif for 1.5 Pro and 2.0 only, while the API and the 2.5 page include 2.5; convert to jpeg / png if rejected',
          ),
        }
      : null,
};

/** C-SE-9：本地视频需要经上传目标换成公网直链 */
const localVideo: Constraint = {
  id: 'C-SE-9',
  severity: 'info',
  check: (c) =>
    assetsOf(c, 'video').some((a) => a.source.type === 'local')
      ? {
          slots: [SLOT.video],
          message: T('视频只接受 URL 或 asset://：本地视频提交时会上传到临时托管站换成公网直链（链接公开，需确认），也可以改填 URL / asset:// 或复用 24 小时内的生成结果', 'Videos accept URL or asset:// only: local videos are uploaded to a temporary public host on submit (consent required); you can also enter a URL / asset:// or reuse a result from the last 24 hours'),
        }
      : null,
};

/* ---------------- 2.5 任务类型 ---------------- */

/** 2.5 全模态参考（auto）带参考视频时，模型可能判定为编辑 / 延长，ratio / duration 不合规会异步失败 */
const autoTaskType: Constraint = {
  id: 'C-SE-2-auto',
  severity: 'warn',
  check: (c) => {
    if (c.mode.id !== MODE.omni || !assetsOf(c, 'video').length) return null;
    if (c.effective.ratio === 'adaptive' && c.effective.duration === -1) return null;
    return {
      fields: ['ratio', 'duration'],
      message: T(
        '带参考视频且未指定任务类型时，模型可能判定为编辑 / 延长：编辑要求 ratio=adaptive、duration=-1，延长要求 ratio=adaptive，否则任务异步失败；官方建议此时用 adaptive + -1，参考视频每段 4–30 秒。确定要编辑 / 延长请用对应模式',
        'With reference videos and no explicit task type, the model may treat it as edit / extend, which need ratio=adaptive (and duration=-1 for edit) or the task fails asynchronously; the docs recommend adaptive + -1 and 4–30 s clips here. Use the Edit / Extend modes when that is the intent',
      ),
      fix: { label: T('改为 adaptive + 自动时长', 'Use adaptive + auto duration'), patch: { ratio: 'adaptive', duration: -1 } },
    };
  },
};

/** 2.5 全模态参考（auto）带参考视频时，官方建议每段 4–30 秒（判为编辑时源视频必须 4–30 秒，否则异步失败） */
const autoClip: Constraint = {
  id: 'C-SE-2-clip',
  severity: 'warn',
  check: (c) => {
    if (c.mode.id !== MODE.omni) return null;
    const short = assetsOf(c, 'video').filter((a) => a.meta?.durationSec !== undefined && a.meta.durationSec < EDIT_CLIP_SEC[0]);
    if (!short.length) return null;
    return {
      slots: [SLOT.video],
      message: T(
        `有 ${short.length} 段参考视频短于 4 秒：未指定任务类型时官方建议每段 4–30 秒；如果模型判定为编辑，源视频不足 4 秒会异步失败（TaskTypeConstraint）`,
        `${short.length} reference video(s) are shorter than 4 s: without an explicit task type the docs recommend 4–30 s per clip; if the model treats it as an edit, sources under 4 s fail asynchronously (TaskTypeConstraint)`,
      ),
    };
  },
};

/** 未核实：2.5 样片支持哪些输入文档没写（示例是首帧 + 文本） */
function draftWithRefs(p: SeedanceProfile): Constraint {
  return {
    id: 'C-SE-5-input',
    severity: 'warn',
    check: (c) =>
      c.mode.id === MODE.omni && draftOn(p, c)
        ? { fields: ['draft'], message: T('文档没写 2.5 样片支持哪些输入（官方示例是首帧 + 文本），带参考素材的样片可能失败', 'Docs do not say which inputs 2.5 drafts accept (the example uses a first frame + text); drafts with reference assets may fail') }
        : null,
  };
}

/** 文档冲突：S20 能力表的时长只写 4–15 秒，API 写 2.0 系列支持 -1（同一处冲突的 adaptive 选它时不发送 ratio，见 fields.ts） */
const v20AutoDuration: Constraint = {
  id: 'C-SE-20-auto',
  severity: 'warn',
  check: (c) =>
    c.effective.duration === -1
      ? { fields: ['duration'], message: T('文档冲突：Seedance 2.0 页能力表只写 4–15 秒，API 文档写支持 -1（自动）；如被拒请改为具体秒数', 'Docs disagree: the Seedance 2.0 page lists 4–15 s only while the API reference allows -1 (auto); use a fixed length if rejected') }
      : null,
};

/* ---------------- 正片 ---------------- */

function finalSource(p: SeedanceProfile): Constraint {
  return {
    id: 'C-SE-6-source',
    severity: 'error',
    check: (c) => {
      if (c.mode.id !== MODE.final) return null;
      const d = c.input.derivedFrom;
      if (!d || d.relation !== 'draft-final' || !d.upstreamTaskId) {
        return { message: T('正片必须从一个样片任务进入（缺少样片任务 ID）', 'A final must start from a draft task (draft task ID missing)') };
      }
      if (d.modelId !== p.id && d.modelId !== p.apiModel) {
        return { message: T(`正片的模型必须与样片相同（样片用的是 ${d.modelId}）`, `The final must use the same model as the draft (draft used ${d.modelId})`) };
      }
      return null;
    },
  };
}

const finalTtl: Constraint = {
  id: 'C-SE-6-ttl',
  severity: 'error',
  check: (c) => {
    const d = c.input.derivedFrom;
    if (c.mode.id !== MODE.final || !d) return null;
    const until = d.createdAt + DRAFT_TTL_MS;
    return Date.now() >= until ? { message: T('样片任务已超过 7 天有效期，不能再生成正片', 'The draft is older than 7 days and can no longer produce a final') } : null;
  },
};

/** C-SE-6：正片 model 必须与样片相同；本地没记录样片实际发出的 Endpoint ID，用了覆盖时无法核对 */
const finalEndpoint: Constraint = {
  id: 'C-SE-6-model',
  severity: 'warn',
  check: (c) =>
    c.mode.id === MODE.final && c.input.modelOverride
      ? {
          message: T(
            `正片的 model 必须与样片相同：本地没有记录样片实际用的 Endpoint ID，无法核对 ${c.input.modelOverride} 是否一致`,
            `The final must use the same model as the draft: the draft's actual Endpoint ID is not recorded, so ${c.input.modelOverride} cannot be checked`,
          ),
        }
      : null,
};

const finalPrompt: Constraint = {
  id: 'C-SE-6-prompt',
  severity: 'warn',
  check: (c) =>
    c.mode.id === MODE.final && (c.input.prompt ?? '').trim()
      ? { fields: ['prompt'], message: T('正片沿用样片的提示词与素材，这里填写的提示词不会发送', 'The final reuses the draft prompt and assets; this prompt is not sent') }
      : null,
};

export function buildConstraints(p: SeedanceProfile): Constraint[] {
  const out: Constraint[] = [legacyFlags, assetUriInPrompt(p), assetIdInPrompt(p), imageBoundary];
  if (p.heicConflict) out.push(heicImage);
  const o = p.omni;
  if (o) {
    out.push(omniNotEmpty, totalDuration('video', o.totalVideoSec), totalDuration('audio', o.totalAudioSec), unverifiedDuration(o.totalVideoSec, o.totalAudioSec), videoCodec, localVideo);
    if (!o.audioOnly) out.push(noAudioOnly);
  }
  if (p.v2 && p.key !== 'v25') out.push(referenceVideo);
  if (p.v2 && p.key !== 'v25' && p.duration.auto) out.push(v20AutoDuration);
  if (p.editExtend) out.push(editIntent, extendIntent, autoTaskType, autoClip);
  if (p.draft) {
    out.push(finalSource(p), finalTtl, finalEndpoint, finalPrompt);
    if (p.omni) out.push(draftWithRefs(p));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* wireGuard                                                          */
/* ------------------------------------------------------------------ */

const contentOf = (body: Obj): Obj[] => (Array.isArray(body.content) ? body.content.filter(isPlainObject) : []);
const MEDIA_TYPES = ['image_url', 'video_url', 'audio_url'];
const isRefRole = (r: unknown): boolean => typeof r === 'string' && r.startsWith('reference_');
const isFrameRole = (r: unknown): boolean => r === 'first_frame' || r === 'last_frame';

/** content 非空，素材都解析成了 URL / data URI / asset://，draft_task 带 id */
const contentResolved: WireGuard = {
  id: 'content-resolved',
  check: (body) => {
    const list = contentOf(body);
    if (!list.length) return T('content 不能为空', 'content must not be empty');
    for (const item of list) {
      const type = String(item.type ?? '');
      if (MEDIA_TYPES.includes(type)) {
        const url = getPath(item, `${type}.url`);
        if (typeof url !== 'string' || !url) return T('有素材没有解析成 URL / data URI / asset://', 'An asset was not resolved to a URL / data URI / asset://');
      } else if (type === 'draft_task') {
        const id = getPath(item, 'draft_task.id');
        if (typeof id !== 'string' || !id) return T('draft_task 缺少样片任务 ID', 'draft_task is missing the draft task ID');
      } else if (type !== 'text') return T(`未知的 content 类型 ${type}`, `Unknown content type ${type}`);
    }
    return null;
  },
};

/** 首帧 / 首尾帧与全模态参考互斥；首帧、尾帧各最多 1 张，有尾帧必须有首帧 */
const roleExclusive: WireGuard = {
  id: 'role-exclusive',
  check: (body) => {
    const roles = contentOf(body).map((i) => i.role);
    if (roles.some(isFrameRole) && roles.some(isRefRole)) return T('首帧 / 首尾帧与参考图 / 视频 / 音频不能混用', 'First / last frames cannot be mixed with reference images / videos / audio');
    const firsts = roles.filter((r) => r === 'first_frame').length;
    const lasts = roles.filter((r) => r === 'last_frame').length;
    if (firsts > 1 || lasts > 1 || (lasts > 0 && firsts !== 1)) return T('首帧与尾帧各只能 1 张，传尾帧时必须同时传首帧', 'At most one first and one last frame; a last frame needs a first frame');
    return null;
  },
};

/**
 * 模型不支持的能力不能经 rawOverrides 混进请求（文档逐模型列了适用范围的参数与 resolution 枚举）。
 * seed / camera_fixed 对 2.x 是否生效有冲突，按方案留给 rawOverrides，不拦截。
 */
function capability(p: SeedanceProfile): WireGuard {
  const name = p.label.en;
  return {
    id: 'capability',
    check: (body) => {
      const list = contentOf(body);
      if (!p.omni && list.some((i) => i.type === 'video_url' || i.type === 'audio_url' || isRefRole(i.role))) return T(`${p.label.zh} 不支持参考图 / 视频 / 音频`, `${name} does not support reference images / videos / audio`);
      if (!p.firstLast && list.some((i) => i.role === 'last_frame')) return T(`${p.label.zh} 不支持首尾帧`, `${name} does not support first + last frames`);
      if (!p.editExtend && body.omni_reference_task_type !== undefined) return T('只有 Seedance 2.5 支持 omni_reference_task_type', 'Only Seedance 2.5 supports omni_reference_task_type');
      if (!p.draft && (body.draft === true || list.some((i) => i.type === 'draft_task'))) return T(`${p.label.zh} 不支持样片`, `${name} does not support drafts`);
      if (!p.outputFormat && body.output_format !== undefined) return T('只有 Seedance 2.5 支持 output_format', 'Only Seedance 2.5 supports output_format');
      if (!p.frames && body.frames !== undefined) return T('只有 Seedance 1.0 pro / pro fast 支持 frames', 'Only Seedance 1.0 pro / pro fast support frames');
      if (!p.generateAudio && body.generate_audio !== undefined) return T('只有 Seedance 2.5、2.0 系列、1.5 pro 支持 generate_audio', 'Only Seedance 2.5, 2.0 and 1.5 pro support generate_audio');
      if (!p.priority && body.priority !== undefined) return T('只有 Seedance 2.5、2.0 系列支持 priority', 'Only Seedance 2.5 and 2.0 support priority');
      if (body.resolution !== undefined && !p.resolutions.includes(String(body.resolution))) return T(`${p.label.zh} 的 resolution 只能是 ${p.resolutions.join(' / ')}`, `${name} resolution must be one of ${p.resolutions.join(' / ')}`);
      return null;
    },
  };
}

/** C-SE-7：参考素材数量；2.0 系列不能只传音频 */
function refCounts(p: SeedanceProfile): WireGuard {
  const o = p.omni!;
  return {
    id: 'C-SE-7',
    check: (body) => {
      const list = contentOf(body);
      const n = (role: string): number => list.filter((i) => i.role === role).length;
      if (n('reference_image') > o.image || n('reference_video') > o.video || n('reference_audio') > o.audio) {
        return T(`参考素材最多 图 ${o.image} / 视频 ${o.video} / 音频 ${o.audio}`, `At most ${o.image} images / ${o.video} videos / ${o.audio} audio references`);
      }
      const audio = list.some((i) => i.type === 'audio_url');
      if (!o.audioOnly && audio && !list.some((i) => i.type === 'image_url' || i.type === 'video_url')) return T('Seedance 2.0 系列不能只传音频', 'Seedance 2.0 cannot take audio alone');
      return null;
    },
  };
}

/** C-SE-2：2.5 首帧 / 首尾帧 / 编辑 / 延长必须 adaptive（不传时默认就是 adaptive） */
const adaptiveRatio: WireGuard = {
  id: 'C-SE-2',
  check: (body) => {
    const t = body.omni_reference_task_type;
    const constrained = contentOf(body).some((i) => isFrameRole(i.role)) || t === 'edit' || t === 'extend';
    return constrained && body.ratio !== undefined && body.ratio !== 'adaptive'
      ? T('Seedance 2.5 首帧 / 首尾帧 / 编辑 / 延长任务的 ratio 必须是 adaptive（否则异步失败）', 'Seedance 2.5 first-frame / first-last / edit / extend tasks need ratio=adaptive (otherwise they fail asynchronously)')
      : null;
  },
};

/** C-SE-3：编辑 duration 只能 -1（不传时 2.5 默认 -1）；编辑 / 延长至少 1 段参考视频 */
const editExtendShape: WireGuard = {
  id: 'C-SE-3',
  check: (body) => {
    const t = body.omni_reference_task_type;
    if (t !== 'edit' && t !== 'extend') return null;
    if (!contentOf(body).some((i) => i.type === 'video_url')) return T('编辑 / 延长至少需要 1 段参考视频', 'Edit / extend need at least one reference video');
    if (t === 'edit' && body.duration !== undefined && body.duration !== -1) return T('编辑任务的 duration 只能是 -1', 'Edit tasks only accept duration -1');
    return null;
  },
};

/** C-SE-5：样片只能 480p（显式发送） */
const draftResolution: WireGuard = {
  id: 'C-SE-5',
  check: (body) => (body.draft === true && body.resolution !== '480p' ? T('样片必须显式传 resolution=480p', 'Drafts must send resolution=480p') : null),
};

/** C-SE-6：正片只发 draft_task 与允许重设的字段 */
function finalShape(p: SeedanceProfile): WireGuard {
  return {
    id: 'C-SE-6',
    check: (body) => {
      const list = contentOf(body);
      if (!list.some((i) => i.type === 'draft_task')) return null;
      if (list.length !== 1) return T('正片的 content 只能有 draft_task 一项，不能再带提示词或素材', 'A final may only contain draft_task in content (no prompt or assets)');
      const banned = FINAL_BANNED_KEYS.filter((k) => body[k] !== undefined);
      if (banned.length) return T(`正片沿用样片的参数，不能再传：${banned.join(', ')}`, `A final reuses draft parameters; remove: ${banned.join(', ')}`);
      if (body.draft === true) return T('正片不能再设 draft=true', 'A final cannot set draft=true');
      if (p.key === 'v25' && body.resolution !== undefined && body.resolution !== '1080p') return T('2.5 正片只支持 1080p', 'Seedance 2.5 finals are 1080p only');
      return null;
    },
  };
}

/** C-SE-13：flex 只开放给 1.x，且 1.5 pro 样片不支持 */
function flexTier(p: SeedanceProfile): WireGuard {
  return {
    id: 'C-SE-13',
    check: (body) => {
      if (body.service_tier !== 'flex') return null;
      if (!p.flex) return T('Seedance 2.5 / 2.0 系列不支持 service_tier=flex', 'Seedance 2.5 / 2.0 do not support service_tier=flex');
      return body.draft === true ? T('样片不支持离线推理（flex）', 'Drafts do not support flex') : null;
    },
  };
}

export function buildGuards(p: SeedanceProfile): WireGuard[] {
  return [
    contentResolved,
    roleExclusive,
    capability(p),
    ...(p.omni ? [refCounts(p)] : []),
    ...(p.adaptiveOnly ? [adaptiveRatio] : []),
    ...(p.editExtend ? [editExtendShape] : []),
    ...(p.draft ? [draftResolution, finalShape(p)] : []),
    flexTier(p),
  ];
}
