/** MiniMax V2 视频的跨字段约束与最终请求体检查 */
import type { AssetRef, Constraint, EvalCtx, WireGuard } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { promptRefIds } from '../../../engine/refs.js';
import { isPlainObject, type JsonObject } from '../../../request/wire.js';
import {
  DOCS,
  EXPANSION_MODES,
  MODE_I2V,
  MODE_I2V_LAST,
  MODE_R2V,
  RATIOS,
  REF_LIMITS,
  REF_SLOTS,
  REF_TOTAL_MAX,
  REF_TOTAL_SEC,
  SLOT_FIRST,
  SLOT_LAST,
  SLOT_REF_AUDIO,
  SLOT_REF_IMAGE,
  SLOT_REF_VIDEO,
  SPECIFIC_RATIOS,
  TEXT_MAX_CHARS,
  type H3Profile,
} from './profile.js';

const list = (c: EvalCtx, slotId: string): AssetRef[] => c.slots[slotId] ?? [];
const modeAssets = (c: EvalCtx): { slotId: string; asset: AssetRef }[] => c.mode.slots.flatMap((s) => list(c, s.id).map((asset) => ({ slotId: s.id, asset })));
/** 已知时长之和；时长未知的素材不计（单段规格的"未校验"提示由引擎给出） */
const knownSeconds = (items: AssetRef[]): number => items.reduce((s, a) => s + (a.meta?.durationSec ?? 0), 0);
const EPS = 1e-6;

/** 与 src/server/assets/resolver.ts 的 MINIMAX_INLINE_LIMIT 一致：本地图片超过它，提交时自动经 minimax-files 上传成 mm_file:// */
export const MINIMAX_INLINE_LIMIT = 10 * 1024 * 1024;

/** 文档：视频编码 H.264/AVC、H.265/HEVC（ffprobe codec_name 及常见 FourCC） */
const VIDEO_CODECS = new Set(['h264', 'avc', 'avc1', 'hevc', 'h265', 'hvc1', 'hev1']);

function totalDuration(id: string, slotId: string, what: ReturnType<typeof T>): Constraint {
  return {
    id,
    severity: 'error',
    docs: [DOCS.create, DOCS.guide],
    check: (c) => {
      if (c.mode.id !== MODE_R2V) return null;
      const sec = knownSeconds(list(c, slotId));
      return sec > REF_TOTAL_SEC + EPS
        ? {
            slots: [slotId],
            message: T(`${what.zh}总时长 ${sec.toFixed(2)} 秒，超过 ${REF_TOTAL_SEC} 秒上限`, `${what.en} total ${sec.toFixed(2)} s, over the ${REF_TOTAL_SEC} s limit`),
          }
        : null;
    },
  };
}

