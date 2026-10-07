import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AssetRef, DerivedFrom, FormInput, FormValues } from '../../shared/catalog/types';
import { listModels, getModel } from '../../shared/providers/registry';

/** 每个模型各自的草稿：切换模型时互不覆盖 */
export interface ModelDraft {
  modeId: string;
  values: FormValues;
  /** 模式 id → 槽位 id → 素材 */
  slots: Record<string, Record<string, AssetRef[]>>;
  prompt: string;
  modelOverride?: string;
  /** 派生自哪个任务（样片转正片、编辑 / 延长） */
  derivedFrom?: DerivedFrom;
}

interface StudioState {
  modelId: string | null;
  drafts: Record<string, ModelDraft>;
  showHidden: boolean;
  /** 本地视频上传用的临时托管站 */
  tempHost: 'uguu' | 'tmpfiles';
  setTempHost: (h: 'uguu' | 'tmpfiles') => void;
  selectModel: (modelId: string) => void;
  selectMode: (modeId: string) => void;
  setValue: (key: string, value: unknown) => void;
  patchValues: (patch: FormValues) => void;
  setPrompt: (prompt: string) => void;
  setModelOverride: (v: string) => void;
  addAssets: (slotId: string, assets: AssetRef[]) => void;
  removeAsset: (slotId: string, assetId: string) => void;
  moveAsset: (slotId: string, assetId: string, delta: -1 | 1) => void;
  /** 复用历史任务的参数 */
  loadForm: (form: FormInput) => void;
  resetModel: () => void;
  /** 取消派生：回到普通模式 */
  clearDerived: () => void;
  setShowHidden: (v: boolean) => void;
}

function initialDraft(modelId: string): ModelDraft {
  const m = getModel(modelId)?.model;
  const mode = m?.modes.find((x) => x.entry !== 'derived' && !x.hiddenByDefault) ?? m?.modes[0];
  return { modeId: mode?.id ?? '', values: {}, slots: {}, prompt: '' };
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => {
      const update = (fn: (d: ModelDraft) => ModelDraft) => {
        const { modelId, drafts } = get();
        if (!modelId) return;
        set({ drafts: { ...drafts, [modelId]: fn(drafts[modelId] ?? initialDraft(modelId)) } });
      };
      const updateSlots = (fn: (slots: Record<string, AssetRef[]>) => Record<string, AssetRef[]>) =>
        update((d) => ({ ...d, slots: { ...d.slots, [d.modeId]: fn(d.slots[d.modeId] ?? {}) } }));
      return {
        modelId: listModels()[0]?.model.id ?? null,
        drafts: {},
        showHidden: false,
        tempHost: 'uguu',
        setTempHost: (tempHost) => set({ tempHost }),
        selectModel: (modelId) => {
          const drafts = get().drafts;
          set({ modelId, drafts: drafts[modelId] ? drafts : { ...drafts, [modelId]: initialDraft(modelId) } });
        },
        selectMode: (modeId) =>
          update((d) => {
            // 离开派生模式（如样片转正片）时，派生来源一并清掉
            const leaving = getModel(get().modelId ?? '')?.model.modes.find((m) => m.id === d.modeId)?.entry === 'derived';
            const next = { ...d, modeId };
            if (leaving) delete next.derivedFrom;
            return next;
          }),
        setValue: (key, value) => update((d) => ({ ...d, values: { ...d.values, [key]: value } })),
        patchValues: (patch) => update((d) => ({ ...d, values: { ...d.values, ...patch } })),
        setPrompt: (prompt) => update((d) => ({ ...d, prompt })),
        setModelOverride: (v) => update((d) => ({ ...d, ...(v ? { modelOverride: v } : { modelOverride: undefined }) })),
        addAssets: (slotId, assets) => updateSlots((s) => ({ ...s, [slotId]: [...(s[slotId] ?? []), ...assets] })),
        removeAsset: (slotId, assetId) => updateSlots((s) => ({ ...s, [slotId]: (s[slotId] ?? []).filter((a) => a.id !== assetId) })),
        moveAsset: (slotId, assetId, delta) =>
          updateSlots((s) => {
            const list = [...(s[slotId] ?? [])];
            const i = list.findIndex((a) => a.id === assetId);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= list.length) return s;
            [list[i], list[j]] = [list[j]!, list[i]!];
            return { ...s, [slotId]: list };
          }),
        loadForm: (form) => {
          if (!getModel(form.modelId)) return;
          set((s) => ({
            modelId: form.modelId,
            drafts: {
              ...s.drafts,
              [form.modelId]: {
                modeId: form.modeId,
                values: { ...form.values },
                slots: { [form.modeId]: { ...form.slots } },
                prompt: form.prompt,
                ...(form.modelOverride ? { modelOverride: form.modelOverride } : {}),
                ...(form.derivedFrom ? { derivedFrom: form.derivedFrom } : {}),
              },
            },
          }));
        },
        clearDerived: () =>
          update((d) => {
            const m = get().modelId ? getModel(get().modelId!)?.model : undefined;
            const mode = m?.modes.find((x) => x.id === d.modeId);
            const next = { ...d };
            delete next.derivedFrom;
            if (mode?.entry === 'derived') next.modeId = initialDraft(get().modelId!).modeId;
            return next;
          }),
        resetModel: () => {
          const { modelId, drafts } = get();
          if (modelId) set({ drafts: { ...drafts, [modelId]: initialDraft(modelId) } });
        },
        setShowHidden: (showHidden) => set({ showHidden }),
      };
    },
    { name: 'ark.studio.v1', version: 1 },
  ),
);

/** 当前草稿 → 提交用的表单快照 */
export function currentForm(state: Pick<StudioState, 'modelId' | 'drafts'>): FormInput | null {
  if (!state.modelId) return null;
  const found = getModel(state.modelId);
  if (!found) return null;
  const d = state.drafts[state.modelId] ?? initialDraft(state.modelId);
  const modeId = found.model.modes.some((m) => m.id === d.modeId) ? d.modeId : (found.model.modes[0]?.id ?? '');
  return {
    providerId: found.provider.id,
    modelId: state.modelId,
    modeId,
    values: d.values,
    slots: d.slots[modeId] ?? {},
    prompt: d.prompt,
    ...(d.modelOverride ? { modelOverride: d.modelOverride } : {}),
    ...(d.derivedFrom ? { derivedFrom: d.derivedFrom } : {}),
  };
}
