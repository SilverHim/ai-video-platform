import clsx from 'clsx';
import { Ban, Download, Eye, EyeOff, ImagePlus, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResultRecord, TaskRecord } from '../../../shared/task/records';
import { getModel } from '../../../shared/providers/registry';
import { useText } from '../../i18n/useText';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { Badge, Button } from '../../ui/primitives';

const STATUS_TONE: Record<string, 'muted' | 'accent' | 'warn' | 'danger' | 'ok'> = {
  succeeded: 'ok',
  partial: 'warn',
  failed: 'danger',
  cancelled: 'muted',
  expired: 'danger',
  submit_unknown: 'warn',
  unknown: 'warn',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status] ?? 'accent'}>{t(`status.${status}`, { defaultValue: status })}</Badge>;
}

const checker = { backgroundImage: 'conic-gradient(#8884 25%, transparent 0 50%, #8884 0 75%, transparent 0)', backgroundSize: '16px 16px' };

function LayerViewer({ base, layers }: { base: ResultRecord; layers: ResultRecord[] }) {
  const tx = useText();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const W = base.width ?? 1;
  const H = base.height ?? 1;
  const sorted = [...layers].sort((a, b) => (a.layer?.zIndex ?? 0) - (b.layer?.zIndex ?? 0));
  return (
    <div className="space-y-2" data-testid="layer-viewer">
      <div className="relative w-full overflow-hidden rounded-md" style={{ ...checker, aspectRatio: `${W} / ${H}` }}>
        {base.path && !hidden.has(base.id) ? <img src={api.fileUrl(base.path)} alt="base" className="absolute inset-0 h-full w-full object-contain" /> : null}
        {sorted.map((l) => {
          const box = l.layer?.bboxAbs;
          if (!l.path || hidden.has(l.id)) return null;
          const style = box ? { left: `${(box[0] / W) * 100}%`, top: `${(box[1] / H) * 100}%`, width: `${((box[2] - box[0]) / W) * 100}%`, height: `${((box[3] - box[1]) / H) * 100}%` } : { inset: 0 };
          return <img key={l.id} src={api.fileUrl(l.path)} alt={l.layer?.name ?? ''} className="absolute object-fill" style={style} />;
        })}
      </div>
      <ul className="space-y-0.5 text-xs">
        {[base, ...sorted].map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <button type="button" onClick={() => setHidden((s) => (s.has(r.id) ? (s.delete(r.id), new Set(s)) : new Set(s).add(r.id)))}>
              {hidden.has(r.id) ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <span className="font-medium">{r.role === 'base' ? tx({ zh: '底图', en: 'Base' }) : (r.layer?.name ?? `#${r.index}`)}</span>
            <span className="truncate text-[var(--color-muted)]">{r.layer?.description}</span>
            {r.path ? (
              <a href={api.fileUrl(r.path, true)} className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)]">
                <Download size={12} />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MediaTile({ r, onUseAsRef }: { r: ResultRecord; onUseAsRef?: (r: ResultRecord) => void }) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  if (!r.path) return <div className="flex aspect-square items-center justify-center rounded-md bg-[var(--color-bg)] text-xs text-[var(--color-danger)]">{t('results.notSaved')}</div>;
  const url = api.fileUrl(r.path);
  return (
    <div className="group relative overflow-hidden rounded-md bg-[var(--color-bg)]">
      {r.kind === 'video' ? (
        broken ? (
          <div className="space-y-2 p-3 text-xs text-[var(--color-warn)]">
            <p>{t('results.cannotPlay')}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void api.reveal(r.path!, 'open')}>
                {t('results.openSystem')}
              </Button>
              <Button size="sm" onClick={() => void api.reveal(r.path!, 'reveal')}>
                {t('history.reveal')}
              </Button>
            </div>
          </div>
        ) : (
          <video src={url} controls preload="metadata" className="w-full" onError={() => setBroken(true)} />
        )
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" className="w-full object-contain" loading="lazy" />
        </a>
      )}
      <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
        {onUseAsRef && r.kind === 'image' ? (
          <Button size="sm" title={t('results.useAsRef')} onClick={() => onUseAsRef(r)}>
            <ImagePlus size={12} />
          </Button>
        ) : null}
        <a href={api.fileUrl(r.path, true)} className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-0.5 text-xs">
          <Download size={12} />
        </a>
      </div>
      <div className="px-1.5 py-1 text-[11px] text-[var(--color-muted)]">
        {r.width && r.height ? `${r.width}×${r.height}` : ''} {r.role !== 'image' && r.role !== 'video' ? `· ${r.role}` : ''}
      </div>
    </div>
  );
}

/** 一个任务的结果：图片网格 / 图层查看器 / 视频，附复用参数 */
export function TaskResult({ task, compact = false }: { task: TaskRecord; compact?: boolean }) {
  const { t } = useTranslation();
  const tx = useText();
  const loadForm = useStudio((s) => s.loadForm);
  const addAssets = useStudio((s) => s.addAssets);
  const model = getModel(task.modelId)?.model;
  const base = task.results.find((r) => r.role === 'base');
  const layers = task.results.filter((r) => r.role === 'layer');
  const media = task.results.filter((r) => r.role !== 'base' && r.role !== 'layer');

  const useAsRef = (r: ResultRecord) => {
    const state = useStudio.getState();
    const current = state.modelId ? getModel(state.modelId) : undefined;
    const draft = state.modelId ? state.drafts[state.modelId] : undefined;
    const mode = current?.model.modes.find((m) => m.id === draft?.modeId) ?? current?.model.modes[0];
    const slot = mode?.slots.find((s) => s.kind === 'image' && s.sources.includes('task-output'));
    if (!slot) return;
    addAssets(slot.id, [
      {
        id: crypto.randomUUID(),
        source: { type: 'task-output', taskId: task.id, index: r.index, ...(r.remoteUrl ? { remoteUrl: r.remoteUrl } : {}), ...(r.remoteExpiresAt ? { remoteExpiresAt: r.remoteExpiresAt } : {}), ...(r.path ? { localPath: r.path } : {}), ...(r.mime ? { mime: r.mime } : {}) },
        meta: { kind: 'image', ...(r.mime ? { mime: r.mime } : {}), ...(r.bytes ? { bytes: r.bytes } : {}), ...(r.width ? { width: r.width } : {}), ...(r.height ? { height: r.height } : {}) },
      },
    ]);
  };

  return (
    <div className="space-y-2" data-testid={`task-${task.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={task.status} />
        <span className="font-medium">{model ? tx(model.label) : task.modelId}</span>
        <span className="text-xs text-[var(--color-muted)]">{new Date(task.createdAt).toLocaleString()}</span>
        {task.origin === 'mcp' ? <Badge tone="accent">MCP</Badge> : null}
        {task.costEstimate ? <span className="text-xs text-[var(--color-muted)]">≈${task.costEstimate.amount.toFixed(4)}</span> : null}
        {task.kind === 'async' && ['queued', 'running', 'unknown', 'submit_unknown'].includes(task.status) ? (
          <Button size="sm" variant="ghost" className="ml-auto" title={t('results.refresh')} onClick={() => void api.refreshTask(task.id)}>
            <RefreshCw size={12} />
          </Button>
        ) : null}
        {task.kind === 'async' && task.status === 'queued' ? (
          <Button size="sm" variant="ghost" title={t('results.cancel')} onClick={() => void api.cancelTask(task.id)}>
            <Ban size={12} />
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className={task.kind === 'async' && ['queued', 'running', 'unknown', 'submit_unknown'].includes(task.status) ? '' : 'ml-auto'} title={t('results.reuse')} onClick={() => loadForm(task.form)}>
          <RotateCcw size={12} />
          {compact ? null : t('results.reuse')}
        </Button>
      </div>
      {task.error ? (
        <div className="rounded-md bg-[var(--color-danger)]/10 px-2 py-1 text-sm text-[var(--color-danger)]">
          <div>
            {task.error.code}：{task.error.message}
          </div>
          {task.error.hint ? <div className="text-xs">{tx(task.error.hint)}</div> : null}
          {task.error.requestId ? <div className="text-xs opacity-75">request id: {task.error.requestId}</div> : null}
        </div>
      ) : null}
      {task.kind === 'async' && (task.status === 'queued' || task.status === 'running') ? (
        <p className="text-xs text-[var(--color-muted)]">
          {t('results.polling')}
          {task.upstreamTaskId ? ` · ${task.upstreamTaskId}` : ''}
        </p>
      ) : null}
      {task.failures.length ? <p className="text-xs text-[var(--color-warn)]">{t('results.failures', { n: task.failures.length })}</p> : null}
      {base ? <LayerViewer base={base} layers={layers} /> : null}
      {media.length ? (
        <div className={clsx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')}>
          {media.map((r) => (
            <MediaTile key={r.id} r={r} onUseAsRef={useAsRef} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
