import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { availableFilterOptions, DEFAULT_MODEL_FILTER, isFilterActive, matchesFilter, modelCapabilities, type ModelCapabilities } from '../../../shared/catalog/capabilities';
import type { ModelDef, OutputKind, ProviderDef } from '../../../shared/catalog/types';
import { getModel, listModels } from '../../../shared/providers/registry';
import { useText } from '../../i18n/useText';
import { useStudio } from '../../stores/studio';
import { CheckMenu, Dropdown } from '../../ui/Dropdown';
import { Badge, Button, inputClass } from '../../ui/primitives';

interface Entry {
  provider: ProviderDef;
  model: ModelDef;
  caps: ModelCapabilities;
}

const OUTPUTS: OutputKind[] = ['image', 'video'];

// 目录是静态的：模型列表与能力在模块加载时算一次
const ALL: Entry[] = listModels({ includeHidden: true }).map(({ provider, model }) => ({ provider, model, caps: modelCapabilities(model, provider) }));

/** 工作台顶部：类型下拉 + 模型下拉 + 筛选条件 */
export function ModelBar() {
  const { t } = useTranslation();
  const tx = useText();
  const { modelId, selectModel, filters, setFilter, resetFilter, lastByOutput } = useStudio();
  const current = modelId ? getModel(modelId) : undefined;

  const all = ALL;
  const output: OutputKind = current?.model.output ?? 'image';
  const filter = filters[output];
  const ofType = all.filter((e) => e.model.output === output);
  const matched = ofType.filter((e) => matchesFilter(e.model, filter, e.caps));
  const options = availableFilterOptions(all, output);
  const active = isFilterActive(filter, options);
  const modelButtonId = useId();

  // 清除后"清除筛选"按钮会消失，把焦点交给一直存在的模型按钮
  const clearFilter = () => {
    resetFilter(output);
    requestAnimationFrame(() => document.getElementById(modelButtonId)?.focus());
  };

  const switchOutput = (next: OutputKind) => {
    if (next === output) return;
    const last = lastByOutput[next];
    const nextFilter = filters[next];
    const candidates = all.filter((e) => e.model.output === next);
    const target =
      (last && candidates.find((e) => e.model.id === last)) ??
      candidates.find((e) => matchesFilter(e.model, nextFilter, e.caps)) ??
      candidates.find((e) => e.caps.status !== 'deprecated') ??
      candidates[0];
    if (target) selectModel(target.model.id);
  };

  const providerLabel = (id: string) => {
    const p = all.find((e) => e.provider.id === id)?.provider;
    return p ? tx(p.label) : id;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2" data-testid="model-bar">
      <select
        aria-label={t('studio.outputType')}
        className={clsx(inputClass, 'bg-[var(--color-panel)] py-1')}
        value={output}
        onChange={(e) => switchOutput(e.target.value as OutputKind)}
      >
        {OUTPUTS.map((o) => (
          <option key={o} value={o}>
            {t(`studio.${o}`)}
          </option>
        ))}
      </select>

      <ModelSelect
        buttonId={modelButtonId}
        entries={matched}
        current={all.find((e) => e.model.id === modelId)}
        currentMatches={matched.some((e) => e.model.id === modelId)}
        onSelect={selectModel}
        onClearFilter={() => resetFilter(output)}
        filterActive={active}
      />

      <span className="ml-1 text-xs text-[var(--color-muted)]">{t('modelFilter.title')}</span>
      {options.providers.length > 1 ? (
        <CheckMenu
          label={t('modelFilter.provider')}
          options={options.providers.map((p) => ({ value: p, label: providerLabel(p) }))}
          value={filter.providers}
          onChange={(providers) => setFilter(output, { providers })}
        />
      ) : null}
      {options.inputs.length ? (
        <CheckMenu
          label={t('modelFilter.inputs')}
          hint={t('modelFilter.allOf')}
          options={options.inputs.map((c) => ({ value: c, label: t(`modelFilter.input.${c}`) }))}
          value={filter.inputs}
          onChange={(inputs) => setFilter(output, { inputs })}
        />
      ) : null}
      {options.features.length ? (
        <CheckMenu
          label={t('modelFilter.features')}
          hint={t('modelFilter.allOf')}
          options={options.features.map((c) => {
            const description = t(`modelFilter.featureHelp.${c}`, { defaultValue: '' });
            return { value: c, label: t(`modelFilter.feature.${c}`), ...(description ? { description } : {}) };
          })}
          value={filter.features}
          onChange={(features) => setFilter(output, { features })}
        />
      ) : null}
      {options.include.length ? (
        <CheckMenu
          label={t('modelFilter.status')}
          hint={t('modelFilter.statusHint')}
          options={options.include.map((c) => ({ value: c, label: t(`modelFilter.include.${c}`) }))}
          value={filter.include}
          defaultValue={DEFAULT_MODEL_FILTER.include.filter((c) => options.include.includes(c))}
          onChange={(include) => setFilter(output, { include })}
        />
      ) : null}
      {active ? (
        <Button size="sm" variant="ghost" onClick={clearFilter}>
          {t('modelFilter.clear')}
        </Button>
      ) : null}
      <span className="ml-auto text-xs text-[var(--color-muted)]" aria-live="polite">
        {t('modelFilter.count', { n: matched.length, total: ofType.length })}
      </span>
    </div>
  );
}

