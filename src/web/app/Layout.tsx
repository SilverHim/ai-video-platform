import clsx from 'clsx';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { setLanguage } from '../i18n';
import { useHealth } from './useHealth';

export function Layout() {
  const { t, i18n } = useTranslation();
  const { health, online } = useHealth();
  const navItem = ({ isActive }: { isActive: boolean }) =>
    clsx('rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]');

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2">
        <h1 className="text-base font-semibold">{t('app.title')}</h1>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navItem}>
            {t('nav.studio')}
          </NavLink>
          <NavLink to="/settings" className={navItem}>
            {t('nav.settings')}
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span data-testid="health" className="flex items-center gap-1.5">
            <span className={clsx('inline-block h-2 w-2 rounded-full', online ? 'bg-[var(--color-ok)]' : online === false ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-muted)]')} />
            {online ? t('health.online') : online === false ? t('health.offline') : '…'}
            {health?.mock ? <span className="rounded bg-[var(--color-warn)] px-1.5 text-xs text-white">{t('health.mock')}</span> : null}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg)]"
            onClick={() => setLanguage(i18n.language === 'zh' ? 'en' : 'zh')}
          >
            <Languages size={14} />
            {t('lang.switch')}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4">
        <Outlet context={{ health }} />
      </main>
    </div>
  );
}
