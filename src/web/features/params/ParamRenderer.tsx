import clsx from 'clsx';
import { Dice5, ExternalLink, Info, Lock, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EvaluatedForm, FieldDef, FieldState, SizeValue } from '../../../shared/catalog/types';
import type { I18nText } from '../../../shared/i18n';
import { isSizeValue } from '../../../shared/engine/evaluate';
import { useText } from '../../i18n/useText';
import { Badge, inputClass, Segmented, Switch } from '../../ui/primitives';

type OnChange = (key: string, value: unknown) => void;

function FieldShell({ field, state, children }: { field: FieldDef; state: FieldState; children: ReactNode }) {
  const tx = useText();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1" data-field={field.key}>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="font-medium">{tx(field.label)}</span>
        <code className="text-[11px] text-[var(--color-muted)]">{field.wire ?? field.key}</code>
        {field.experimental ? <Badge tone="warn">{t('params.experimental')}</Badge> : null}
        {state.locked ? (
          <span title={tx(state.locked.reason)} className="text-[var(--color-warn)]">
            <Lock size={12} />
          </span>
        ) : null}
        {field.help ? (
          <button type="button" className="text-[var(--color-muted)] hover:text-[var(--color-text)]" onClick={() => setOpen(!open)} aria-label="help">
            <Info size={12} />
          </button>
        ) : null}
        {field.docs?.[0] ? (
          <a href={field.docs[0].url} target="_blank" rel="noreferrer noopener" className="text-[var(--color-muted)] hover:text-[var(--color-accent)]" title={`${t('params.docs')} · ${field.docs[0].checkedAt}`}>
            <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
      {children}
      {open && field.help ? <p className="text-xs text-[var(--color-muted)]">{tx(field.help)}</p> : null}
      {state.locked ? <p className="text-xs text-[var(--color-warn)]">{tx(state.locked.reason)}</p> : null}
      {state.disabledReason ? <p className="text-xs text-[var(--color-muted)]">{tx(state.disabledReason)}</p> : null}
      {state.adjusted ? <p className="text-xs text-[var(--color-warn)]">{tx(state.adjusted)}</p> : null}
    </div>
  );
}

function NumberInput({ value, onChange, disabled, min, max, step, placeholder }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; min?: number; max?: number; step?: number; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      className={clsx(inputClass, 'w-32')}
      value={text ?? (value === null ? '' : String(value))}
      min={min}
      max={max}
      step={step ?? 1}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return;
        const trimmed = text.trim();
        onChange(trimmed === '' ? null : Number(trimmed));
        setText(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function SizeControl({ field, state, evaluated, onChange, disabled }: { field: Extract<FieldDef, { type: 'size' }>; state: FieldState; evaluated: EvaluatedForm; onChange: OnChange; disabled: boolean }) {
  const { t } = useTranslation();
  const tx = useText();
  const spec = field.spec(evaluated.ctx);
  const v: SizeValue = isSizeValue(state.value) ? state.value : { mode: 'preset', value: spec.presets[0]?.value ?? '' };
  const set = (nv: SizeValue) => onChange(field.key, nv);
  return (
    <div className="space-y-2">
      {spec.custom ? (
        <Segmented
          value={v.mode}
          disabled={disabled}
          options={[
            { value: 'preset', label: t('params.sizePreset') },
            { value: 'custom', label: t('params.sizeCustom') },
          ]}
          onChange={(m) => set(m === 'preset' ? { mode: 'preset', value: spec.presets[0]?.value ?? '' } : { mode: 'custom', width: spec.presets[0]?.px?.[0] ?? 1024, height: spec.presets[0]?.px?.[1] ?? 1024 })}
        />
      ) : null}
      {v.mode === 'preset' ? (
        <select className={inputClass} value={v.value} disabled={disabled} onChange={(e) => set({ mode: 'preset', value: e.target.value })}>
          {spec.presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label ? tx(p.label) : p.value}
              {p.px ? `（${p.px[0]}×${p.px[1]}）` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <NumberInput value={v.width} disabled={disabled} onChange={(w) => set({ ...v, width: w ?? 0 })} step={spec.custom?.multipleOf ?? 1} />
          <span>×</span>
          <NumberInput value={v.height} disabled={disabled} onChange={(h) => set({ ...v, height: h ?? 0 })} step={spec.custom?.multipleOf ?? 1} />
          <span className="text-xs text-[var(--color-muted)]">
            {spec.custom?.minPixels !== undefined || spec.custom?.maxPixels !== undefined ? `${t('params.pixels')} ${spec.custom?.minPixels ?? '-'}–${spec.custom?.maxPixels ?? '-'}` : ''}
            {spec.custom?.side ? ` · ${t('params.side')} ${spec.custom.side[0]}–${spec.custom.side[1]}` : ''}
            {spec.custom?.multipleOf ? ` · ×${spec.custom.multipleOf}` : ''}
          </span>
          {spec.presets.some((p) => p.px) ? (
            <select className={clsx(inputClass, 'text-xs')} value="" onChange={(e) => {
              const p = spec.presets.find((x) => x.value === e.target.value);
              if (p?.px) set({ mode: 'custom', width: p.px[0], height: p.px[1] });
            }}>
              <option value="">{t('params.fillFromPreset')}</option>
              {spec.presets.filter((p) => p.px).map((p) => (
                <option key={p.value} value={p.value}>{`${p.value} ${p.px![0]}×${p.px![1]}`}</option>
              ))}
            </select>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Control({ field, state, evaluated, onChange }: { field: FieldDef; state: FieldState; evaluated: EvaluatedForm; onChange: OnChange }) {
  const { t } = useTranslation();
  const tx = useText();
  const disabled = Boolean(state.locked || state.disabledReason);
  switch (field.type) {
    case 'enum': {
      const all = (state.options ?? field.options) as (typeof field.options[number] & { disabledReason?: I18nText })[];
      const opts = all.map((o) => ({
        value: o.value,
        label: (
          <span className="inline-flex items-center gap-1">
            {o.label ? tx(o.label) : o.value}
            {o.badge ? <Badge tone="accent">{tx(o.badge)}</Badge> : null}
          </span>
        ),
        disabled: Boolean(o.disabledReason),
        title: o.disabledReason ? tx(o.disabledReason) : o.value,
      }));
      // 只有一个选项时一律用下拉框：看得出"只有这一项"，而不是像分段按钮那样"点不动"
      const control = opts.length === 1 ? 'select' : (field.control ?? (opts.length <= 4 ? 'segmented' : 'select'));
      if (control === 'segmented') {
        return <Segmented value={String(state.value)} options={opts} disabled={disabled} onChange={(v) => onChange(field.key, v)} />;
      }
      return (
        <select className={inputClass} value={String(state.value)} disabled={disabled} onChange={(e) => onChange(field.key, e.target.value)}>
          {all.map((o) => (
            <option key={o.value} value={o.value} disabled={Boolean(o.disabledReason)}>
              {o.label ? `${tx(o.label)}（${o.value}）` : o.value}
              {o.badge ? ` · ${tx(o.badge)}` : ''}
            </option>
          ))}
        </select>
      );
    }
    case 'int':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <NumberInput value={(state.value as number | null) ?? null} min={field.min} max={field.max} step={field.step ?? (field.pattern?.step ?? 1)} disabled={disabled} onChange={(v) => onChange(field.key, v)} />
          {field.specials?.map((s) => (
            <button key={s.value} type="button" disabled={disabled} onClick={() => onChange(field.key, s.value)} className={clsx('rounded border px-2 py-0.5 text-xs', state.value === s.value ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)]')}>
              {tx(s.label)}
            </button>
          ))}
          <span className="text-xs text-[var(--color-muted)]">
            {field.min}–{field.max}
            {field.pattern ? ` · ${field.pattern.base}+${field.pattern.step}n` : ''}
          </span>
        </div>
      );
    case 'seed':
      return (
        <div className="flex items-center gap-2">
          <NumberInput value={(state.value as number | null) ?? null} min={field.min} max={field.max} disabled={disabled} placeholder={t('params.seedRandom')} onChange={(v) => onChange(field.key, v)} />
          <button type="button" title={t('params.seedDice')} disabled={disabled} onClick={() => onChange(field.key, Math.floor(Math.random() * Math.min(field.max, 2147483647)))} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <Dice5 size={16} />
          </button>
          {state.value !== null ? (
            <button type="button" title={t('params.seedClear')} disabled={disabled} onClick={() => onChange(field.key, null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          ) : null}
        </div>
      );
    case 'bool':
      return <Switch checked={Boolean(state.value)} disabled={disabled} label={tx(field.label)} onChange={(v) => onChange(field.key, v)} />;
    case 'text':
      return field.multiline ? (
        <textarea className={clsx(inputClass, 'w-full')} rows={3} maxLength={field.maxLength} value={String(state.value ?? '')} disabled={disabled} onChange={(e) => onChange(field.key, e.target.value)} />
      ) : (
        <input className={clsx(inputClass, 'w-full')} maxLength={field.maxLength} value={String(state.value ?? '')} disabled={disabled} onChange={(e) => onChange(field.key, e.target.value)} />
      );
    case 'size':
      return <SizeControl field={field} state={state} evaluated={evaluated} onChange={onChange} disabled={disabled} />;
  }
}

const GROUPS: FieldDef['group'][] = ['basic', 'advanced', 'output'];

/** 按模型声明渲染参数表单：只显示当前可见字段，锁定 / 禁用字段显示原因 */
export function ParamRenderer({ evaluated, onChange }: { evaluated: EvaluatedForm; onChange: OnChange }) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fields = evaluated.ctx.model.fields.filter((f) => evaluated.fields[f.key]?.visible);
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const list = fields.filter((f) => f.group === g);
        if (!list.length) return null;
        const collapsed = g === 'advanced' && !showAdvanced;
        return (
          <div key={g} className="space-y-3">
            <button type="button" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]" onClick={() => g === 'advanced' && setShowAdvanced(!showAdvanced)}>
              {t(`params.group.${g}`)} {g === 'advanced' ? (showAdvanced ? '▾' : `▸ (${list.length})`) : ''}
            </button>
            {collapsed
              ? null
              : list.map((f) => (
                  <FieldShell key={f.key} field={f} state={evaluated.fields[f.key]!}>
                    <Control field={f} state={evaluated.fields[f.key]!} evaluated={evaluated} onChange={onChange} />
                  </FieldShell>
                ))}
          </div>
        );
      })}
    </div>
  );
}
