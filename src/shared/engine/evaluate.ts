import type {
  EvalCtx,
  EvaluatedForm,
  FieldDef,
  FieldState,
  FormInput,
  FormValues,
  Issue,
  ModeDef,
  ModelDef,
  PredCtx,
  ProviderDef,
  SizeValue,
  SlotState,
} from '../catalog/types.js';
import type { I18nText } from '../i18n.js';
import { checkAsset } from './media.js';
import { computeRefOrder, countPrompt, promptRefIds } from './refs.js';

export class CatalogLookupError extends Error {}

export function findMode(model: ModelDef, modeId: string): ModeDef {
  const mode = model.modes.find((m) => m.id === modeId);
  if (!mode) throw new CatalogLookupError(`模型 ${model.id} 没有模式 ${modeId}`);
  return mode;
}

function fieldDefault(f: FieldDef, c: PredCtx): unknown {
  return typeof f.default === 'function' ? (f.default as (c: PredCtx) => unknown)(c) : f.default;
}

/** 值是否符合字段类型（不检查范围） */
function typeOk(f: FieldDef, v: unknown): boolean {
  switch (f.type) {
    case 'enum':
    case 'text':
      return typeof v === 'string';
    case 'bool':
      return typeof v === 'boolean';
    case 'int':
    case 'seed':
      return v === null || (typeof v === 'number' && Number.isFinite(v));
    case 'size':
      return isSizeValue(v);
  }
}

export function isSizeValue(v: unknown): v is SizeValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.mode === 'preset') return typeof o.value === 'string';
  if (o.mode === 'custom') return typeof o.width === 'number' && typeof o.height === 'number';
  return false;
}

const T = (zh: string, en: string): I18nText => ({ zh, en });

/**
 * 表单评估：
 * 1. 用户值（类型不对则取默认）→ 锁定值
 * 2. 显隐 / 禁用 / 枚举可用性（不可用时回退并提示）
 * 3. 范围与模式校验 → issues
 * 4. 素材槽数量与规格、提示词、模型约束 → issues
 */
