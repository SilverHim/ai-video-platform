/**
 * Seedream 约束（C-SD-*）与 wireGuard。
 * 能写成声明的硬性规则放在 SlotDef / SizeSpec 上，由引擎统一报错（张数、格式、像素、alpha、自定义尺寸区间）；
 * 同 ID 的 Constraint 只补充引擎查不到的情形（URL 素材无元数据、文档冲突）或给出一键修复，避免重复报错。
 */
import type { AssetRef, Constraint, PredCtx, WireGuard } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { isSizeValue } from '../../../engine/evaluate.js';
import { formatOf } from '../../../engine/media.js';
import { getPath } from '../../../request/wire.js';
import { GROUP_TOTAL_LIMIT, PROFILES, type SeedreamProfile } from './profile.js';
import { LAYER_DEFAULT, LAYER_TIERS, customSizeOk, fitCustomSize, fmtInt } from './sizes.js';

/** 生成场景输入格式 */
export const GEN_FORMATS = ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'heic', 'heif'];
/** 透明背景输入格式：去掉不支持 alpha 的 jpeg */
export const TRANSPARENT_FORMATS = GEN_FORMATS.filter((f) => f !== 'jpeg');
export const LAYER_MIN_PIXELS = 262_144;

const images = (c: PredCtx): AssetRef[] => c.slots.image ?? [];

function assetFormat(a: AssetRef): string | undefined {
  return formatOf(a.meta?.mime ?? (a.source.type === 'local' ? a.source.mime : undefined));
}

/** 引擎只对 local / task-output 提示"未能读取规格"；URL 素材没有元数据时由约束补一条 */
const unverifiableUrl = (a: AssetRef, need: 'size' | 'alpha'): boolean =>
  a.source.type === 'url' && (need === 'alpha' ? a.meta?.hasAlpha === undefined : a.meta?.width === undefined || a.meta.height === undefined || assetFormat(a) === undefined);

/** C-SD-1：图层分解只能 1 张 png/jpeg，总像素 ≥ 262,144（硬规则在 layer 槽位） */
const layerInput: Constraint = {
  id: 'C-SD-1',
  severity: 'warn',
  check: (c) => {
    const a = c.mode.id === 'layer' ? images(c)[0] : undefined;
    if (!a || !unverifiableUrl(a, 'size')) return null;
    return {
      slots: ['image'],
      message: T(
        `图层分解要求 1 张 PNG/JPEG、总像素 ≥ ${fmtInt(LAYER_MIN_PIXELS)}（512×512）；该 URL 图片无法在本地校验，不符合会报错`,
        `Layer decomposition needs one PNG/JPEG with ≥ ${fmtInt(LAYER_MIN_PIXELS)} pixels (512×512); this URL image cannot be checked locally and the request errors if it does not comply`,
      ),
    };
  },
};

/** C-SD-2：透明背景要求恰好 1 张带 alpha 的输入（硬规则在 transparent 槽位 requireAlpha），输出锁 png */
const transparentInput: Constraint = {
  id: 'C-SD-2',
  severity: 'warn',
  check: (c) => {
    const a = c.mode.id === 'transparent' ? images(c)[0] : undefined;
    if (!a) return null;
    const fmt = assetFormat(a);
    // 未核实：正文只排除 jpeg 等不支持 alpha 的格式；"仅 PNG" 只出自 arkcli 元数据（非文档正文），保守给 warn
    if (fmt && fmt !== 'png' && TRANSPARENT_FORMATS.includes(fmt)) {
      const F = fmt.toUpperCase();
      return {
        slots: ['image'],
        message: T(
          `文档只排除 JPEG 等不支持透明的格式；arkcli 元数据写仅支持 PNG（未核实），${F} 可能被拒，建议用带透明通道的 PNG`,
          `Docs only exclude formats without alpha such as JPEG; arkcli metadata says PNG only (unverified), so ${F} may be rejected — a PNG with alpha is recommended`,
        ),
      };
    }
    if (unverifiableUrl(a, 'alpha')) {
      return {
        slots: ['image'],
        message: T('该 URL 图片无法在本地确认是否带透明通道；没有 alpha 时请求会报错', 'Cannot check locally whether this URL image has an alpha channel; the request fails without one'),
      };
    }
    return null;
  },
};

