import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ControlCredentialStatus, EndpointCreatePlan, EndpointInfo } from '../../../shared/api-contract';
import i18n from '../../i18n';
import { api } from '../../lib/api-client';
import { EndpointCard } from './EndpointCard';

const creds = (ak: string, at: number): ControlCredentialStatus => ({ configured: true, source: 'file', maskedAccessKeyId: ak, updatedAt: at });
const ep = (id: string, name: string): EndpointInfo => ({
  id,
  name,
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
});
const okPlan = (request: Record<string, unknown>): EndpointCreatePlan => ({ request, dryRun: { ok: true }, notes: [] });

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EndpointCard', () => {
  it('换了 AK/SK 后重新加载列表', async () => {
    vi.spyOn(api, 'controlCredentials').mockResolvedValue(creds('AKLT…AAAA', 1));
    vi.spyOn(api, 'setControlCredentials').mockResolvedValue(creds('AKLT…BBBB', 2));
    const list = vi.spyOn(api, 'listEndpoints').mockResolvedValueOnce([ep('ep-20261008000000-aaaaa', 'old-a')]).mockResolvedValue([ep('ep-20261008000000-bbbbb', 'new-b')]);
    render(<EndpointCard />);
    await screen.findByText('old-a');
    fireEvent.change(screen.getByRole('textbox', { name: 'AccessKey ID' }), { target: { value: 'AKLTbbbb' } });
    fireEvent.change(screen.getByLabelText('Secret Access Key'), { target: { value: 'secret-b' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('new-b');
    expect(screen.queryByText('old-a')).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('预检进行中锁住输入；创建提交的是预检时的参数', async () => {
    vi.spyOn(api, 'controlCredentials').mockResolvedValue(creds('AKLT…AAAA', 1));
    vi.spyOn(api, 'listEndpoints').mockResolvedValue([]);
    let resolvePlan!: (p: EndpointCreatePlan) => void;
    const plan = vi.spyOn(api, 'planEndpoint').mockReturnValue(new Promise((r) => (resolvePlan = r)));
    const create = vi.spyOn(api, 'createEndpoint').mockResolvedValue({ id: 'ep-20261008000000-ccccc', endpoint: null, warnings: [] });
    render(<EndpointCard />);
    fireEvent.click(await screen.findByTestId('endpoint-create-open'));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'n1' } });
    fireEvent.click(screen.getByRole('button', { name: '预检（不创建）' }));
    // 预检进行中：开关与输入所在的 fieldset 被禁用（浏览器里其中的控件都不可操作）
    expect(screen.getByRole('switch', { name: '内容过滤' }).closest('fieldset')?.disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: '名称' }).closest('fieldset')?.disabled).toBe(true);
    await act(async () => resolvePlan(okPlan({ Name: 'n1' })));
    const confirm = screen.getByTestId('endpoint-create-confirm') as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toEqual(plan.mock.calls[0]![0]);
    expect(create.mock.calls[0]![0]).toMatchObject({ name: 'n1', contentFilter: true });
  });

  it('预检后改了输入，必须重新预检才能创建', async () => {
    vi.spyOn(api, 'controlCredentials').mockResolvedValue(creds('AKLT…AAAA', 1));
    vi.spyOn(api, 'listEndpoints').mockResolvedValue([]);
    vi.spyOn(api, 'planEndpoint').mockResolvedValue(okPlan({ Name: 'n1' }));
    render(<EndpointCard />);
    fireEvent.click(await screen.findByTestId('endpoint-create-open'));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: 'n1' } });
    fireEvent.click(screen.getByRole('button', { name: '预检（不创建）' }));
    const confirm = screen.getByTestId('endpoint-create-confirm') as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(screen.getByRole('switch', { name: '内容过滤' }));
    expect(confirm.disabled).toBe(true);
  });
});