export const H3_CONSTRAINTS: Constraint[] = [
  {
    id: 'C-MM-H3-1',
    severity: 'error',
    docs: [DOCS.create],
    check: (c) =>
      typeof c.effective.duration === 'number'
        ? null
        : { fields: ['duration'], message: T('时长是必填项，必须填写整数秒数', 'Duration is required and must be a whole number of seconds') },
  },
  {
    // 文档冲突：content 描述与 guide 允许只传尾帧，role 描述写 last_frame "must be paired with first_frame" → 取保守做法
    id: 'C-MM-H3-2',
    severity: 'error',
    docs: [DOCS.create, DOCS.guide],
    check: (c) =>
      c.mode.id === MODE_I2V && list(c, SLOT_LAST).length > 0 && list(c, SLOT_FIRST).length === 0
        ? {
            slots: [SLOT_FIRST, SLOT_LAST],
            message: T(
              '文档冲突：本模式暂不支持只传尾帧，请同时提供首帧；要试只传尾帧请用实验模式「仅尾帧」',
              'Docs conflict: this mode does not support a last frame alone; add a first frame, or try the experimental "Last frame only" mode',
            ),
          }
        : null,
  },
  {
    // 推断：参考生视频是"text + 参考素材的任意组合"，没有参考素材时等同文生视频
    id: 'C-MM-H3-3',
    severity: 'error',
    docs: [DOCS.create, DOCS.guide],
    check: (c) =>
      c.mode.id === MODE_R2V && REF_SLOTS.every((s) => list(c, s).length === 0)
        ? { slots: [...REF_SLOTS], message: T('参考生视频至少需要 1 个参考素材；只有文字请改用文生视频', 'Reference-to-video needs at least one reference; use text-to-video for text only') }
        : null,
  },
  {
    id: 'C-MM-H3-4',
    severity: 'error',
    docs: [DOCS.guide],
    check: (c) => {
      if (c.mode.id !== MODE_R2V) return null;
      const n = REF_SLOTS.reduce((s, id) => s + list(c, id).length, 0);
      return n > REF_TOTAL_MAX
        ? { slots: [...REF_SLOTS], message: T(`参考素材合计最多 ${REF_TOTAL_MAX} 个（当前 ${n}）`, `At most ${REF_TOTAL_MAX} reference files in total (got ${n})`) }
        : null;
    },
  },
  totalDuration('C-MM-H3-5', SLOT_REF_VIDEO, T('参考视频', 'Reference videos')),
  totalDuration('C-MM-H3-6', SLOT_REF_AUDIO, T('参考音频', 'Reference audio')),
  {
    id: 'C-MM-H3-7',
    severity: 'warn',
    docs: [DOCS.create],
    check: (c) => {
      if (c.mode.id !== MODE_R2V) return null;
      const bad = list(c, SLOT_REF_VIDEO).filter((a) => a.meta?.codec && !VIDEO_CODECS.has(a.meta.codec.toLowerCase()));
      return bad.length
        ? {
            slots: [SLOT_REF_VIDEO],
            message: T(
              `参考视频编码 ${bad.map((a) => a.meta!.codec).join(', ')} 不在文档列出的 H.264 / H.265 之内，可能被拒绝`,
              `Reference video codec ${bad.map((a) => a.meta!.codec).join(', ')} is not H.264 / H.265 as documented; it may be rejected`,
            ),
          }
        : null;
    },
  },
  {
    // mm_file:// 有效期 7 天，过期后生成返回 file expired
    id: 'C-MM-H3-8',
    severity: 'error',
    docs: [DOCS.files, DOCS.create],
    check: (c) => {
      const files = modeAssets(c).filter(({ asset }) => asset.source.type === 'provider-file');
      const foreign = files.find(({ asset }) => asset.source.type === 'provider-file' && !asset.source.uri.startsWith('mm_file://'));
      if (foreign) return { slots: [foreign.slotId], message: T('服务商文件引用必须是 mm_file://<file_id>', 'Provider file references must be mm_file://<file_id>') };
      const now = Date.now();
      const expired = files.find(({ asset }) => asset.source.type === 'provider-file' && asset.source.expiresAt !== undefined && asset.source.expiresAt <= now);
      return expired
        ? { slots: [expired.slotId], message: T('mm_file 文件已超过 7 天有效期，请重新上传', 'The mm_file has passed its 7-day validity; upload it again') }
        : null;
    },
  },
  {
    // 未核实：files 上传的 purpose=video_generation_input 描述只点名首帧、参考图 / 视频 / 音频，没有尾帧；
    // 直接传 mm_file，或本地尾帧超过内联上限被自动上传成 mm_file，都给 warn
    id: 'C-MM-H3-9',
    severity: 'warn',
    docs: [DOCS.files],
    check: (c) => {
      if (!c.mode.slots.some((s) => s.id === SLOT_LAST)) return null;
      const lasts = list(c, SLOT_LAST);
      if (lasts.some((a) => a.source.type === 'provider-file')) {
        return {
          slots: [SLOT_LAST],
          message: T('文件上传文档没有点名尾帧可用 mm_file，可能被拒绝；可改用 URL 或本地图片', 'The upload docs do not list the last frame as an mm_file use; it may be rejected. Use a URL or a local image instead'),
        };
      }
      return lasts.some((a) => a.source.type === 'local' && a.source.bytes > MINIMAX_INLINE_LIMIT)
        ? {
            slots: [SLOT_LAST],
            message: T(
              '本地尾帧超过 10 MiB，提交时会自动上传成 mm_file；文件上传文档没有点名尾帧可用 mm_file，可能被拒绝。可压缩到 10 MiB 以内或改用 URL',
              'The local last frame is over 10 MiB and will be uploaded as an mm_file on submit; the upload docs do not list the last frame as an mm_file use, so it may be rejected. Compress it below 10 MiB or use a URL',
            ),
          }
        : null;
    },
  },
  {
    // 未核实：文档没有定义提示词里引用素材的写法
    id: 'C-MM-H3-10',
    severity: 'warn',
    docs: [DOCS.create, DOCS.guide],
    check: (c) => {
      if (promptRefIds(c.input.prompt ?? '').length === 0) return null;
      const label = c.mode.id === MODE_R2V ? 'reference image n / reference video n / reference audio n' : 'Image n';
      const basis = c.mode.id === MODE_R2V ? T('（措辞取自官方示例，不是规则）', ' (wording taken from the official example, not a rule)') : T('', '');
      return {
        fields: ['prompt'],
        message: T(
          `文档没有定义在提示词里引用素材的写法，引用会按纯文本「${label}」发送${basis.zh}，编号与素材顺序一致`,
          `Docs define no syntax for referencing assets in the prompt; references are sent as plain text "${label}"${basis.en}, numbered in asset order`,
        ),
      };
    },
  },
  {
    // 文档冲突：content 描述与 guide 允许只传尾帧，role 描述写 last_frame "must be paired with first_frame"
    id: 'C-MM-H3-12',
    severity: 'warn',
    docs: [DOCS.create, DOCS.guide],
    check: (c) =>
      c.mode.id === MODE_I2V_LAST
        ? {
            slots: [SLOT_LAST],
            message: T(
              '文档冲突：content 描述与 guide 允许只传尾帧，role 描述却写尾帧必须与首帧成对；该请求可能被服务商拒绝',
              'Docs conflict: the content description and guide allow a last frame alone, but the role description says it must be paired with a first frame; this may be rejected',
            ),
          }
        : null,
  },
];

