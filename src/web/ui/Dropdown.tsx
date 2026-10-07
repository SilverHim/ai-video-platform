import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';

/** 弹层离视口边缘至少留这么多像素 */
const VIEWPORT_GAP = 8;

/**
 * 通用下拉弹层：按钮开合；点外面、焦点 Tab 出去、Esc 都会关闭（Esc 后焦点回到按钮）。
 * 打开时按视口宽度把弹层往回推，窄窗口下不溢出。children 用函数形式拿到 close，选完即可关闭。
 */
export function Dropdown({
  label,
  title,
  ariaLabel,
  haspopup,
  buttonId: externalButtonId,
  active = false,
  panelClassName,
  buttonClassName,
  onOpen,
  children,
}: {
  label: ReactNode;
  title?: string;
  ariaLabel?: string;
  /** 弹层是 listbox 时传 'listbox'；普通的复选框组属于展开 / 收起模式，不传 */
  haspopup?: 'listbox' | 'menu' | 'dialog';
  /** 需要从外部把焦点还给按钮时指定 id */
  buttonId?: string;
  /** 有筛选生效时高亮按钮 */
  active?: boolean;
  panelClassName?: string;
  buttonClassName?: string;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const ownButtonId = useId();
  const buttonId = externalButtonId ?? ownButtonId;

  // 按 id 找回按钮聚焦（这个函数会传给 children，不能在里面读 ref）
  const close = () => {
    setOpen(false);
    document.getElementById(buttonId)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // 打开时测量：右边超出视口就整体左移，左边不越过视口
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const overRight = r.right - (window.innerWidth - VIEWPORT_GAP);
    const shift = overRight > 0 ? Math.max(-overRight, VIEWPORT_GAP - r.left) : 0;
    if (shift) el.style.transform = `translateX(${shift}px)`;
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  };

  // 焦点移到弹层外的另一个可聚焦元素（如 Tab）时关闭，不抢焦点；relatedTarget 为空（点到弹层里的空白处）时不处理
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (open && next && !wrap.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={wrap} className="relative inline-block" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        id={buttonId}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup={haspopup}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={clsx(
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm transition-colors',
          active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] bg-[var(--color-panel)] hover:bg-[var(--color-bg)]',
          buttonClassName,
        )}
      >
        {label}
        <ChevronDown size={14} className={clsx('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          className={clsx(
            'absolute left-0 top-full z-30 mt-1 max-h-[70vh] min-w-[12rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-lg',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** 多选菜单：一组复选框（展开 / 收起模式，用 Tab 在复选框之间移动） */
export function CheckMenu<T extends string>({
  label,
  hint,
  options,
  value,
  defaultValue = [],
  onChange,
}: {
  label: string;
  /** 菜单顶部的说明（例如"需同时满足"），会关联到整组复选框 */
  hint?: string;
  /** description：显示在选项下方的说明，并关联到该复选框 */
  options: { value: T; label: ReactNode; description?: string }[];
  value: T[];
  /** 默认勾选项：与默认一致时按钮不高亮、不显示数量 */
  defaultValue?: T[];
  onChange: (v: T[]) => void;
}) {
  const hintId = useId();
  const descPrefix = useId();
  // 只看菜单里列出的选项（当前类型下不存在的选项不算）
  const visible = value.filter((v) => options.some((o) => o.value === v));
  const count = visible.length;
  const changed = count !== defaultValue.length || visible.some((v) => !defaultValue.includes(v));
  return (
    <Dropdown label={changed && count ? `${label} · ${count}` : label} active={changed}>
      {() => (
        <div role="group" aria-label={label} aria-describedby={hint ? hintId : undefined} className="max-w-[20rem] space-y-0.5">
          {hint ? (
            <p id={hintId} className="px-2 py-1 text-[11px] text-[var(--color-muted)]">
              {hint}
            </p>
          ) : null}
          {options.map((o) => {
            const descId = `${descPrefix}-${o.value}`;
            return (
              <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-bg)]">
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--color-accent)]"
                  checked={value.includes(o.value)}
                  aria-describedby={o.description ? descId : undefined}
                  onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
                />
                <span>
                  {o.label}
                  {o.description ? (
                    <span id={descId} className="block text-[11px] leading-snug text-[var(--color-muted)]">
                      {o.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}
