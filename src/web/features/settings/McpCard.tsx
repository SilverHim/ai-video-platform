import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_SETUP_URL } from '../../../shared/api-contract';
import { api } from '../../lib/api-client';
import { Button } from '../../ui/primitives';

export function McpCard() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{ url: string; token: string; command: string } | null>(null);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<'command' | 'sentence' | null>(null);
  const load = () => void api.mcpInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(load, []);
  if (!info) return null;
  const masked = info.command.replace(info.token, show ? info.token : `${info.token.slice(0, 6)}…${info.token.slice(-4)}`);
  const sentence = t('mcp.agentSentence', { url: AGENT_SETUP_URL, interpolation: { escapeValue: false } });
  const copy = (text: string, which: 'command' | 'sentence') =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1200);
    });
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4" data-testid="mcp-card">
      <p className="text-sm text-[var(--color-muted)]">{t('mcp.agentIntro')}</p>
      <div className="flex items-start gap-2">
        <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-bg)] p-2 font-mono text-xs" data-testid="mcp-agent-sentence">
          {sentence}
        </pre>
        <Button size="sm" onClick={() => copy(sentence, 'sentence')}>
          {copied === 'sentence' ? <Check size={12} /> : <Copy size={12} />}
          {copied === 'sentence' ? t('preview.copied') : t('mcp.copySentence')}
        </Button>
      </div>
      <p className="text-sm text-[var(--color-muted)]">{t('mcp.intro')}</p>
      <div className="text-sm">
        <span className="text-[var(--color-muted)]">{t('mcp.url')}：</span>
        <code>{info.url}</code>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-bg)] p-2 font-mono text-xs">{masked}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy(info.command, 'command')}>
          {copied === 'command' ? <Check size={12} /> : <Copy size={12} />}
          {copied === 'command' ? t('preview.copied') : t('mcp.copy')}
        </Button>
        <Button size="sm" onClick={() => setShow(!show)}>
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
          {show ? t('mcp.hide') : t('mcp.show')}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (confirm(t('mcp.rotateConfirm'))) void api.rotateMcpToken().then(load);
          }}
        >
          <RefreshCw size={12} />
          {t('mcp.rotate')}
        </Button>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--color-muted)]">
        <li>{t('mcp.note1')}</li>
        <li>{t('mcp.note2')}</li>
        <li>{t('mcp.note3')}</li>
      </ul>
    </div>
  );
}