/** 只挂在 H3-Max 上 */
export const MAX_R2V_CONFLICT: Constraint = {
  id: 'C-MM-H3-11',
  severity: 'warn',
  docs: [DOCS.models, DOCS.overview, DOCS.guide],
  check: (c) =>
    c.mode.id === MODE_R2V
      ? {
          message: T(
            '文档冲突：API 参考与 guide 写 H3-Max 支持参考生视频，模型介绍页只列文生 / 图生视频；该组合可能被服务商拒绝',
            'Docs conflict: the API reference and guide say H3-Max supports reference-to-video, but the models page lists only T2V / I2V; this may be rejected',
          ),
        }
      : null,
};

/* ---------------- wireGuard（主要拦截原始字段覆盖造成的非法组合） ---------------- */

const MEDIA_ROLES: Record<string, string[]> = {
  image_url: [SLOT_FIRST, SLOT_LAST, SLOT_REF_IMAGE],
  video_url: [SLOT_REF_VIDEO],
  audio_url: [SLOT_REF_AUDIO],
};
const REF_ROLES = new Set<string>(REF_SLOTS);

const contentOf = (b: JsonObject): unknown[] => (Array.isArray(b.content) ? b.content : []);
const objects = (b: JsonObject): JsonObject[] => contentOf(b).filter(isPlainObject);
const media = (b: JsonObject): JsonObject[] => objects(b).filter((i) => i.type !== 'text');
const roleCount = (b: JsonObject, role: string): number => media(b).filter((i) => i.role === role).length;
const chars = (s: string): number => [...s].length;

