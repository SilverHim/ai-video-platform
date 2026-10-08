import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EndpointInfo } from '../../../shared/api-contract';
import i18n from '../../i18n';
import { api, ApiRequestError } from '../../lib/api-client';
import { EndpointSelect } from './EndpointSelect';

const ep = (over: Partial<EndpointInfo>): EndpointInfo => ({
  id: 'ep-20261008000000-aaaaa',
  name: 'flash-nofilter',
  description: '',
  status: 'Running',
  statusReason: '',
  foundationModel: { name: 'dola-seedream-5-0-flash', version: '260915' },
  customModelId: null,
  modelId: 'byteplus/seedream-5-0-flash',
  contentFilter: 'off',
  moderationStrategy: 'Skip',
  rateLimit: null,
  projectName: 'default',
  createTime: '',
  updateTime: '',
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderSelect = (value: string | undefined, onChange = vi.fn()) => {
  render(
    <MemoryRouter>
      <EndpointSelect modelId="byteplus/seedream-5-0-flash" value={value} onChange={onChange} />
    </MemoryRouter>,
  );
  return onChange;
};

describe('EndpointSelect', () => {
  it('没配 AK/SK 时退回手填，并提示去设置', async () => {
    vi.spyOn(api, 'listEndpoints').mockRejectedValue(new ApiRequestError(409, 'control_not_configured', 'x'));
    const onChange = renderSelect(undefined);
    expect(await screen.findByText(/填 AK\/SK 后/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '手动输入 Endpoint ID…' }), { target: { value: ' ep-manual-123 ' } });
    expect(onChange).toHaveBeenCalledWith('ep-manual-123');
  });

  it('只列出当前模型的 Endpoint，标出过滤与状态；可选择或取消', async () => {
    const spy = vi.spyOn(api, 'listEndpoints').mockResolvedValue([ep({}), ep({ id: 'ep-20261008000000-bbbbb', name: 'flash-default', contentFilter: 'on', status: 'Stopped' })]);
    const onChange = renderSelect(undefined);
    await screen.findByRole('option', { name: /flash-nofilter/ });
    const select = screen.getByRole('combobox', { name: 'Endpoint（可选）' });
    expect(spy).toHaveBeenCalledWith({ modelId: 'byteplus/seedream-5-0-flash', refresh: false });
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      '不用 Endpoint（直接用模型 ID）',
      'flash-nofilter · ep-20261008000000-aaaaa · 过滤关闭 · 运行中',
      'flash-default · ep-20261008000000-bbbbb · 过滤开启 · 已停止',
      '手动输入 Endpoint ID…',
    ]);
    fireEvent.change(select, { target: { value: 'ep-20261008000000-aaaaa' } });
    expect(onChange).toHaveBeenLastCalledWith('ep-20261008000000-aaaaa');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('已填的 ID 不在列表里时显示为手动输入并保留原值', async () => {
    vi.spyOn(api, 'listEndpoints').mockResolvedValue([ep({})]);
    renderSelect('ep-elsewhere-12345');
    await screen.findByRole('option', { name: /flash-nofilter/ });
    const select = screen.getByRole('combobox', { name: 'Endpoint（可选）' }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('__manual__'));
    expect((screen.getByRole('textbox', { name: '手动输入 Endpoint ID…' }) as HTMLInputElement).value).toBe('ep-elsewhere-12345');
  });
});

describe('EndpointSelect 竞态', () => {
  it('加载中显示禁用的下拉，不闪成手填框', async () => {
    let resolve!: (v: EndpointInfo[]) => void;
    vi.spyOn(api, 'listEndpoints').mockReturnValue(new Promise((r) => (resolve = r)));
    renderSelect('ep-20261008000000-aaaaa');
    const select = screen.getByRole('combobox', { name: 'Endpoint（可选）' }) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    resolve([ep({})]);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Endpoint（可选）' }) as HTMLSelectElement).value).toBe('ep-20261008000000-aaaaa'));
  });

  it('切换模型后，旧模型的请求晚到不会覆盖当前模型', async () => {
    const pending: Record<string, (v: EndpointInfo[]) => void> = {};
    vi.spyOn(api, 'listEndpoints').mockImplementation(({ modelId } = {}) => new Promise((r) => (pending[modelId!] = r)));
    const { rerender } = render(
      <MemoryRouter>
        <EndpointSelect modelId="byteplus/seedream-5-0-flash" value={undefined} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <EndpointSelect modelId="byteplus/seedream-5-0-pro" value={undefined} onChange={vi.fn()} />
      </MemoryRouter>,
    );
    pending['byteplus/seedream-5-0-pro']!([ep({ id: 'ep-20261008000000-ppppp', name: 'pro-ep', modelId: 'byteplus/seedream-5-0-pro' })]);
    await screen.findByRole('option', { name: /pro-ep/ });
    pending['byteplus/seedream-5-0-flash']!([ep({})]);
    await new Promise((r) => setTimeout(r, 20));
    const select = screen.getByRole('combobox', { name: 'Endpoint（可选）' }) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => o.textContent).join('|')).toContain('pro-ep');
    expect([...select.options].map((o) => o.textContent).join('|')).not.toContain('flash-nofilter');
  });
});
