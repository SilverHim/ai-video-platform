import { describe, expect, it } from 'vitest';
import { availableFilterOptions, DEFAULT_MODEL_FILTER, isFilterActive, matchesFilter, modelCapabilities, type ModelFilter } from '../catalog/capabilities';
import { listModels } from '../providers/registry';

const all = listModels({ includeHidden: true }).map(({ provider, model }) => ({ provider, model, caps: modelCapabilities(model, provider) }));
const capsOf = (id: string) => all.find((e) => e.model.id === id)!.caps;
const ids = (output: 'image' | 'video', filter: Partial<ModelFilter>) =>
  all.filter((e) => e.model.output === output && matchesFilter(e.model, { ...DEFAULT_MODEL_FILTER, ...filter }, e.caps)).map((e) => e.model.id);

describe('模型能力推导', () => {
  it('与当前目录一致（新增 / 修改模型声明时需要同步更新这里）', () => {
    expect(Object.fromEntries(all.map((e) => [e.model.id, e.caps]))).toEqual({
      'byteplus/seedream-5-0-pro': { inputs: ['text', 'ref_image'], features: ['layers', 'transparent'], status: 'stable' },
      'byteplus/seedream-5-0-flash': { inputs: ['text', 'ref_image'], features: ['layers', 'transparent'], status: 'stable' },
      'byteplus/seedream-5-0-lite': { inputs: ['text', 'ref_image'], features: ['group'], status: 'stable' },
      'byteplus/seedream-4-5': { inputs: ['text', 'ref_image'], features: ['group'], status: 'stable' },
      'byteplus/seedream-4-0': { inputs: ['text', 'ref_image'], features: ['group'], status: 'stable' },
      'byteplus/seedance-2-5': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: ['audio', 'edit_extend', 'draft'], status: 'stable' },
      'byteplus/seedance-2-0': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: ['audio'], status: 'stable' },
      'byteplus/seedance-2-0-fast': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: ['audio'], status: 'stable' },
      'byteplus/seedance-2-0-mini': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: ['audio'], status: 'stable' },
      'byteplus/seedance-1-5-pro': { inputs: ['text', 'first_frame', 'first_last'], features: ['audio', 'draft', 'flex'], status: 'deprecated' },
      'byteplus/seedance-1-0-pro': { inputs: ['text', 'first_frame', 'first_last'], features: ['flex'], status: 'stable' },
      'byteplus/seedance-1-0-pro-fast': { inputs: ['text', 'first_frame'], features: ['flex'], status: 'stable' },
      'minimax/image-01': { inputs: ['text', 'ref_image'], features: [], status: 'stable' },
      'minimax/image-01-live': { inputs: ['text', 'ref_image'], features: [], status: 'experimental' },
      'minimax/h3': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: [], status: 'stable' },
      'minimax/h3-max': { inputs: ['text', 'first_frame', 'first_last', 'ref_image', 'ref_video', 'ref_audio'], features: [], status: 'stable' },
    });
  });

  it('flex 选项按上下文判断：Seedance 2.x 声明了 flex 但始终不可选，不算离线半价', () => {
    expect(capsOf('byteplus/seedance-2-5').features).not.toContain('flex');
    expect(capsOf('byteplus/seedance-1-0-pro').features).toContain('flex');
  });

  it('派生模式（样片转正片）不计入输入方式', () => {
    // draft_final 没有素材槽，若计入会让 1.5 pro 之外的判断失真；这里确认它不会额外引入能力
    expect(capsOf('byteplus/seedance-1-5-pro').inputs).toEqual(['text', 'first_frame', 'first_last']);
  });
});

describe('筛选语义', () => {
  it('默认：显示正式与实验模型，隐藏已弃用', () => {
    expect(ids('video', {})).not.toContain('byteplus/seedance-1-5-pro');
    expect(ids('image', {})).toContain('minimax/image-01-live');
    expect(ids('video', { include: ['experimental', 'deprecated'] })).toContain('byteplus/seedance-1-5-pro');
    expect(ids('image', { include: [] })).not.toContain('minimax/image-01-live');
  });

  it('特性、输入方式取"全部满足"', () => {
    expect(ids('video', { features: ['audio', 'draft'] })).toEqual(['byteplus/seedance-2-5']);
    expect(ids('video', { features: ['audio', 'draft'], include: ['experimental', 'deprecated'] })).toEqual(['byteplus/seedance-2-5', 'byteplus/seedance-1-5-pro']);
    expect(ids('video', { inputs: ['first_last', 'ref_video'] })).toEqual([
      'byteplus/seedance-2-5',
      'byteplus/seedance-2-0',
      'byteplus/seedance-2-0-fast',
      'byteplus/seedance-2-0-mini',
      'minimax/h3',
      'minimax/h3-max',
    ]);
  });

  it('服务商取"任一"，不选等于不限', () => {
    expect(ids('video', { providers: ['minimax'] })).toEqual(['minimax/h3', 'minimax/h3-max']);
    expect(ids('video', { providers: ['minimax', 'byteplus'] })).toHaveLength(ids('video', {}).length);
  });

  it('是否偏离默认', () => {
    expect(isFilterActive(DEFAULT_MODEL_FILTER)).toBe(false);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, include: ['experimental', 'deprecated'] })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, include: [] })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, providers: ['minimax'] })).toBe(true);
  });

  it('传入可用选项时，只按当前类型下存在的选项判断是否生效', () => {
    const image = availableFilterOptions(all, 'image');
    const migrated = { ...DEFAULT_MODEL_FILTER, include: ['experimental', 'deprecated'] as ModelFilter['include'] };
    expect(isFilterActive(migrated)).toBe(true);
    expect(isFilterActive(migrated, image)).toBe(false);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, include: [] }, image)).toBe(true);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, features: ['audio'] }, image)).toBe(false);
    expect(isFilterActive({ ...DEFAULT_MODEL_FILTER, features: ['audio'] }, availableFilterOptions(all, 'video'))).toBe(true);
  });

  it('菜单只列出该类型下实际存在的选项', () => {
    const image = availableFilterOptions(all, 'image');
    expect(image.inputs).toEqual(['text', 'ref_image']);
    expect(image.features).toEqual(['group', 'layers', 'transparent']);
    expect(image.include).toEqual(['experimental']);
    const video = availableFilterOptions(all, 'video');
    expect(video.features).toEqual(['audio', 'edit_extend', 'draft', 'flex']);
    expect(video.include).toEqual(['deprecated']);
    expect(video.providers).toEqual(['byteplus', 'minimax']);
  });
});