/** 模型下拉：列表框，支持方向键 / Home / End / 回车选择 */
function ModelSelect({
  buttonId,
  entries,
  current,
  currentMatches,
  onSelect,
  onClearFilter,
  filterActive,
}: {
  buttonId: string;
  entries: Entry[];
  current: Entry | undefined;
  currentMatches: boolean;
  onSelect: (modelId: string) => void;
  onClearFilter: () => void;
  filterActive: boolean;
}) {
  const { t } = useTranslation();
  const tx = useText();
  const [activeIndex, setActiveIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const idPrefix = useId();
  const optionId = (i: number) => `${idPrefix}-option-${i}`;

  // 按服务商分组显示，键盘导航用扁平顺序
  const groups = useMemo(() => {
    const out: { provider: ProviderDef; items: { entry: Entry; index: number }[] }[] = [];
    entries.forEach((entry, index) => {
      let g = out.find((x) => x.provider.id === entry.provider.id);
      if (!g) out.push((g = { provider: entry.provider, items: [] }));
      g.items.push({ entry, index });
    });
    return out;
  }, [entries]);

  // 空结果里清除筛选后列表才出现：等它渲染出来再把焦点交给它，并高亮当前模型
  const clearAndFocus = () => {
    onClearFilter();
    requestAnimationFrame(() => {
      const el = list.current;
      if (!el) return;
      const selected = el.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
      setActiveIndex(selected ? Number(selected.dataset.index ?? 0) : 0);
      el.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>, close: () => void) => {
    if (!entries.length) return;
    const move = (i: number) => {
      e.preventDefault();
      const next = Math.max(0, Math.min(entries.length - 1, i));
      setActiveIndex(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(activeIndex + 1);
    else if (e.key === 'ArrowUp') move(activeIndex - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(entries.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const picked = entries[activeIndex];
      if (picked) {
        onSelect(picked.model.id);
        close();
      }
    }
  };

  return (
    <Dropdown
      buttonClassName="min-w-[14rem] justify-between"
      panelClassName="w-[22rem]"
      buttonId={buttonId}
      haspopup="listbox"
      title={t('studio.model')}
      ariaLabel={current ? t('studio.modelCurrent', { name: tx(current.model.label), provider: tx(current.provider.label) }) : t('studio.model')}
      onOpen={() => {
        const i = entries.findIndex((e) => e.model.id === current?.model.id);
        setActiveIndex(i >= 0 ? i : 0);
        // 打开后把焦点交给列表，方便直接用方向键
        requestAnimationFrame(() => list.current?.focus());
      }}
      label={
        current ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{tx(current.model.label)}</span>
            <span className="truncate text-xs text-[var(--color-muted)]">{tx(current.provider.label)}</span>
          </span>
        ) : (
          <span className="text-[var(--color-muted)]">{t('studio.pickModel')}</span>
        )
      }
    >
      {(close) => (
        <div>
          {current && !currentMatches ? <p className="px-2 py-1 text-[11px] text-[var(--color-warn)]">{t('modelFilter.currentHidden', { name: tx(current.model.label) })}</p> : null}
          {entries.length === 0 ? (
            <div className="space-y-2 px-2 py-3 text-sm text-[var(--color-muted)]">
              <p>{t('modelFilter.noMatch')}</p>
              {filterActive ? (
                <Button size="sm" onClick={clearAndFocus}>
                  {t('modelFilter.clear')}
                </Button>
              ) : null}
            </div>
          ) : (
            <ul
              ref={list}
              role="listbox"
              tabIndex={0}
              aria-label={t('studio.model')}
              aria-activedescendant={optionId(activeIndex)}
              onKeyDown={(e) => onKeyDown(e, close)}
              className="outline-none"
            >
              {groups.map((g) => (
                <li key={g.provider.id} role="presentation">
                  <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{tx(g.provider.label)}</div>
                  <ul role="group" aria-label={tx(g.provider.label)}>
                    {g.items.map(({ entry, index }) => {
                      const selected = entry.model.id === current?.model.id;
                      return (
                        <li
                          key={entry.model.id}
                          id={optionId(index)}
                          data-index={index}
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => {
                            onSelect(entry.model.id);
                            close();
                          }}
                          className={clsx('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm', index === activeIndex ? 'bg-[var(--color-bg)]' : '')}
                        >
                          <Check size={14} className={clsx('mt-0.5 shrink-0', selected ? 'text-[var(--color-accent)]' : 'invisible')} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1">
                              <span className="truncate font-medium">{tx(entry.model.label)}</span>
                              {entry.model.lifecycle.status !== 'active' ? <Badge tone="warn">{t(`lifecycle.${entry.model.lifecycle.status}`)}</Badge> : null}
                            </span>
                            {entry.model.badges?.length ? (
                              <span className="mt-0.5 flex flex-wrap gap-1">
                                {entry.model.badges.map((b) => (
                                  <Badge key={b.en}>{tx(b)}</Badge>
                                ))}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dropdown>
  );
}
