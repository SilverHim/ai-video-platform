import type { ModelDef } from '../../../catalog/types.js';
import type { I18nText } from '../../../i18n.js';
import { T } from '../../../catalog/helpers.js';
import { SEEDANCE_ADAPTER } from './adapter.js';
import { buildConstraints, buildGuards } from './constraints.js';
import { buildFields } from './fields.js';
import { buildModes } from './modes.js';
import { PROFILES, type SeedanceProfile } from './profile.js';

function badgesOf(p: SeedanceProfile): I18nText[] {
  return [
    ...(p.generateAudio ? [T('有声', 'Audio')] : []),
    ...(p.omni ? [T('全模态参考', 'Omni reference')] : []),
    // 2.0 系列也能编辑 / 延长视频（API Model capabilities），只是走全模态参考 + 提示词，没有独立模式
    ...(p.editExtend ? [T('编辑 / 延长', 'Edit / Extend')] : p.omni ? [T('编辑 / 延长（提示词）', 'Edit / Extend (via prompt)')] : []),
    ...(p.draft ? [T('样片', 'Draft')] : []),
    ...(p.flex ? [T('离线半价', 'Flex')] : []),
  ];
}

function buildModel(p: SeedanceProfile): ModelDef {
  return {
    id: p.id,
    providerId: 'byteplus',
    apiModel: p.apiModel,
    family: 'seedance',
    label: p.label,
    description: p.description,
    output: 'video',
    kind: 'async',
    lifecycle: p.lifecycle,
    badges: badgesOf(p),
    docs: p.docs,
    endpoints: { submit: 'video.create', get: 'video.get', cancel: 'video.delete', list: 'video.list' },
    modes: buildModes(p),
    fields: buildFields(p),
    constraints: buildConstraints(p),
    wireGuards: buildGuards(p),
    adapter: SEEDANCE_ADAPTER,
    allowModelOverride: true,
    // 调研报告没有 Seedance 的 token 单价与 token 计算公式，不估算
    estimateCost: () => null,
  };
}

export const SEEDANCE_MODEL_DEFS: ModelDef[] = PROFILES.map(buildModel);
