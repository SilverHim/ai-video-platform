import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api-client';
import { Button } from '../../ui/primitives';

export function McpCard() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{ url: string; token: string; command: string } | null>(null);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () => void api.mcpInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(load, []);
  if (!info) return null;
  const masked = info.command.replace(info.token, show ? info.token : `${info.token.slice(0, 6)}…${info.token.slice(-4)}`);
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4" data-testid="mcp-card">
      <p className="text-sm text-[var(--color-muted)]">{t('mcp.intro')}</p>
      <div className="text-sm">
        <span className="text-[var(--color-muted)]">{t('mcp.url')}：</span>
        <code>{info.url}</code>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-bg)] p-2 font-mono text-xs">{masked}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void navigator.clipboard.writeText(info.command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? t('preview.copied') : t('mcp.copy')}
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
