import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { keyKindsOf, type HealthInfo, type KeyStatus } from '../../../shared/api-contract';
import { api, ApiRequestError } from '../../lib/api-client';
import { useText } from '../../i18n/useText';
import { EndpointCard } from './EndpointCard';
import { McpCard } from './McpCard';

function KeyCard({ status, onChange }: { status: KeyStatus; onChange: () => void }) {
  const { t } = useTranslation();
  const tx = useText();
  const [value, setValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quota, setQuota] = useState<string | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const readOnly = status.source === 'env';
  // MiniMax 订阅 Key 以 sk-cp- 开头（官方 CLI 文档）：填错槽位时提示，不拦截
  const multiKind = keyKindsOf(status.provider).length > 1;
  const mismatch = multiKind && value.trim() !== '' && (status.kind === 'subscription') !== value.trim().startsWith('sk-cp-');

  const run = async (fn: () => Promise<{ key: KeyStatus }>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      // 一个槽位的变化可能影响别的槽位（例如 MiniMax 两种 Key）：刷新全部卡片
      onChange();
      setValue('');
      setMessage(ok);
    } catch (err) {
      setMessage(t('error.generic', { message: err instanceof ApiRequestError ? err.message : String(err) }));
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4" data-testid={`key-card-${status.provider}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {t(`provider.${status.provider}`)}
          {multiKind ? ` · ${t(`credential.kind.${status.kind}`)}` : ''}
        </span>
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
            if (value.trim()) void run(() => api.setKey(status.keyId, value), t('settings.saved'));
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
            onClick={() => void run(() => api.clearKey(status.keyId), t('settings.cleared'))}
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
              .testKey(status.keyId)
              .then((r) => setMessage(r.ok ? t('settings.testOk') : t('settings.testFail', { message: r.error ? `${r.error.code} ${r.error.hint ? tx(r.error.hint) : r.error.message}` : `HTTP ${r.status}` })))
              .catch((e: unknown) => setMessage(t('error.generic', { message: e instanceof Error ? e.message : String(e) })))
              .finally(() => setTesting(false));
          }}
        >
          {t('settings.test')}
        </button>
      ) : null}
      {mismatch ? <p className="mt-1 text-xs text-[var(--color-warn)]">{t(status.kind === 'subscription' ? 'credential.notSubscriptionKey' : 'credential.isSubscriptionKey')}</p> : null}
      {status.kind === 'subscription' && status.configured ? (
        <button
          type="button"
          className="ml-2 mt-2 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs disabled:opacity-50"
          disabled={quotaLoading}
          onClick={() => {
            setQuotaLoading(true);
            void api
              .keyQuota(status.keyId)
              .then((r) =>
                setQuota(
                  r.error || r.status >= 400 || r.status === 0
                    ? t('settings.testFail', { message: r.error ? `${r.error.code} ${r.error.hint ? tx(r.error.hint) : r.error.message}` : `HTTP ${r.status}` })
                    : JSON.stringify(r.body, null, 2),
                ),
              )
              .catch((e: unknown) => setQuota(t('error.generic', { message: e instanceof Error ? e.message : String(e) })))
              .finally(() => setQuotaLoading(false));
          }}
        >
          {t('credential.quota')}
        </button>
      ) : null}
      {message ? <p className="mt-2 text-sm text-[var(--color-muted)]">{message}</p> : null}
      {quota ? <pre className="mt-2 max-h-60 overflow-auto rounded bg-[var(--color-bg)] p-2 text-xs">{quota}</pre> : null}
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
          <KeyCard key={k.keyId} status={k} onChange={load} />
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
