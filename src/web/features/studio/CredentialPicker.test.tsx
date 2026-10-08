import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStatus } from '../../../shared/api-contract';
import i18n from '../../i18n';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { CredentialPicker } from './CredentialPicker';

const key = (keyId: KeyStatus['keyId'], kind: KeyStatus['kind'], configured: boolean): KeyStatus => ({ keyId, provider: 'minimax', kind, configured, source: configured ? 'file' : 'none', masked: null, updatedAt: null });

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});
beforeEach(() => {
  act(() => useStudio.setState({ credentials: {} }));
  vi.spyOn(api, 'listKeys').mockResolvedValue({ keys: [key('minimax', 'paygo', false), key('minimax-subscription', 'subscription', true)] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CredentialPicker', () => {
  it('BytePlus 只有一种 Key，不显示', () => {
    const { container } = render(<CredentialPicker providerId="byteplus" current={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('默认「自动」并显示当前会用哪种；能选具体一种，也能切回自动', async () => {
    render(<CredentialPicker providerId="minimax" current="subscription" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0]!.textContent).toBe('自动（当前：订阅 Key）');
    await screen.findByRole('option', { name: '按量 Key · 未配置' });
    fireEvent.change(select, { target: { value: 'paygo' } });
    expect(useStudio.getState().credentials.minimax).toBe('paygo');
    fireEvent.change(select, { target: { value: '' } });
    expect(useStudio.getState().credentials).toEqual({});
  });
});
