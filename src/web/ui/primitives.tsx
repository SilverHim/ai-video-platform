import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'default', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-1 rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm',
        variant === 'primary' && 'border-transparent bg-[var(--color-accent)] text-white hover:opacity-90',
        variant === 'default' && 'border-[var(--color-border)] bg-[var(--color-panel)] hover:bg-[var(--color-bg)]',
        variant === 'ghost' && 'border-transparent hover:bg-[var(--color-bg)]',
        variant === 'danger' && 'border-transparent bg-[var(--color-danger)] text-white hover:opacity-90',
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-[var(--color-border)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40',
            o.value === value ? 'bg-[var(--color-accent)] text-white' : 'hover:bg-[var(--color-bg)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]')}
    >
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  );
}

export const inputClass = 'rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm disabled:opacity-50';

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]', className)}>
      {title || actions ? (
        <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        </header>
      ) : null}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' | 'danger' | 'ok' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none',
        tone === 'muted' && 'bg-[var(--color-bg)] text-[var(--color-muted)]',
        tone === 'accent' && 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
        tone === 'warn' && 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]',
        tone === 'danger' && 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
        tone === 'ok' && 'bg-[var(--color-ok)]/15 text-[var(--color-ok)]',
      )}
    >
      {children}
    </span>
  );
}