export function evaluate(provider: ProviderDef, model: ModelDef, input: FormInput): EvaluatedForm {
  const mode = findMode(model, input.modeId);
  const issues: Issue[] = [];

  // 第 1 步：取值
  const values: FormValues = {};
  const base: PredCtx = { provider, model, mode, values, slots: input.slots, input };
  for (const f of model.fields) {
    const user = input.values[f.key];
    values[f.key] = user !== undefined && typeOk(f, user) ? user : fieldDefault(f, base);
    if (user !== undefined && !typeOk(f, user)) {
      issues.push({ id: `type:${f.key}`, severity: 'warn', fields: [f.key], message: T(`「${f.label.zh}」的值类型不对，已改用默认值`, `"${f.label.en}" had the wrong type; default used`) });
    }
  }

  // 第 2 步：锁定
  const locks: Record<string, { value: unknown; reason: I18nText }> = {};
  for (const f of model.fields) {
    const modeLock = mode.locked?.[f.key];
    const fieldLock = f.locked?.(base) ?? null;
    const lock = modeLock ?? fieldLock;
    if (lock) {
      locks[f.key] = lock;
      values[f.key] = lock.value;
    }
  }

  // 第 3 步：显隐、禁用、选项
  const fields: Record<string, FieldState> = {};
  for (const f of model.fields) {
    const inMode = !f.modes || f.modes.includes(mode.id);
    const visible = inMode && (f.visible ? f.visible(base) : true);
    const disabledReason = visible ? (f.disabled?.(base) ?? undefined) : undefined;
    const state: FieldState = { key: f.key, visible, value: values[f.key], sent: false };
    if (disabledReason) state.disabledReason = disabledReason;
    if (locks[f.key]) state.locked = locks[f.key];

    if (f.type === 'enum') {
      state.options = f.options.map((o) => {
        const reason = o.unavailable?.(base) ?? null;
        return reason ? { ...o, disabledReason: reason } : { ...o };
      });
      const current = state.options.find((o) => o.value === values[f.key]);
      if (visible && !disabledReason && (!current || current.disabledReason)) {
        const dflt = fieldDefault(f, base) as string;
        const fallback = state.options.find((o) => o.value === dflt && !o.disabledReason) ?? state.options.find((o) => !o.disabledReason);
        if (fallback) {
          const was = values[f.key];
          values[f.key] = fallback.value;
          state.value = fallback.value;
          state.adjusted = current
            ? T(`「${String(was)}」在当前设置下不可用，已改为「${fallback.value}」`, `"${String(was)}" is unavailable here; switched to "${fallback.value}"`)
            : T(`不支持「${String(was)}」，已改为「${fallback.value}」`, `"${String(was)}" is not supported; switched to "${fallback.value}"`);
        } else {
          issues.push({ id: `enum:${f.key}`, severity: 'error', fields: [f.key], message: T(`「${f.label.zh}」没有可用选项`, `"${f.label.en}" has no available option`) });
        }
      }
    }
    state.sent = visible && !disabledReason && (f.send ?? 'always') !== 'never';
    fields[f.key] = state;
  }

  // 第 4 步：范围校验（只校验会发送的字段）
  for (const f of model.fields) {
    const st = fields[f.key]!;
    if (!st.sent) continue;
    const v = values[f.key];
    if ((f.type === 'int' || f.type === 'seed') && typeof v === 'number') {
      const special = f.type === 'int' && f.specials?.some((s) => s.value === v);
      if (!special) {
        if (!Number.isInteger(v)) issues.push({ id: `int:${f.key}`, severity: 'error', fields: [f.key], message: T(`「${f.label.zh}」必须是整数`, `"${f.label.en}" must be an integer`) });
        else if (v < f.min || v > f.max) issues.push({ id: `range:${f.key}`, severity: 'error', fields: [f.key], message: T(`「${f.label.zh}」需在 ${f.min}–${f.max} 之间（当前 ${v}）`, `"${f.label.en}" must be within ${f.min}–${f.max} (got ${v})`) });
        else if (f.type === 'int' && f.pattern && (v - f.pattern.base) % f.pattern.step !== 0) {
          issues.push({ id: `pattern:${f.key}`, severity: 'error', fields: [f.key], message: T(`「${f.label.zh}」必须等于 ${f.pattern.base}+${f.pattern.step}n`, `"${f.label.en}" must equal ${f.pattern.base}+${f.pattern.step}n`) });
        }
      }
    }
    if (f.type === 'text' && typeof v === 'string' && f.maxLength !== undefined && [...v].length > f.maxLength) {
      issues.push({ id: `len:${f.key}`, severity: 'error', fields: [f.key], message: T(`「${f.label.zh}」最多 ${f.maxLength} 个字符`, `"${f.label.en}" allows at most ${f.maxLength} characters`) });
    }
    if (f.type === 'size' && isSizeValue(v)) {
      const spec = f.spec(base);
      if (v.mode === 'preset' && !spec.presets.some((p) => p.value === v.value)) {
        issues.push({ id: `size-preset:${f.key}`, severity: 'error', fields: [f.key], message: T(`尺寸档位「${v.value}」不受支持`, `Size preset "${v.value}" is not supported`) });
      }
      if (v.mode === 'custom') {
        const cu = spec.custom;
        if (!cu) {
          // 例如从支持自定义尺寸的模型切过来：回退到默认预设并提示
          const dflt = fieldDefault(f, base);
          const fallback = isSizeValue(dflt) && dflt.mode === 'preset' ? dflt : { mode: 'preset' as const, value: spec.presets[0]?.value ?? '' };
          values[f.key] = fallback;
          st.value = fallback;
          if (fallback.value) st.adjusted = T(`当前模型不支持自定义宽高，已改为「${fallback.value}」`, `Custom size is not supported here; switched to "${fallback.value}"`);
          else issues.push({ id: `size-custom:${f.key}`, severity: 'error', fields: [f.key], message: T('当前模型不支持自定义宽高', 'Custom width/height is not supported by this model') });
        } else {
          const { width: w, height: h } = v;
          const px = w * h;
          const bad: string[] = [];
          if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) bad.push('宽高必须是正整数');
          if (cu.side && (w < cu.side[0] || h < cu.side[0] || w > cu.side[1] || h > cu.side[1])) bad.push(`宽高需在 ${cu.side[0]}–${cu.side[1]} 之间`);
          if (cu.multipleOf && (w % cu.multipleOf !== 0 || h % cu.multipleOf !== 0)) bad.push(`宽高需是 ${cu.multipleOf} 的倍数`);
          if (cu.minPixels !== undefined && px < cu.minPixels) bad.push(`总像素不少于 ${cu.minPixels}`);
          if (cu.maxPixels !== undefined && px > cu.maxPixels) bad.push(`总像素不超过 ${cu.maxPixels}`);
          if (cu.aspect && (w / h < cu.aspect[0] || w / h > cu.aspect[1])) bad.push(`宽高比需在 ${cu.aspect[0]}–${cu.aspect[1]} 之间`);
          if (bad.length) {
            issues.push({ id: `size-custom:${f.key}`, severity: 'error', fields: [f.key], message: T(`自定义尺寸 ${w}×${h} 不合法：${bad.join('；')}`, `Custom size ${w}×${h} is invalid: ${bad.join('; ')}`) });
          }
        }
      }
    }
  }

  // 第 5 步：素材槽
  const slotStates: Record<string, SlotState> = {};
  const knownSlots = new Set(mode.slots.map((s) => s.id));
  for (const slotId of Object.keys(input.slots)) {
    if (!knownSlots.has(slotId) && (input.slots[slotId]?.length ?? 0) > 0) {
      issues.push({ id: `slot-unknown:${slotId}`, severity: 'error', slots: [slotId], message: T(`当前模式没有「${slotId}」素材槽`, `Mode has no slot "${slotId}"`) });
    }
  }
  for (const slot of mode.slots) {
    const items = input.slots[slot.id] ?? [];
    slotStates[slot.id] = { id: slot.id, min: slot.min, max: slot.max, count: items.length };
    if (items.length < slot.min) {
      issues.push({ id: `slot-min:${slot.id}`, severity: 'error', slots: [slot.id], message: T(`「${slot.label.zh}」至少需要 ${slot.min} 个`, `"${slot.label.en}" needs at least ${slot.min}`) });
    }
    if (items.length > slot.max) {
      issues.push({ id: `slot-max:${slot.id}`, severity: 'error', slots: [slot.id], message: T(`「${slot.label.zh}」最多 ${slot.max} 个（当前 ${items.length}）`, `"${slot.label.en}" allows at most ${slot.max} (got ${items.length})`) });
    }
    items.forEach((a, i) => {
      for (const p of checkAsset(a, slot)) {
        issues.push({ id: `asset:${slot.id}:${i}`, severity: p.severity, slots: [slot.id], message: { zh: `「${slot.label.zh}」第 ${i + 1} 个：${p.message.zh}`, en: `"${slot.label.en}" #${i + 1}: ${p.message.en}` } });
      }
    });
  }

  // 第 6 步：提示词
  const order = computeRefOrder(mode, input.slots);
  const required = typeof mode.prompt.required === 'function' ? mode.prompt.required(base) : mode.prompt.required;
  const promptText = input.prompt ?? '';
  if (required && !promptText.trim()) {
    issues.push({ id: 'prompt:required', severity: 'error', fields: ['prompt'], message: T('请填写提示词', 'Prompt is required') });
  }
  const missingRefs = promptRefIds(promptText).filter((id) => !order[id]);
  if (missingRefs.length) {
    issues.push({ id: 'prompt:refs', severity: 'error', fields: ['prompt'], message: T('提示词引用了已删除的素材', 'Prompt references removed assets') });
  }
  const counted = countPrompt(promptText.replace(/\{\{ref:[^}]+\}\}/g, ' Image 1 '));
  if (mode.prompt.maxChars !== undefined && counted.chars > mode.prompt.maxChars) {
    issues.push({ id: 'prompt:max', severity: 'error', fields: ['prompt'], message: T(`提示词最多 ${mode.prompt.maxChars} 个字符（当前 ${counted.chars}）`, `Prompt allows at most ${mode.prompt.maxChars} characters (got ${counted.chars})`) });
  }
  if (mode.prompt.softMax && (counted.zhChars > mode.prompt.softMax.zhChars || counted.enWords > mode.prompt.softMax.enWords)) {
    issues.push({ id: 'prompt:soft', severity: 'warn', fields: ['prompt'], message: T(`提示词建议不超过 ${mode.prompt.softMax.zhChars} 个汉字或 ${mode.prompt.softMax.enWords} 个英文单词`, `Prompt is recommended to stay under ${mode.prompt.softMax.zhChars} Chinese characters or ${mode.prompt.softMax.enWords} English words`) });
  }

  // 第 7 步：模型约束
  const effective: FormValues = {};
  for (const f of model.fields) if (fields[f.key]!.sent && values[f.key] !== undefined) effective[f.key] = values[f.key];
  const ctx: EvalCtx = { ...base, effective, fields };
  for (const c of model.constraints) {
    const r = c.check(ctx);
    if (r) issues.push({ id: c.id, severity: c.severity, ...r });
  }
  if (input.rawOverrides && Object.keys(input.rawOverrides).length) {
    issues.push({ id: 'raw-overrides', severity: 'warn', message: T('已启用原始字段覆盖：这些字段不经校验直接写入请求', 'Raw overrides are on: these fields go into the request unvalidated') });
  }
  if (model.lifecycle.status !== 'active') {
    issues.push({ id: 'lifecycle', severity: 'warn', message: model.lifecycle.note ?? T('该模型即将或已经下线', 'This model is retiring or retired') });
  }
  void order;

  return {
    ctx,
    fields,
    slots: slotStates,
    effective,
    issues,
    canSubmit: !issues.some((i) => i.severity === 'error'),
  };
}
