import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { migrateStudio, useStudio } from '../../stores/studio';
import { ModelBar } from './ModelBar';

const initial = useStudio.getState();

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});

beforeEach(() => {
  useStudio.setState({
    ...initial,
    modelId: 'byteplus/seedream-5-0-pro',
    drafts: {},
    lastByOutput: {},
    filters: {
      image: { providers: [], inputs: [], features: [], include: ['experimental'] },
      video: { providers: [], inputs: [], features: [], include: ['experimental'] },
    },
  });
});

afterEach(cleanup);

const count = () => screen.getByText(/个模型$/).textContent;
const modelButton = () => screen.getByRole('button', { name: /^模型：/ });

function openMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

describe('ModelBar', () => {
  it('切换输出类型：没有记录时选第一个符合筛选的模型，有记录时回到上次用的', () => {
    render(<ModelBar />);
    expect(count()).toBe('7 / 7 个模型');
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'video' } });
    expect(useStudio.getState().modelId).toBe('byteplus/seedance-2-5');
    expect(count()).toBe('8 / 9 个模型');

    act(() => useStudio.getState().selectModel('minimax/h3'));
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'image' } });
    expect(useStudio.getState().modelId).toBe('byteplus/seedream-5-0-pro');
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'video' } });
    expect(useStudio.getState().modelId).toBe('minimax/h3');
  });

  it('特性筛选取"全部满足"，按类型分别保存', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    render(<ModelBar />);
    openMenu('特性');
    fireEvent.click(screen.getByRole('checkbox', { name: /^有声/ }));
    expect(count()).toBe('4 / 9 个模型');
    fireEvent.click(screen.getByRole('checkbox', { name: '样片（Draft）' }));
    expect(count()).toBe('1 / 9 个模型');
    expect(screen.getByRole('button', { name: /^特性 · 2/ })).toBeTruthy();
    expect(useStudio.getState().filters.image.features).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(count()).toBe('8 / 9 个模型');
  });

  it('状态与默认一致时不算筛选；勾上"包含已弃用"后出现 Seedance 1.5 pro', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    render(<ModelBar />);
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
    openMenu('状态');
    fireEvent.click(screen.getByRole('checkbox', { name: '包含已弃用模型' }));
    expect(count()).toBe('9 / 9 个模型');
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeTruthy();
  });

  it('模型下拉：当前模型不符合筛选时给出提示，可用方向键 + 回车选择，Esc 关闭并把焦点还给按钮', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    act(() => useStudio.getState().setFilter('video', { providers: ['minimax'] }));
    render(<ModelBar />);

    fireEvent.click(modelButton());
    expect(screen.getByText(/不符合筛选条件/)).toBeTruthy();
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['MiniMax-H3', 'MiniMax-H3-Max快速']);
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(useStudio.getState().modelId).toBe('minimax/h3-max');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(modelButton());

    fireEvent.click(modelButton());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(modelButton());
  });

  it('没有符合条件的模型时提示并可一键清除', () => {
    act(() => useStudio.getState().setFilter('image', { features: ['group', 'layers'] }));
    render(<ModelBar />);
    expect(count()).toBe('0 / 7 个模型');
    fireEvent.click(modelButton());
    expect(screen.getByText('没有符合筛选条件的模型')).toBeTruthy();
    fireEvent.click(within(screen.getByText('没有符合筛选条件的模型').parentElement!).getByRole('button', { name: '清除筛选' }));
    expect(count()).toBe('7 / 7 个模型');
  });

  it('点外面关闭菜单', () => {
    render(<ModelBar />);
    openMenu('特性');
    expect(screen.getByRole('checkbox', { name: '组图' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('checkbox', { name: '组图' })).toBeNull();
  });
});

