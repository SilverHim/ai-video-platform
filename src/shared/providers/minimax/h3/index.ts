/**
 * MiniMax 国际站 V2 视频：MiniMax-H3、MiniMax-H3-Max（POST /v2/video_generation 创建任务，GET /v2/query/video_generation/{id} 轮询）。
 * 三种模式共用 content[] 协议：文生 t2v、图生 i2v（首帧 / 首尾帧）、参考生 r2v（图 / 视频 / 音频）。
 */
import type { ModelDef } from '../../../catalog/types.js';
import { T } from '../../../catalog/helpers.js';
import { h3Adapter } from './adapter.js';
import { H3_CONSTRAINTS, MAX_R2V_CONFLICT, h3WireGuards } from './constraints.js';
import { estimateH3Cost } from './pricing.js';
import { DOCS, PROFILES, type H3Profile } from './profile.js';
import { h3Fields, h3Modes } from './spec.js';

export { H3_ID, H3_MAX_ID } from './profile.js';

function h3Model(p: H3Profile): ModelDef {
  return {
    id: p.id,
    providerId: 'minimax',
    apiModel: p.apiModel,
    family: 'h3',
    label: p.label,
    description: p.description,
    output: 'video',
    kind: 'async',
    lifecycle: { status: 'active' },
    ...(p.key === 'max' ? { badges: [T('快速', 'Fast')] } : {}),
    docs: [DOCS.create, DOCS.query, DOCS.spec, DOCS.guide, DOCS.overview, DOCS.models, DOCS.pricing, DOCS.rateLimits, DOCS.files, DOCS.list, DOCS.remove],
    // 未核实：Cancel/Delete 能否用于 H3-Max 任务文档没有单独说明（两个模型共用查询接口）
    endpoints: { submit: 'video.create', get: 'video.get', cancel: 'video.delete', list: 'video.list' },
    modes: h3Modes(p),
    fields: h3Fields(p),
    constraints: p.r2vConflict ? [...H3_CONSTRAINTS, MAX_R2V_CONFLICT] : H3_CONSTRAINTS,
    wireGuards: h3WireGuards(p),
    adapter: h3Adapter,
    estimateCost: (c) => estimateH3Cost(p, c),
  };
}

export const H3_MODELS: ModelDef[] = [h3Model(PROFILES.h3), h3Model(PROFILES.max)];
