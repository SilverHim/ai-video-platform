import clsx from 'clsx';
import { Loader2, RotateCcw, Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Issue } from '../../../shared/catalog/types';
import { computeRefOrder, countPrompt } from '../../../shared/engine/refs';
import { useCurrentForm, usePreview } from '../../hooks/useForm';
import { useText } from '../../i18n/useText';
import { api, ApiRequestError } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { useTasks } from '../../stores/tasks';
import { Badge, Button, inputClass, Panel, Segmented } from '../../ui/primitives';
import { ConsentDialog } from '../assets/ConsentDialog';
import { SlotList } from '../assets/SlotList';
import { ParamRenderer } from '../params/ParamRenderer';
import { RequestPreview } from '../preview/RequestPreview';
import { PromptEditor, type PromptEditorHandle } from '../prompt/PromptEditor';
import { TaskQueue } from '../queue/TaskQueue';
import { TaskResult } from '../results/ResultView';
import { IssuesPanel } from './IssuesPanel';
import { ModelBar } from './ModelBar';
import { PresetBar } from './PresetBar';

type RightTab = 'preview' | 'result' | 'queue';

export function StudioPage() {
  const { t } = useTranslation();
  const tx = useText();
  const { form, evaluated } = useCurrentForm();
  const { selectMode, setValue, setPrompt, resetModel, setModelOverride, tempHost, setTempHost, clearDerived } = useStudio();
  const { preview, loading, error } = usePreview(form, tempHost);
  const [consentOpen, setConsentOpen] = useState(false);
  const editor = useRef<PromptEditorHandle>(null);
  const [tab, setTab] = useState<RightTab>('preview');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitIssues, setSubmitIssues] = useState<Issue[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const task = useTasks((s) => (selectedTask ? s.byId[selectedTask] : undefined));

  const refs = useMemo(() => {
    if (!evaluated || evaluated.ctx.mode.prompt.refs === false) return [];
    const order = computeRefOrder(evaluated.ctx.mode, evaluated.ctx.input.slots);
    const labelOf = evaluated.ctx.mode.prompt.refLabel ?? ((k: string, n: number) => `${k === 'image' ? 'Image' : k === 'video' ? 'Video' : 'Audio'} ${n}`);
    return Object.entries(order).map(([id, info]) => ({ id, label: labelOf(info.kind, info.n), detail: info.slotId }));
  }, [evaluated]);

  if (!form || !evaluated) {
    return (
      <div className="space-y-3">
        <ModelBar />
        <p className="text-sm text-[var(--color-muted)]">{t('studio.pickModel')}</p>
      </div>
    );
  }

  const { model, mode } = evaluated.ctx;
  const userModes = model.modes.filter((m) => m.entry !== 'derived');
  const counted = countPrompt(form.prompt.replace(/\{\{ref:[^}]+\}\}/g, ' Image 1 '));
  const issues = [...evaluated.issues, ...(preview?.issues.filter((i) => i.id.startsWith('guard:') || i.id === 'body:too-large') ?? [])];
  const canSubmit = evaluated.canSubmit && (preview ? preview.canSubmit : true) && !submitting;

  const submit = async (consent = false) => {
    if (!consent && preview?.uploads.required) {
      setConsentOpen(true);
      return;
    }
    setConsentOpen(false);
    const opts = { tempHost, ...(consent ? { consent: true } : {}) };
    setSubmitting(true);
    setSubmitIssues([]);
    setSubmitError(null);
    setTab('result');
    try {
      if (evaluated.effective.stream === true) {
        await api.submitStream(form, { onTask: (id) => setSelectedTask(id), onError: (e) => setSubmitError('message' in e ? e.message : String(e)) }, opts);
      } else {
        const done = await api.submit(form, opts);
        useTasks.getState().upsert(done);
        setSelectedTask(done.id);
      }
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setSubmitIssues(e.issues);
        setSubmitError(e.i18n ? tx(e.i18n) : e.message);
      } else setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <ModelBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-3 lg:overflow-y-auto lg:pr-1">
          <Panel
            title={
              <span className="flex items-center gap-2">
                {tx(model.label)} <code className="text-xs text-[var(--color-muted)]">{model.apiModel}</code>
              </span>
            }
            actions={
              <Button size="sm" variant="ghost" onClick={resetModel} title={t('studio.reset')}>
                <RotateCcw size={12} />
              </Button>
            }
          >
            <div className="space-y-3">
              {model.description ? <p className="text-xs text-[var(--color-muted)]">{tx(model.description)}</p> : null}
              {userModes.length > 1 ? (
                <Segmented
                  value={mode.id}
                  onChange={selectMode}
                  options={userModes.map((m) => ({ value: m.id, label: <span className="inline-flex items-center gap-1">{tx(m.label)}{m.experimental ? <Badge tone="warn">{t('params.experimental')}</Badge> : null}</span>, title: m.hint ? tx(m.hint) : m.id }))}
                />
              ) : null}
              {form.derivedFrom ? (
                <div className="flex items-center gap-2 rounded-md bg-[var(--color-accent)]/10 px-2 py-1 text-sm" data-testid="derived-banner">
                  <span>
                    {t(`studio.derived.${form.derivedFrom.relation}`)} · <code className="text-xs">{form.derivedFrom.upstreamTaskId}</code>
                  </span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={clearDerived}>
                    {t('studio.derived.clear')}
                  </Button>
                </div>
              ) : null}
              {mode.hint ? <p className="text-xs text-[var(--color-muted)]">{tx(mode.hint)}</p> : null}
              <PresetBar form={form} onInsertText={(text) => setPrompt(form.prompt ? `${form.prompt}\n${text}` : text)} />

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{t('studio.prompt')}</span>
                  {mode.prompt.required === true ? <Badge>{t('studio.required')}</Badge> : null}
                  <span className="ml-auto text-xs text-[var(--color-muted)]">
                    {counted.chars}
                    {mode.prompt.maxChars ? ` / ${mode.prompt.maxChars}` : ''} · {counted.zhChars} 字 · {counted.enWords} words
                  </span>
                </div>
                <PromptEditor ref={editor} value={form.prompt} onChange={setPrompt} refs={refs} placeholder={t('studio.promptPlaceholder')} />
                {mode.prompt.hint ? <p className="text-xs text-[var(--color-muted)]">{tx(mode.prompt.hint)}</p> : null}
              </div>

              <SlotList evaluated={evaluated} {...(mode.prompt.refs === false ? {} : { onInsertRef: (id: string) => editor.current?.insertRef(id) })} />
            </div>
          </Panel>

          <Panel title={t('studio.params')}>
            <ParamRenderer evaluated={evaluated} onChange={setValue} />
            {model.allowModelOverride ? (
              <div className="mt-4 space-y-1">
                <div className="text-sm font-medium">{t('studio.modelOverride')}</div>
                <input className={clsx(inputClass, 'w-full font-mono text-xs')} placeholder="ep-xxxxxxxx" value={form.modelOverride ?? ''} onChange={(e) => setModelOverride(e.target.value.trim())} />
                <p className="text-xs text-[var(--color-muted)]">{t('studio.modelOverrideHint')}</p>
              </div>
            ) : null}
          </Panel>

          <div className="space-y-2">
            <IssuesPanel issues={[...issues, ...submitIssues]} />
            {submitError ? <p className="text-sm text-[var(--color-danger)]">{submitError}</p> : null}
            <div className="flex items-center gap-3">
              <Button variant="primary" disabled={!canSubmit} onClick={() => void submit(false)} data-testid="submit">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {submitting ? t('studio.submitting') : t('studio.submit')}
              </Button>
              {preview?.cost ? <span className="text-sm text-[var(--color-muted)]">≈ ${preview.cost.amount.toFixed(4)}</span> : null}
              {evaluated.effective.stream === true ? <Badge tone="accent">SSE</Badge> : null}
            </div>
          </div>
        </div>

        {consentOpen && preview?.uploads.required ? (
          <ConsentDialog info={preview.uploads} tempHost={tempHost} onTempHost={setTempHost} onCancel={() => setConsentOpen(false)} onConfirm={() => void submit(true)} />
        ) : null}
        <div className="space-y-3 lg:overflow-y-auto">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'preview', label: t('studio.tabPreview') },
              { value: 'result', label: t('studio.tabResult') },
              { value: 'queue', label: t('studio.tabQueue') },
            ]}
          />
          <Panel>
            {tab === 'preview' ? <RequestPreview preview={preview} loading={loading} error={error} /> : null}
            {tab === 'result' ? task ? <TaskResult task={task} /> : <p className="text-sm text-[var(--color-muted)]">{submitting ? '…' : t('studio.noResult')}</p> : null}
            {tab === 'queue' ? <TaskQueue selectedId={selectedTask} onSelect={(id) => (setSelectedTask(id), setTab('result'))} /> : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
