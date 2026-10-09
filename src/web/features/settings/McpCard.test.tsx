import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AGENT_SETUP_URL } from '../../../shared/api-contract';
import i18n from '../../i18n';
import { api } from '../../lib/api-client';
import { McpCard } from './McpCard';

const TOKEN = 'a'.repeat(64);
const info = { url: 'http://127.0.0.1:8787/mcp', token: TOKEN, command: `claude mcp add --transport http --scope user ai-video http://127.0.0.1:8787/mcp --header "Authorization: Bearer ${TOKEN}"` };

beforeAll(async () => {
  await i18n.changeLanguage('zh');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('McpCard', () => {
  it('给出对 agent 说的一句话（不含令牌），可复制', async () => {
    vi.spyOn(api, 'mcpInfo').mockResolvedValue(info);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<McpCard />);
    const sentence = await screen.findByTestId('mcp-agent-sentence');
    expect(sentence.textContent).toContain(AGENT_SETUP_URL);
    expect(sentence.textContent).not.toContain(TOKEN);
    // URL 里的斜杠不能被转义成 &#x2F;
    expect(sentence.textContent).not.toContain('&#x2F;');
    fireEvent.click(screen.getByRole('button', { name: /复制这句话/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`帮我按 ${AGENT_SETUP_URL} 安装并接入 AI视频生成平台的 MCP`));
  });

  it('接入命令默认打码，复制的是完整命令', async () => {
    vi.spyOn(api, 'mcpInfo').mockResolvedValue(info);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<McpCard />);
    await screen.findByTestId('mcp-card');
    expect(screen.getByTestId('mcp-card').textContent).not.toContain(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /复制接入命令/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(info.command));
  });
});
