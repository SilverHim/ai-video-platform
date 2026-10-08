import { useTranslation } from 'react-i18next';
import type { PlanQuotaItem, QuotaWindow } from '../../../shared/providers/minimax/quota';

/** 「约 X 天 Y 小时 / X 小时 Y 分」后重置 */
function duration(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return t('quota.daysHours', { d, h });
  if (h > 0) return t('quota.hoursMinutes', { h, m });
  return t('quota.minutes', { m });
}

function WindowRow({ label, w }: { label: string; w: QuotaWindow }) {
  const { t, i18n } = useTranslation();
  const pct = w.remainingPercent;
  const tone = pct === null ? 'var(--color-muted)' : pct <= 10 ? 'var(--color-danger)' : pct <= 30 ? 'var(--color-warn)' : 'var(--color-ok)';
  const resetAt = w.end !== null ? new Date(w.end).toLocaleString(i18n.language === 'en' ? 'en' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-medium">{label}</span>
        <span style={{ color: tone }}>{pct === null ? t('quota.unknown') : t('quota.remaining', { pct })}</span>
        {w.resetsInMs !== null ? (
          <span className="text-[var(--color-muted)]">
            {t('quota.resetsIn', { time: duration(w.resetsInMs, t) })}
            {resetAt ? `（${resetAt}）` : ''}
          </span>
        ) : null}
      </div>
      {pct !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--color-bg)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${label} ${t('quota.remaining', { pct })}`}>
          <div className="h-full rounded" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone }} />
        </div>
      ) : null}
    </div>
  );
}

/** MiniMax 订阅额度：5 小时窗口 + 周窗口（字段含义按实测推断） */
export function QuotaView({ items }: { items: PlanQuotaItem[] }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 space-y-3 rounded bg-[var(--color-bg)]/60 p-2" data-testid="quota-view">
      {items.map((it) => (
        <div key={it.model} className="space-y-1.5">
          <div className="text-xs text-[var(--color-muted)]">{t(`quota.model.${it.model}`, { defaultValue: it.model || t('quota.model.unknown') })}</div>
          {it.interval ? <WindowRow label={t('quota.interval')} w={it.interval} /> : null}
          {it.weekly ? <WindowRow label={t('quota.weekly')} w={it.weekly} /> : null}
        </div>
      ))}
      <p className="text-[11px] text-[var(--color-muted)]">{t('quota.note')}</p>
    </div>
  );
}
