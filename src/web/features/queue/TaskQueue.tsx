import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getModel } from '../../../shared/providers/registry';
import { useText } from '../../i18n/useText';
import { api } from '../../lib/api-client';
import { useTasks } from '../../stores/tasks';
import { Button } from '../../ui/primitives';
import { StatusBadge } from '../results/ResultView';

/** 最近任务（网页与 MCP 共享，实时更新） */
export function TaskQueue({ onSelect, selectedId, limit = 30 }: { onSelect: (id: string) => void; selectedId: string | null; limit?: number }) {
  const { t } = useTranslation();
  const tx = useText();
  const { byId, order } = useTasks();
  const ids = order.slice(0, limit);
  if (!ids.length) return <p className="text-sm text-[var(--color-muted)]">{t('queue.empty')}</p>;
  return (
    <ul className="space-y-1" data-testid="task-queue">
      {ids.map((id) => {
        const task = byId[id]!;
        const model = getModel(task.modelId)?.model;
        const thumb = task.results.find((r) => r.path && r.kind === 'image');
        return (
          <li key={id}>
            <div role="button" tabIndex={0} onClick={() => onSelect(id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(id)} className={`flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm ${selectedId === id ? 'bg-[var(--color-accent)]/12' : 'hover:bg-[var(--color-bg)]'}`}>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-[var(--color-bg)]">{thumb?.path ? <img src={api.fileUrl(thumb.path)} alt="" className="h-full w-full object-cover" /> : null}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <StatusBadge status={task.status} />
                  <span className="truncate">{model ? tx(model.label) : task.modelId}</span>
                </div>
                <div className="truncate text-xs text-[var(--color-muted)]">{task.form.prompt.replace(/\{\{ref:[^}]+\}\}/g, '[ref]') || '—'}</div>
              </div>
              <Button size="sm" variant="ghost" title={t('queue.delete')} onClick={(e) => (e.stopPropagation(), void api.deleteTask(id))}>
                <Trash2 size={12} />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
