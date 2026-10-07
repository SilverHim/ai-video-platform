import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { listModels } from '../../../shared/providers/registry';
import { useText } from '../../i18n/useText';
import { useStudio } from '../../stores/studio';
import { Badge, Switch } from '../../ui/primitives';

export function ModelPicker() {
  const { t } = useTranslation();
  const tx = useText();
  const { modelId, selectModel, showHidden, setShowHidden } = useStudio();
  const all = listModels({ includeHidden: showHidden });
  const groups: { kind: 'image' | 'video'; label: string }[] = [
    { kind: 'image', label: t('studio.image') },
    { kind: 'video', label: t('studio.video') },
  ];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const items = all.filter((x) => x.model.output === g.kind);
        if (!items.length) return null;
        return (
          <div key={g.kind} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{g.label}</h3>
            {items.map(({ provider, model }) => (
              <button
                key={model.id}
                type="button"
                onClick={() => selectModel(model.id)}
                className={clsx('block w-full rounded-md px-2 py-1.5 text-left text-sm', model.id === modelId ? 'bg-[var(--color-accent)]/12 ring-1 ring-[var(--color-accent)]' : 'hover:bg-[var(--color-bg)]')}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate font-medium">{tx(model.label)}</span>
                  {model.lifecycle.status !== 'active' ? <Badge tone="warn">{t(`lifecycle.${model.lifecycle.status}`)}</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-muted)]">
                  <span>{tx(provider.label)}</span>
                  {model.badges?.map((b) => (
                    <Badge key={b.en}>{tx(b)}</Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        );
      })}
      {all.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t('studio.noModels')}</p> : null}
      <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <Switch checked={showHidden} onChange={setShowHidden} />
        {t('studio.showHidden')}
      </label>
    </div>
  );
}
