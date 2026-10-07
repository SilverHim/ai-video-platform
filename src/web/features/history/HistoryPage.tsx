import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PROVIDERS } from '../../../shared/providers/registry';
import type { ExchangeRecord, TaskRecord } from '../../../shared/task/records';
import { useText } from '../../i18n/useText';
import { api } from '../../lib/api-client';
import { useTasks } from '../../stores/tasks';
import { Button, inputClass, Panel } from '../../ui/primitives';
import { StatusBadge, TaskResult } from '../results/ResultView';

function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const live = useTasks((s) => s.byId[id]);
  const [data, setData] = useState<{ task: TaskRecord; exchanges: ExchangeRecord[] } | null>(null);
  useEffect(() => {
    api.getTask(id).then(setData).catch(() => setData(null));
  }, [id, live?.updatedAt]);
  const task = live ?? data?.task;
  if (!task) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-20 w-full max-w-2xl overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-xl" data-testid="task-detail">
      <div className="mb-3 flex items-center">
        <h3 className="font-semibold">{t('history.detail')}</h3>
        <code className="ml-2 text-xs text-[var(--color-muted)]">{task.id}</code>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <TaskResult task={task} />
      <div className="mt-4 space-y-3 text-sm">
        <section>
          <h4 className="mb-1 font-medium">{t('history.prompt')}</h4>
          <p className="whitespace-pre-wrap rounded-md bg-[var(--color-bg)] p-2 text-xs">{task.form.prompt || '—'}</p>
        </section>
        <section>
          <h4 className="mb-1 font-medium">{t('history.request')}</h4>
          <pre className="max-h-72 overflow-auto rounded-md bg-[var(--color-bg)] p-2 text-xs">{JSON.stringify(task.request, null, 2)}</pre>
        </section>
        <section>
          <h4 className="mb-1 font-medium">{t('history.raw')}</h4>
          {data?.exchanges.length ? (
            data.exchanges.map((e) => (
              <details key={e.id} className="mb-1 rounded-md bg-[var(--color-bg)] p-2 text-xs">
                <summary className="cursor-pointer">
                  {e.kind} · {e.status ?? '—'} · {new Date(e.at).toLocaleTimeString()}
                </summary>
                <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all">{e.body}</pre>
              </details>
            ))
          ) : (
            <p className="text-xs text-[var(--color-muted)]">—</p>
          )}
        </section>
        {task.outputDir ? (
          <p className="text-xs text-[var(--color-muted)]">
            {t('history.outputDir')}：outputs/{task.outputDir}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { t } = useTranslation();
  const tx = useText();
  const { byId, order, loaded } = useTasks();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const selected = params.get('task');
  const list = order.map((id) => byId[id]!).filter((x) => (!status || x.status === status) && (!provider || x.providerId === provider));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t('nav.history')}</h2>
        <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">{t('history.allProviders')}</option>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {tx(p.label)}
            </option>
          ))}
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('history.allStatus')}</option>
          {['succeeded', 'partial', 'failed', 'queued', 'running', 'streaming', 'cancelled', 'expired'].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--color-muted)]">{list.length}</span>
      </div>
      {!loaded ? <p className="text-sm text-[var(--color-muted)]">…</p> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {list.map((task) => {
          const thumb = task.results.find((r) => r.path && r.kind === 'image');
          return (
            <button key={task.id} type="button" onClick={() => setParams({ task: task.id })} className={clsx('overflow-hidden rounded-lg border text-left', selected === task.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]')}>
              <Panel className="border-0">
                <div className="aspect-square overflow-hidden rounded bg-[var(--color-bg)]">{thumb?.path ? <img src={api.fileUrl(thumb.path)} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</div>
                <div className="mt-1.5 flex items-center gap-1">
                  <StatusBadge status={task.status} />
                  <span className="truncate text-xs">{task.form.prompt.replace(/\{\{ref:[^}]+\}\}/g, '[ref]') || '—'}</span>
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">{new Date(task.createdAt).toLocaleString()}</div>
              </Panel>
            </button>
          );
        })}
      </div>
      {selected ? <TaskDetail id={selected} onClose={() => setParams({})} /> : null}
    </div>
  );
}
