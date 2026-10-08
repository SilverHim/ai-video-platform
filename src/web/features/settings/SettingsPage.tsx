import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import type { HealthInfo, KeyStatus, ProviderId } from '../../../shared/api-contract';
import { api, ApiRequestError } from '../../lib/api-client';
import { useText } from '../../i18n/useText';
import { EndpointCard } from './EndpointCard';
import { McpCard } from './McpCard';

function KeyCard({ status, onChange }: { status: KeyStatus; onChange: (s: KeyStatus) => void }) {
  const { t } = useTranslation();
  const tx = useText();
  const [value, setValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = status.source === 'env';

  const run = async (fn: () => Promise<{ key: KeyStatus }>, ok: string) => {
    setMessage(null);
    try {
      const { key } = await fn();
      onChange(key);
      setValue('');
      setMessage(ok);
    } catch (err) {
      setMessage(t('error.generic', { message: err instanceof ApiRequestError ? err.message : String(err) }));
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4" data-testid={`key-card-${status.provider}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{t(`provider.${status.provider}`)}</span>
        <span className="text-sm text-[var(--color-muted)]">
          {status.configured ? `${t('settings.configured')} · ${status.masked ?? ''}` : t('settings.notConfigured')}
        </span>
      </div>
      {readOnly ? (
        <p className="text-sm text-[var(--color-muted)]">{t('settings.fromEnv')}</p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void run(() => api.setKey(status.provider as ProviderId, value), t('settings.saved'));
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
            placeholder={t('settings.placeholder')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-sm text-white disabled:opacity-50" disabled={!value.trim()}>
            {t('settings.save')}
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm disabled:opacity-50"
            disabled={!status.configured}
            onClick={() => void run(() => api.clearKey(status.provider as ProviderId), t('settings.cleared'))}
          >
            {t('settings.clear')}
          </button>
        </form>
      )}
      {status.configured ? (
        <button
          type="button"
          className="mt-2 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs disabled:opacity-50"
          disabled={testing}
          onClick={() => {
            setTesting(true);
            setMessage(null);
            api
              .testKey(status.provider as ProviderId)
              .then((r) => setMessage(r.ok ? t('settings.testOk') : t('settings.testFail', { message: r.error ? `${r.error.code} ${r.error.hint ? tx(r.error.hint) : r.error.message}` : `HTTP ${r.status}` })))
              .catch((e: unknown) => setMessage(t('error.generic', { message: e instanceof Error ? e.message : String(e) })))
              .finally(() => setTesting(false));
          }}
        >
          {t('settings.test')}
        </button>
      ) : null}
      {message ? <p className="mt-2 text-sm text-[var(--color-muted)]">{message}</p> : null}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { health } = useOutletContext<{ health: HealthInfo | null }>();
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const load = useCallback(() => {
    api
      .listKeys()
      .then((r) => setKeys(r.keys))
      .catch(() => setKeys([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
      <section className="space-y-3">
        <h3 className="font-medium">{t('settings.keys')}</h3>
        <p className="text-sm text-[var(--color-muted)]">{t('settings.keysHint', { dataDir: health?.dataDir ?? '…' })}</p>
        {keys.map((k) => (
          <KeyCard key={k.provider} status={k} onChange={(s) => setKeys((prev) => prev.map((p) => (p.provider === s.provider ? s : p)))} />
        ))}
      </section>
      <section className="space-y-3">
        <h3 className="font-medium">{t('endpoint.title')}</h3>
        <EndpointCard />
      </section>
      <section className="space-y-3">
        <h3 className="font-medium">{t('mcp.title')}</h3>
        <McpCard />
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">{t('settings_data.title')}</h3>
        <button
          type="button"
          className="rounded-md border border-[var(--color-border)] px-3 py-1 text-sm"
          onClick={() => void api.rebuildHistory().then((r) => alert(t('settings_data.rebuildDone', r)))}
        >
          {t('settings_data.rebuild')}
        </button>
      </section>
    </div>
  );
}