describe('审查修复', () => {
  it('经 loadForm 进入的模型会记为该类型"上次用的"，切换类型再切回能回到它', () => {
    act(() => useStudio.getState().selectModel('minimax/h3'));
    act(() => useStudio.getState().selectModel('byteplus/seedream-5-0-pro'));
    act(() => useStudio.getState().loadForm({ providerId: 'byteplus', modelId: 'byteplus/seedance-2-0', modeId: 't2v', values: {}, slots: {}, prompt: '' }));
    render(<ModelBar />);
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'image' } });
    expect(useStudio.getState().modelId).toBe('byteplus/seedream-5-0-pro');
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'video' } });
    expect(useStudio.getState().modelId).toBe('byteplus/seedance-2-0');
  });

  it('默认模型（没经过 selectModel）切走再切回也能回来', () => {
    render(<ModelBar />);
    act(() => useStudio.setState({ modelId: 'minimax/image-01', lastByOutput: {} }));
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'video' } });
    fireEvent.change(screen.getByRole('combobox', { name: '输出类型' }), { target: { value: 'image' } });
    expect(useStudio.getState().modelId).toBe('minimax/image-01');
  });

  it('只在当前类型下不存在的筛选项不算生效（迁移来的 deprecated 不让图像页显示"清除筛选"）', () => {
    act(() => useStudio.getState().setFilter('image', { include: ['experimental', 'deprecated'] }));
    render(<ModelBar />);
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
  });

  it('焦点 Tab 到弹层外的控件时关闭弹层', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    render(<ModelBar />);
    openMenu('特性');
    const box = screen.getByRole('checkbox', { name: /^有声/ });
    fireEvent.blur(box, { relatedTarget: screen.getByRole('combobox', { name: '输出类型' }) });
    expect(screen.queryByRole('checkbox', { name: /^有声/ })).toBeNull();
  });

  it('点弹层里的空白处（relatedTarget 为空）不关闭', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    render(<ModelBar />);
    openMenu('特性');
    fireEvent.blur(screen.getByRole('checkbox', { name: /^有声/ }), { relatedTarget: null });
    expect(screen.getByRole('checkbox', { name: /^有声/ })).toBeTruthy();
  });

  it('清除筛选后焦点回到模型按钮', async () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    act(() => useStudio.getState().setFilter('video', { features: ['audio'] }));
    render(<ModelBar />);
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(document.activeElement).toBe(modelButton());
  });

  it('说明文字关联给读屏：组说明 aria-describedby，特性说明直接显示', () => {
    act(() => useStudio.getState().selectModel('byteplus/seedance-2-5'));
    render(<ModelBar />);
    openMenu('特性');
    const group = screen.getByRole('group', { name: '特性' });
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('勾选多项时，需同时满足');
    const edit = screen.getByRole('checkbox', { name: /^视频编辑 \/ 延长/ });
    expect(document.getElementById(edit.getAttribute('aria-describedby')!)?.textContent).toContain('Seedance 2.0');
    expect(modelButton().getAttribute('aria-haspopup')).toBe('listbox');
    expect(screen.getByRole('button', { name: /^特性/ }).hasAttribute('aria-haspopup')).toBe(false);
  });

  it('英文界面的模型按钮名称用半角标点', async () => {
    await act(() => i18n.changeLanguage('en'));
    try {
      render(<ModelBar />);
      expect(screen.getByRole('button', { name: 'Model: Seedream 5.0 pro (BytePlus ModelArk)' })).toBeTruthy();
    } finally {
      await act(() => i18n.changeLanguage('zh'));
    }
  });
});

describe('studio 持久化迁移', () => {
  it('v1 的"显示已弃用模型"并入两种类型的状态筛选', () => {
    const v2 = migrateStudio({ modelId: 'x', showHidden: true }, 1);
    expect(v2).not.toHaveProperty('showHidden');
    expect(v2.filters).toEqual({
      image: { providers: [], inputs: [], features: [], include: ['experimental', 'deprecated'] },
      video: { providers: [], inputs: [], features: [], include: ['experimental', 'deprecated'] },
    });
    expect((migrateStudio({ showHidden: false }, 1).filters as { video: { include: string[] } }).video.include).toEqual(['experimental']);
  });

  it('迁移时按当前模型初始化"上次用的模型"', () => {
    expect(migrateStudio({ modelId: 'minimax/image-01' }, 1).lastByOutput).toEqual({ image: 'minimax/image-01' });
    expect(migrateStudio({ modelId: 'no/such-model' }, 1).lastByOutput).toEqual({});
  });
});