export function h3WireGuards(p: H3Profile): WireGuard[] {
  return [
    {
      // 不允许覆盖 model：其余检查都按本模型的取值范围判断
      id: 'mm-h3-model',
      check: (b) => (b.model === p.apiModel ? null : T(`model 必须是 ${p.apiModel}，不支持覆盖`, `model must be ${p.apiModel}; overriding it is not supported`)),
    },
    {
      id: 'mm-h3-text',
      check: (b) =>
        objects(b).some((i) => i.type === 'text' && typeof i.text === 'string' && i.text.trim() !== '')
          ? null
          : T('content 必须包含 1 条非空 text', 'content must include a non-empty text item'),
    },
    {
      id: 'mm-h3-text-max',
      check: (b) =>
        objects(b).some((i) => i.type === 'text' && typeof i.text === 'string' && chars(i.text) > TEXT_MAX_CHARS)
          ? T(`每条 text 最多 ${TEXT_MAX_CHARS} 个字符`, `Each text item allows at most ${TEXT_MAX_CHARS} characters`)
          : null,
    },
    {
      // role 条件必填：只有 1 张图且没写 role 时默认当作首帧
      id: 'mm-h3-media',
      check: (b) => {
        const items = contentOf(b);
        if (items.some((i) => !isPlainObject(i))) return T('content 里有非对象条目', 'content has a non-object item');
        const ms = media(b);
        for (const i of ms) {
          const type = String(i.type);
          const roles = MEDIA_ROLES[type];
          if (!roles) return T(`content 条目类型「${type}」不受支持`, `Unsupported content item type "${type}"`);
          const ref = i[type];
          if (!isPlainObject(ref) || typeof ref.url !== 'string' || ref.url === '') return T(`${type}.url 不能为空`, `${type}.url must not be empty`);
          if (i.role === undefined) {
            if (!(type === 'image_url' && ms.length === 1)) return T('有多个素材时每个都必须写 role', 'Every item needs a role when there are several media items');
          } else if (typeof i.role !== 'string' || !roles.includes(i.role)) {
            return T(`${type} 的 role「${String(i.role)}」不合法`, `Invalid role "${String(i.role)}" for ${type}`);
          }
        }
        return null;
      },
    },
    {
      // 只传尾帧（文档冲突）只在实验模式「仅尾帧」下放行
      id: 'mm-h3-frames',
      check: (b, c) => {
        const ms = media(b);
        const loneImage = ms.length === 1 && ms[0]!.type === 'image_url' && ms[0]!.role === undefined;
        const first = roleCount(b, SLOT_FIRST) + (loneImage ? 1 : 0);
        const last = roleCount(b, SLOT_LAST);
        if (first > 1 || last > 1) return T('首帧、尾帧各最多 1 张', 'At most one first frame and one last frame');
        if (last > 0 && first === 0 && c.mode.id !== MODE_I2V_LAST) {
          return T('文档冲突：只传尾帧仅在实验模式「仅尾帧」下发送', 'Docs conflict: a last frame alone is only sent in the experimental "Last frame only" mode');
        }
        const hasFrame = first + last > 0;
        const hasRef = ms.some((i) => typeof i.role === 'string' && REF_ROLES.has(i.role));
        if (hasFrame && hasRef) return T('首尾帧与参考素材不能出现在同一个请求里', 'Frames and reference media cannot be mixed in one request');
        return null;
      },
    },
    {
      id: 'mm-h3-refs',
      check: (b) => {
        const counts = REF_SLOTS.map((r) => roleCount(b, r));
        const over = REF_SLOTS.find((r, i) => counts[i]! > REF_LIMITS[r]);
        if (over) return T(`${over} 最多 ${REF_LIMITS[over]} 个`, `At most ${REF_LIMITS[over]} ${over} items`);
        const total = counts.reduce((s, n) => s + n, 0);
        return total > REF_TOTAL_MAX ? T(`参考素材合计最多 ${REF_TOTAL_MAX} 个`, `At most ${REF_TOTAL_MAX} reference files in total`) : null;
      },
    },
    {
      id: 'mm-h3-ratio',
      check: (b) => {
        const has = b.ratio !== undefined;
        if (has && !(RATIOS as readonly unknown[]).includes(b.ratio)) return T(`ratio「${String(b.ratio)}」不受支持`, `Unsupported ratio "${String(b.ratio)}"`);
        if (media(b).length === 0 && !SPECIFIC_RATIOS.includes(b.ratio as string)) {
          return T('文生视频的 ratio 必填，且不能是 adaptive', 'Text-to-video requires a ratio other than adaptive');
        }
        return null;
      },
    },
    {
      id: 'mm-h3-resolution',
      check: (b) =>
        typeof b.resolution === 'string' && p.resolutions.includes(b.resolution)
          ? null
          : T(`${p.apiModel} 的 resolution 只能是 ${p.resolutions.join(' / ')}`, `${p.apiModel} resolution must be ${p.resolutions.join(' / ')}`),
    },
    {
      id: 'mm-h3-duration',
      check: (b) =>
        typeof b.duration === 'number' && Number.isInteger(b.duration) && b.duration >= p.duration[0] && b.duration <= p.duration[1]
          ? null
          : T(`${p.apiModel} 的 duration 必须是 ${p.duration[0]}–${p.duration[1]} 的整数`, `${p.apiModel} duration must be an integer ${p.duration[0]}–${p.duration[1]}`),
    },
    {
      // 未核实：传 extra 给 MiniMax-H3 会怎样文档未说明 → 不发送；H3-Max 的 extra 为 additionalProperties:false
      id: 'mm-h3-extra',
      check: (b) => {
        if (b.extra === undefined) return null;
        if (!p.promptExpansion) return T('MiniMax-H3 不发送 extra（文档未说明其行为）', 'MiniMax-H3 does not send extra (its behavior is undocumented)');
        const e = b.extra;
        const ok = isPlainObject(e) && Object.keys(e).every((k) => k === 'prompt_expansion_mode') && (e.prompt_expansion_mode === undefined || (EXPANSION_MODES as readonly unknown[]).includes(e.prompt_expansion_mode));
        return ok ? null : T('extra 只接受 prompt_expansion_mode（disabled / balanced / quality）', 'extra only accepts prompt_expansion_mode (disabled / balanced / quality)');
      },
    },
    {
      // 文档只给出 data:video/mp4;base64,…
      id: 'mm-h3-video-data-uri',
      check: (b) =>
        media(b).some((i) => i.type === 'video_url' && isPlainObject(i.video_url) && typeof i.video_url.url === 'string' && i.video_url.url.startsWith('data:') && !i.video_url.url.startsWith('data:video/mp4;'))
          ? T('视频以 Data URL 发送时只能是 data:video/mp4；其他格式请改用 URL 或 mm_file', 'Inline videos must be data:video/mp4; use a URL or mm_file for other formats')
          : null,
    },
  ];
}
