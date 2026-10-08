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
 * 「自动」时由服务端决定（有订阅 Key 用订阅，否则按量），提交时带上预览显示的那种。
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
  const status = (kind: CredentialKind) => (keys && !configured(kind) ? ` · ${t('credential.notConfigured')}` : '');
  return (
    <label className="flex items-center gap-1 text-sm" data-testid="credential-picker">
      <span className="text-[var(--color-muted)]">{t('credential.label')}</span>
      <select
        className={clsx(inputClass, 'py-0.5')}
        value={chosen ?? ''}
        onChange={(e) => setCredential(providerId, e.target.value ? (e.target.value as CredentialKind) : null)}
      >
        {/* 自动：有订阅用订阅，否则按量；括号里是这次实际会用的那种（来自预览） */}
        <option value="">{current ? t('credential.autoCurrent', { kind: t(`credential.kind.${current}`) }) : t('credential.auto')}</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`credential.kind.${k}`)}
            {status(k)}
          </option>
        ))}
      </select>
    </label>
  );
}
