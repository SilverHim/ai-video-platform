import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { EndpointInfo } from '../../../shared/api-contract';
import { api, ApiRequestError } from '../../lib/api-client';
import { Button, inputClass } from '../../ui/primitives';

const MANUAL = '__manual__';

type Loaded = { kind: 'ok'; items: EndpointInfo[] } | { kind: 'not-configured' } | { kind: 'error'; message: string };

/**
 * 工作台的 Endpoint 选择：只列出绑定当前模型的 Endpoint（按基础模型名 + 版本匹配），
 * 另有"不用 Endpoint"和"手动输入"。没配 AK/SK 时退回手填。
 */
export function EndpointSelect({ modelId, value, onChange }: { modelId: string; value: string | undefined; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  // 结果按模型分别存：切换模型后，晚到的旧请求只会更新它自己那个模型，不会覆盖当前模型
  const [results, setResults] = useState<Record<string, Loaded>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [manual, setManual] = useState(false);
  const seq = useRef(0);

  // 只在请求返回后写状态（effect 里不同步 setState）
  const load = useCallback(
    (refresh = false) => {
      const id = ++seq.current;
      const m = modelId;
      return api
        .listEndpoints({ modelId: m, refresh })
        .then((items) => setResults((r) => ({ ...r, [m]: { kind: 'ok', items } })))
        .catch((e: unknown) => {
          const next: Loaded =
            e instanceof ApiRequestError && e.code === 'control_not_configured' ? { kind: 'not-configured' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) };
          setResults((r) => ({ ...r, [m]: next }));
        })
        .finally(() => {
          if (id === seq.current) setRefreshing(false);
        });
    },
    [modelId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loaded: Loaded | { kind: 'loading' } = results[modelId] ?? { kind: 'loading' };
  const items = loaded.kind === 'ok' ? loaded.items : [];
  const inList = Boolean(value) && items.some((e) => e.id === value);
  // 加载中不切成手填；加载完后，已填的 ID 不在列表里（手填的或别处来的）才显示成手动输入
  const showManual = manual || loaded.kind === 'not-configured' || loaded.kind === 'error' || (loaded.kind === 'ok' && Boolean(value) && !inList);
  const selectValue = showManual ? MANUAL : (value ?? '');

  const label = (e: EndpointInfo) =>
    [e.name, e.id, e.contentFilter === 'off' ? t('endpoint.filter.off') : e.contentFilter === 'on' ? t('endpoint.filter.on') : null, t(`endpoint.status.${e.status}`, { defaultValue: e.status })]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="space-y-1" data-testid="endpoint-select">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('studio.modelOverride')}</span>
        <Link to="/settings#endpoints" className="text-xs text-[var(--color-accent)]">
          {t('endpoint.manage')}
        </Link>
        {loaded.kind !== 'not-configured' ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('endpoint.refresh')}
            title={t('endpoint.refresh')}
            onClick={() => {
              setRefreshing(true);
              void load(true);
            }}
          >
            <RefreshCw size={12} className={clsx((loaded.kind === 'loading' || refreshing) && 'animate-spin')} />
          </Button>
        ) : null}
      </div>
      {loaded.kind === 'loading' ? (
        <select className={clsx(inputClass, 'w-full')} aria-label={t('studio.modelOverride')} disabled value="">
          <option value="">{t('endpoint.loading')}</option>
        </select>
      ) : null}
      {loaded.kind === 'ok' ? (
        <select
          className={clsx(inputClass, 'w-full')}
          aria-label={t('studio.modelOverride')}
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === MANUAL) {
              setManual(true);
              return;
            }
            setManual(false);
            onChange(v);
          }}
        >
          <option value="">{t('endpoint.none')}</option>
          {items.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e)}
            </option>
          ))}
          <option value={MANUAL}>{t('endpoint.manual')}</option>
        </select>
      ) : null}
      {showManual ? (
        <input className={clsx(inputClass, 'w-full font-mono text-xs')} placeholder="ep-xxxxxxxx" aria-label={t('endpoint.manual')} value={value ?? ''} onChange={(e) => onChange(e.target.value.trim())} />
      ) : null}
      <p className="text-xs text-[var(--color-muted)]">
        {loaded.kind === 'not-configured'
          ? t('endpoint.notConfiguredHint')
          : loaded.kind === 'error'
            ? t('error.generic', { message: loaded.message })
            : loaded.kind === 'ok' && items.length === 0
              ? t('endpoint.noneForModel')
              : t('studio.modelOverrideHint')}
      </p>
    </div>
  );
}
