import type { FieldDef, FormValues, ModeDef, ModelDef, OutputKind, PredCtx, ProviderDef } from './types';

/**
 * 从模型声明推导出的能力标签，供工作台的模型筛选使用。
 * 全部按约定从 modes / slots / fields 推导，新增服务商只要沿用这些约定就会自动出现在筛选里：
 *   - 素材槽 id：first_frame / last_frame 表示首帧 / 尾帧，其余图片槽都算"参考图"
 *   - 字段 key：generate_audio（有声）、draft（样片）、service_tier 的 flex 选项在某个模式的默认参数下可选（离线半价）
 *   - 模式 id：edit / extend（视频编辑 / 延长）、group（组图）、layer（图层分解）、transparent（透明背景）
 */

/** 输入方式 */
export const INPUT_CAPABILITIES = ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'] as const;
export type InputCapability = (typeof INPUT_CAPABILITIES)[number];

/** 特性 */
export const FEATURE_CAPABILITIES = ['audio', 'edit_extend', 'draft', 'flex', 'group', 'layers', 'transparent'] as const;
export type FeatureCapability = (typeof FEATURE_CAPABILITIES)[number];

/** 状态：stable 正式；experimental 所有模式都是实验；deprecated 已退役或默认隐藏 */
export const MODEL_STATUSES = ['stable', 'experimental', 'deprecated'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export interface ModelCapabilities {
  inputs: InputCapability[];
  features: FeatureCapability[];
  status: ModelStatus;
}

const FRAME_SLOTS = new Set(['first_frame', 'last_frame']);

/** 某个枚举选项在至少一个模式的默认参数下可选（选项的 unavailable 依赖上下文，只看声明会把 Seedance 2.x 的 flex 误算进来） */
function optionEverAvailable(provider: ProviderDef, model: ModelDef, modes: ModeDef[], field: FieldDef, value: string): boolean {
  if (field.type !== 'enum') return false;
  const opt = field.options.find((o) => o.value === value);
  if (!opt) return false;
  if (!opt.unavailable) return true;
  return modes.some((mode) => {
    if (field.modes && !field.modes.includes(mode.id)) return false;
    const input = { providerId: provider.id, modelId: model.id, modeId: mode.id, values: {}, slots: {}, prompt: '' };
    const ctx: PredCtx = { provider, model, mode, values: {}, slots: {}, input };
    const values: FormValues = {};
    for (const f of model.fields) values[f.key] = typeof f.default === 'function' ? safe(() => (f.default as (c: PredCtx) => unknown)({ ...ctx, values }), undefined) : f.default;
    return safe(() => opt.unavailable!({ ...ctx, values, input: { ...input, values } }) === null, true);
  });
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function modelCapabilities(model: ModelDef, provider: ProviderDef): ModelCapabilities {
  // 派生模式（如样片转正片）只能从结果卡片进入，不算模型的输入方式
  const modes = model.modes.filter((m) => m.entry !== 'derived');
  const slotIds = (m: (typeof modes)[number]) => new Set(m.slots.map((s) => s.id));

  const inputs = new Set<InputCapability>();
  for (const m of modes) {
    const ids = slotIds(m);
    if (m.slots.every((s) => s.min === 0)) inputs.add('text');
    if (ids.has('first_frame')) inputs.add('first_frame');
    if (ids.has('first_frame') && ids.has('last_frame')) inputs.add('first_last');
    for (const s of m.slots) {
      if (s.kind === 'image' && !FRAME_SLOTS.has(s.id)) inputs.add('ref_image');
      if (s.kind === 'video') inputs.add('ref_video');
      if (s.kind === 'audio') inputs.add('ref_audio');
    }
  }

  const fieldKeys = new Set(model.fields.map((f) => f.key));
  const modeIds = new Set(modes.map((m) => m.id));
  const features = new Set<FeatureCapability>();
  if (fieldKeys.has('generate_audio')) features.add('audio');
  if (modeIds.has('edit') || modeIds.has('extend')) features.add('edit_extend');
  if (fieldKeys.has('draft')) features.add('draft');
  const tier = model.fields.find((f) => f.key === 'service_tier');
  if (tier && optionEverAvailable(provider, model, modes, tier, 'flex')) features.add('flex');
  if (modeIds.has('group')) features.add('group');
  if (modeIds.has('layer')) features.add('layers');
  if (modeIds.has('transparent')) features.add('transparent');

  const status: ModelStatus =
    model.lifecycle.status === 'retired' || model.lifecycle.hiddenByDefault ? 'deprecated' : modes.length > 0 && modes.every((m) => m.experimental) ? 'experimental' : 'stable';

  return {
    inputs: INPUT_CAPABILITIES.filter((c) => inputs.has(c)),
    features: FEATURE_CAPABILITIES.filter((c) => features.has(c)),
    status,
  };
}

/** 正式模型总是显示；这两种状态可以选择是否一并显示 */
export const OPTIONAL_STATUSES = ['experimental', 'deprecated'] as const;
export type OptionalStatus = (typeof OPTIONAL_STATUSES)[number];

/** 一种输出类型下的筛选条件。服务商取"任一"（不选 = 不限），输入方式、特性取"全部满足" */
export interface ModelFilter {
  providers: string[];
  inputs: InputCapability[];
  features: FeatureCapability[];
  /** 除正式模型外还显示哪些状态 */
  include: OptionalStatus[];
}

export const DEFAULT_MODEL_FILTER: ModelFilter = { providers: [], inputs: [], features: [], include: ['experimental'] };

export function matchesFilter(model: ModelDef, filter: ModelFilter, caps: ModelCapabilities): boolean {
  if (filter.providers.length && !filter.providers.includes(model.providerId)) return false;
  if (caps.status !== 'stable' && !filter.include.includes(caps.status)) return false;
  if (!filter.inputs.every((c) => caps.inputs.includes(c))) return false;
  if (!filter.features.every((c) => caps.features.includes(c))) return false;
  return true;
}

/**
 * 筛选是否偏离默认值（用来显示"清除筛选"）。
 * 传入 available 时只看当前类型下实际存在的选项，与筛选菜单的显示口径一致
 * （例如图像下没有已弃用模型，include 里多一个 deprecated 不算生效）。
 */
export function isFilterActive(filter: ModelFilter, available?: FilterOptions): boolean {
  const pick = <T extends string>(values: T[], allowed?: readonly string[]) => (allowed ? values.filter((v) => allowed.includes(v)) : values);
  const include = pick(filter.include, available?.include);
  const defaultInclude = pick(DEFAULT_MODEL_FILTER.include, available?.include);
  const sameInclude = include.length === defaultInclude.length && defaultInclude.every((s) => include.includes(s));
  return (
    pick(filter.providers, available?.providers).length > 0 ||
    pick(filter.inputs, available?.inputs).length > 0 ||
    pick(filter.features, available?.features).length > 0 ||
    !sameInclude
  );
}

export interface FilterOptions {
  providers: string[];
  inputs: InputCapability[];
  features: FeatureCapability[];
  include: OptionalStatus[];
}

/** 某种输出类型下实际出现过的选项（不出现的选项不在界面上列出） */
export function availableFilterOptions(models: { provider: ProviderDef; model: ModelDef }[], output: OutputKind): FilterOptions {
  const providers = new Set<string>();
  const inputs = new Set<InputCapability>();
  const features = new Set<FeatureCapability>();
  const statuses = new Set<ModelStatus>();
  for (const { provider, model } of models) {
    if (model.output !== output) continue;
    const caps = modelCapabilities(model, provider);
    providers.add(model.providerId);
    caps.inputs.forEach((c) => inputs.add(c));
    caps.features.forEach((c) => features.add(c));
    statuses.add(caps.status);
  }
  return {
    providers: [...providers],
    inputs: INPUT_CAPABILITIES.filter((c) => inputs.has(c)),
    features: FEATURE_CAPABILITIES.filter((c) => features.has(c)),
    include: OPTIONAL_STATUSES.filter((c) => statuses.has(c)),
  };
}