/** C-SD-4：组图时参考图数 + max_images ≤ 15 */
const groupTotal: Constraint = {
  id: 'C-SD-4',
  severity: 'warn',
  // 推断：文档只约束实际生成张数（参考图 + 生成 ≤ 15），请求里超出时报错还是截断未说明，只给 warn
  check: (c) => {
    if (c.mode.id !== 'group') return null;
    const refs = images(c).length;
    const max = c.effective.max_images;
    if (typeof max !== 'number' || refs + max <= GROUP_TOTAL_LIMIT) return null;
    const to = Math.max(1, GROUP_TOTAL_LIMIT - refs);
    return {
      fields: ['max_images'],
      slots: ['image'],
      message: T(
        `参考图 ${refs} 张 + 最多生成 ${max} 张超过 ${GROUP_TOTAL_LIMIT}，实际最多只能生成 ${to} 张`,
        `${refs} reference image(s) + up to ${max} generated exceeds ${GROUP_TOTAL_LIMIT}; at most ${to} can be generated`,
      ),
      fix: { label: T(`改为 ${to} 张`, `Set to ${to}`), patch: { max_images: to } },
    };
  },
};

/** C-SD-5：自定义像素区间与宽高比 [1/16,16]（报错来自 SizeSpec.custom，这里给一键修复） */
function customSize(p: SeedreamProfile): Constraint {
  const [min, max] = p.size.pixels;
  return {
    id: 'C-SD-5',
    severity: 'info',
    check: (c) => {
      const v = c.effective.size;
      if (!isSizeValue(v) || v.mode !== 'custom') return null;
      if (c.mode.id === 'layer') {
        return {
          fields: ['size'],
          message: T('图层分解只支持档位（1K / 1.5K / 2K）或 auto', 'Layer decomposition accepts tiers (1K / 1.5K / 2K) or auto only'),
          fix: { label: T('改为 auto', 'Use auto'), patch: { size: { mode: 'preset', value: LAYER_DEFAULT } } },
        };
      }
      if (customSizeOk(v.width, v.height, p.size.pixels)) return null;
      const fit = fitCustomSize(v.width, v.height, p.size.pixels);
      const range = `${fmtInt(min)}–${fmtInt(max)}`;
      return {
        fields: ['size'],
        message: T(`${p.label.zh} 自定义尺寸需总像素 ${range}、宽高比 1/16–16`, `${p.label.en} custom size needs ${range} total pixels and aspect 1/16–16`),
        fix: fit
          ? { label: T(`改为 ${fit.width}x${fit.height}`, `Use ${fit.width}x${fit.height}`), patch: { size: { mode: 'custom', ...fit } } }
          : { label: T(`改用 ${p.size.defaultTier} 档位`, `Use the ${p.size.defaultTier} tier`), patch: { size: { mode: 'preset', value: p.size.defaultTier } } },
      };
    },
  };
}

/** C-SD-6：参考图上限 pro/flash 10、其余 14（报错来自槽位 max），超出时提示可换用上限更高的模型 */
function refCap(p: SeedreamProfile): Constraint | null {
  const higher = PROFILES.filter((o) => o.maxRefs > p.maxRefs);
  if (!higher.length) return null;
  const names = higher.map((o) => o.label.en).join(' / ');
  const top = Math.max(...higher.map((o) => o.maxRefs));
  return {
    id: 'C-SD-6',
    severity: 'info',
    check: (c) =>
      images(c).length > p.maxRefs
        ? { slots: ['image'], message: T(`${p.label.zh} 最多 ${p.maxRefs} 张参考图；需要更多可改用 ${names}（最多 ${top} 张）`, `${p.label.en} accepts up to ${p.maxRefs} reference images; ${names} accept up to ${top}`) }
        : null,
  };
}

export function buildConstraints(p: SeedreamProfile): Constraint[] {
  const cap = refCap(p);
  return [
    ...(p.layer ? [layerInput] : []),
    ...(p.transparent ? [transparentInput] : []),
    ...(p.group ? [groupTotal] : []),
    customSize(p),
    ...(cap ? [cap] : []),
  ];
}

