import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../shared/engine/media';
import { useText } from '../../i18n/useText';
import type { ConsentInfo } from '../../lib/api-client';
import { Button, Segmented } from '../../ui/primitives';

/** 本地视频上传到公共临时托管站之前的确认弹窗：必须勾选"已知晓"才能继续 */
export function ConsentDialog({ info, tempHost, onTempHost, onConfirm, onCancel }: { info: ConsentInfo; tempHost: 'uguu' | 'tmpfiles'; onTempHost: (h: 'uguu' | 'tmpfiles') => void; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const tx = useText();
  const [ack, setAck] = useState(false);
  const tooBig = info.files.filter((f) => f.bytes !== null && f.bytes > info.target.maxBytes);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="consent-dialog">
      <div className="w-full max-w-lg space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-xl">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldAlert size={18} className="text-[var(--color-warn)]" />
          {t('consent.title')}
        </h3>
        <p className="text-sm">{t('consent.why')}</p>
        <div className="space-y-1 text-sm">
          <div className="font-medium">{t('consent.host')}</div>
          <Segmented value={tempHost} onChange={onTempHost} options={[{ value: 'uguu', label: 'uguu.se · 3h · ≤128 MiB' }, { value: 'tmpfiles', label: 'tmpfiles.org · 24h · ≤100 MiB' }]} />
          <div className="text-xs text-[var(--color-muted)]">
            {tx(info.target.label)}
            {info.target.homepage ? (
              <>
                {' · '}
                <a href={info.target.homepage} target="_blank" rel="noreferrer noopener" className="underline">
                  {t('consent.terms')}
                </a>
              </>
            ) : null}
          </div>
        </div>
        <ul className="space-y-0.5 rounded-md bg-[var(--color-bg)] p-2 text-xs">
          {info.files.map((f) => (
            <li key={f.name} className={f.bytes !== null && f.bytes > info.target.maxBytes ? 'text-[var(--color-danger)]' : ''}>
              {f.name} {f.bytes !== null ? `· ${formatBytes(f.bytes)}` : ''}
            </li>
          ))}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--color-muted)]">
          <li>{t('consent.public')}</li>
          <li>{t('consent.expire', { hours: Math.round(info.target.ttlMs / 3600_000) })}</li>
          <li>{t('consent.noFace')}</li>
          <li>{t('consent.alternatives')}</li>
        </ul>
        {tooBig.length ? <p className="text-sm text-[var(--color-danger)]">{t('consent.tooBig', { max: formatBytes(info.target.maxBytes) })}</p> : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          {t('consent.ack')}
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{t('consent.cancel')}</Button>
          <Button variant="primary" disabled={!ack || tooBig.length > 0} onClick={onConfirm} data-testid="consent-confirm">
            {t('consent.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
