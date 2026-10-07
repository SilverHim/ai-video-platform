import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../shared/engine/media';
import type { PreviewResponse } from '../../lib/api-client';
import { useText } from '../../i18n/useText';
import { Segmented } from '../../ui/primitives';

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
      onClick={() => void navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1200)))}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? t('preview.copied') : t('preview.copy')}
    </button>
  );
}

export function RequestPreview({ preview, loading, error }: { preview: PreviewResponse | null; loading: boolean; error: string | null }) {
  const { t } = useTranslation();
  const tx = useText();
  const [tab, setTab] = useState<'json' | 'curl'>('json');
  if (!preview) return <p className="text-sm text-[var(--color-muted)]">{error ?? (loading ? '…' : t('preview.empty'))}</p>;
  const json = JSON.stringify(preview.request.body, null, 2);
  const limit = 64_000_000;
  return (
    <div className="space-y-2 text-sm" data-testid="request-preview">
      <div className="flex items-center gap-2">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'json', label: 'JSON' }, { value: 'curl', label: 'curl' }]} />
        <span className={clsx('ml-auto text-xs', preview.request.bodyBytes > limit ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]')}>
          {formatBytes(preview.request.bodyBytes)} / 64 MB
        </span>
      </div>
      <div className="truncate font-mono text-xs text-[var(--color-muted)]" title={preview.request.url}>
        {preview.request.method} {preview.request.url}
        {preview.request.stream ? ' (SSE)' : ''}
      </div>
      <div className="relative">
        <div className="absolute right-2 top-2">
          <CopyButton text={tab === 'json' ? json : preview.curl} />
        </div>
        <pre className={clsx('max-h-[50vh] overflow-auto rounded-md bg-[var(--color-bg)] p-2 font-mono text-xs leading-relaxed', loading && 'opacity-60')}>{tab === 'json' ? json : preview.curl}</pre>
      </div>
      <p className="text-xs text-[var(--color-muted)]">{t('preview.note')}</p>
      {preview.cost ? (
        <p className="text-xs">
          {t('preview.cost')}：<b>${preview.cost.amount.toFixed(4)}</b> <span className="text-[var(--color-muted)]">（{tx(preview.cost.basis)}）</span>
        </p>
      ) : null}
      {preview.notes.map((n) => (
        <p key={n.en} className="text-xs text-[var(--color-muted)]">
          {tx(n)}
        </p>
      ))}
    </div>
  );
}