/* ------------------------------------------------------------------ */
/* wireGuard：对最终请求体兜底（含 rawOverrides 写入的字段）              */
/* ------------------------------------------------------------------ */

const imageList = (body: Record<string, unknown>): unknown[] => (body.image === undefined ? [] : Array.isArray(body.image) ? body.image : [body.image]);

export function buildGuards(p: SeedreamProfile): WireGuard[] {
  const guards: WireGuard[] = [
    {
      id: 'C-SD-6',
      check: (body) => (imageList(body).length > p.maxRefs ? T(`${p.label.zh} 最多 ${p.maxRefs} 张参考图`, `${p.label.en} accepts at most ${p.maxRefs} reference images`) : null),
    },
    {
      id: 'image-resolved',
      check: (body) => (imageList(body).some((v) => typeof v !== 'string' || v === '') ? T('有参考图没有解析成 URL 或 data URI', 'A reference image was not resolved to a URL or data URI') : null),
    },
  ];
  if (p.layer) {
    guards.push({
      id: 'C-SD-1',
      check: (body) => {
        if (body.layer_decomposition !== true) return null;
        if (typeof body.image !== 'string') return T('图层分解必须且只能传 1 张图（字符串）', 'Layer decomposition needs exactly one image (string)');
        if (body.size !== undefined && !(LAYER_TIERS as readonly unknown[]).includes(body.size)) return T('图层分解的 size 只能是 1K / 1.5K / 2K / auto', 'Layer decomposition size must be 1K / 1.5K / 2K / auto');
        return null;
      },
    });
  }
  if (p.transparent) {
    guards.push({
      id: 'C-SD-2',
      check: (body) => {
        if (body.background !== 'transparent') return null;
        if (body.output_format !== 'png') return T('透明背景必须输出 PNG（jpeg 会报错）', 'Transparent background must output PNG (jpeg errors)');
        if (typeof body.image !== 'string') return T('透明背景需要恰好 1 张输入图', 'Transparent background needs exactly one input image');
        // 未核实：透明背景能否与图层分解同时使用，文档未说明，保守拦截
        if (body.layer_decomposition === true) return T('文档未说明透明背景能否与图层分解同时使用', 'Docs do not say whether transparent background can combine with layer decomposition');
        return null;
      },
    });
  }
  if (!p.group) {
    guards.push({
      id: 'no-sequential',
      check: (body) => (body.sequential_image_generation !== undefined || body.sequential_image_generation_options !== undefined ? T(`${p.label.zh} 不支持组图`, `${p.label.en} does not support group generation`) : null),
    });
  }
  if (!p.stream) {
    guards.push({ id: 'no-stream', check: (body) => (body.stream === true ? T(`${p.label.zh} 不支持流式输出`, `${p.label.en} does not support streaming`) : null) });
  }
  if (!p.fast) {
    guards.push({
      id: 'no-fast',
      check: (body) => (getPath(body, 'optimize_prompt_options.mode') === 'fast' ? T(`${p.label.zh} 不支持 fast 提示词优化`, `${p.label.en} does not support fast prompt optimization`) : null),
    });
  }
  if (!p.outputFormat) {
    // 文档冲突：[C] 写 4.x 固定 jpeg、不支持自定义，同页 fast 示例却给 4.0 传了 png；报告建议 4.x 不发送
    guards.push({
      id: 'no-output-format',
      check: (body) => (body.output_format !== undefined ? T(`${p.label.zh} 不支持自定义输出格式（固定 JPEG）`, `${p.label.en} does not support a custom output format (JPEG only)`) : null),
    });
  }
  if (!p.layer) {
    guards.push({
      id: 'no-layer-background',
      check: (body) => (body.layer_decomposition === true || body.background === 'transparent' ? T('只有 Seedream 5.0 pro / flash 支持图层分解与透明背景', 'Only Seedream 5.0 pro / flash support layer decomposition and transparent background') : null),
    });
  }
  return guards;
}
