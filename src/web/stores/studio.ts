import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_MODEL_FILTER, type ModelFilter } from '../../shared/catalog/capabilities';
import type { AssetRef, CredentialKind, DerivedFrom, FormInput, FormValues, OutputKind } from '../../shared/catalog/types';
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
  /** 模型筛选条件，图像 / 视频各一份 */
  filters: Record<OutputKind, ModelFilter>;
  /** 每种输出类型上次用的模型（切换类型时回到它） */
  lastByOutput: Partial<Record<OutputKind, string>>;
  /** 本地视频上传用的临时托管站 */
  tempHost: 'uguu' | 'tmpfiles';
  setTempHost: (h: 'uguu' | 'tmpfiles') => void;
  /** 按服务商选用哪种 Key（MiniMax 有按量 / 订阅）；没选时由服务端决定（有订阅用订阅） */
  credentials: Partial<Record<string, CredentialKind>>;
  setCredential: (providerId: string, kind: CredentialKind | null) => void;
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
  setFilter: (output: OutputKind, patch: Partial<ModelFilter>) => void;
  resetFilter: (output: OutputKind) => void;
}

/** 把模型记为它所属输出类型的"上次用的模型" */
function rememberLast(last: Partial<Record<OutputKind, string>>, modelId: string | null | undefined): Partial<Record<OutputKind, string>> {
  const output = modelId ? getModel(modelId)?.model.output : undefined;
  return output && modelId ? { ...last, [output]: modelId } : last;
}

const defaultFilter = (): ModelFilter => ({ ...DEFAULT_MODEL_FILTER, include: [...DEFAULT_MODEL_FILTER.include] });
const defaultFilters = (): Record<OutputKind, ModelFilter> => ({ image: defaultFilter(), video: defaultFilter() });

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
        filters: defaultFilters(),
        lastByOutput: {},
        tempHost: 'uguu',
        setTempHost: (tempHost) => set({ tempHost }),
        credentials: {},
        setCredential: (providerId, kind) =>
          set((s) => {
            const next = { ...s.credentials };
            if (kind) next[providerId] = kind;
            else delete next[providerId];
            return { credentials: next };
          }),
        selectModel: (modelId) => {
          const { drafts, lastByOutput, modelId: prev } = get();
          set({
            modelId,
            drafts: drafts[modelId] ? drafts : { ...drafts, [modelId]: initialDraft(modelId) },
            // 切走的模型也记到它自己的类型下（它可能是经 loadForm / 默认值进来的）
            lastByOutput: rememberLast(rememberLast(lastByOutput, prev), modelId),
          });
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
            lastByOutput: rememberLast(rememberLast(s.lastByOutput, s.modelId), form.modelId),
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
        setFilter: (output, patch) => set((s) => ({ filters: { ...s.filters, [output]: { ...s.filters[output], ...patch } } })),
        resetFilter: (output) => set((s) => ({ filters: { ...s.filters, [output]: defaultFilter() } })),
      };
    },
    {
      name: 'ark.studio.v1',
      version: 2,
      // v1 → v2：showHidden（显示已弃用模型）并入两种类型的"状态"筛选
      migrate: (persisted, version) => migrateStudio(persisted, version) as unknown as StudioState,
    },
  ),
);

/** 持久化数据迁移（导出给测试） */
export function migrateStudio(persisted: unknown, version: number): Record<string, unknown> {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 2) {
    const filters = defaultFilters();
    if (state.showHidden === true) for (const f of Object.values(filters)) f.include = [...f.include, 'deprecated'];
    delete state.showHidden;
    state.filters = filters;
    state.lastByOutput = rememberLast({}, typeof state.modelId === 'string' ? state.modelId : null);
  }
  return state;
}

/** 当前草稿 → 提交用的表单快照 */
export function currentForm(state: Pick<StudioState, 'modelId' | 'drafts'> & Partial<Pick<StudioState, 'credentials'>>): FormInput | null {
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
    ...(state.credentials?.[found.provider.id] ? { credential: state.credentials[found.provider.id] } : {}),
  };
}
