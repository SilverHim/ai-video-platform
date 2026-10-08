import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keyIdOf, keyKindsOf, type KeyStatus } from '../../../shared/api-contract';
import type { CredentialKind } from '../../../shared/catalog/types';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { inputClass } from '../../ui/primitives';

/**
 * 提交前选用哪种 Key（只对有多种 Key 的服务商显示，目前是 MiniMax 的按量 / 订阅）。
 * 没选时由服务端决定：有订阅 Key 用订阅，否则用按量。
 */
export function CredentialPicker({ providerId, current }: { providerId: string; current: CredentialKind | undefined }) {
  const { t } = useTranslation();
  const chosen = useStudio((s) => s.credentials[providerId]);
  const setCredential = useStudio((s) => s.setCredential);
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const kinds = keyKindsOf(providerId);

  useEffect(() => {
    if (kinds.length < 2) return;
    api
      .listKeys()
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys(null));
  }, [providerId, kinds.length]);

  if (kinds.length < 2) return null;
  const configured = (kind: CredentialKind) => keys?.find((k) => k.keyId === keyIdOf(providerId, kind))?.configured ?? false;
  const value = chosen ?? current ?? 'subscription';
  return (
    <label className="flex items-center gap-1 text-sm" data-testid="credential-picker">
      <span className="text-[var(--color-muted)]">{t('credential.label')}</span>
      <select className={clsx(inputClass, 'py-0.5')} value={value} onChange={(e) => setCredential(providerId, e.target.value as CredentialKind)}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`credential.kind.${k}`)}
            {keys && !configured(k) ? ` · ${t('credential.notConfigured')}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
