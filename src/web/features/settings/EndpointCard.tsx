import clsx from 'clsx';
import { ExternalLink, Pencil, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ARK_CONSOLE_ENDPOINTS_URL, type ControlCredentialStatus, type EndpointCreateInput, type EndpointCreatePlan, type EndpointInfo } from '../../../shared/api-contract';
import { getModel, listModels } from '../../../shared/providers/registry';
import { useText } from '../../i18n/useText';
import { api, ApiRequestError } from '../../lib/api-client';
import { Badge, Button, inputClass, Switch } from '../../ui/primitives';

const errText = (e: unknown) => (e instanceof ApiRequestError ? `${e.code}：${e.message}` : e instanceof Error ? e.message : String(e));

/** 有中间状态时每隔这么久刷新一次，最多刷新这么多次（约 2 分钟） */
const POLL_MS = 3000;
const MAX_POLLS = 40;

/** 状态是否还在变化（需要轮询） */
const transient = (s: string) => /^(Scheduling|Creating|Starting|Stopping|Updating|Deleting)$/i.test(s);

export function statusTone(s: string): 'ok' | 'warn' | 'danger' | 'muted' {
  if (/^(Running|Healthy)$/i.test(s)) return 'ok';
  if (/^(Abnormal|Failed|Error)$/i.test(s)) return 'danger';
  if (transient(s)) return 'warn';
  return 'muted';
}

/** 设置页：BytePlus 推理接入点（Endpoint）管理，走控制面 AK/SK */
export function EndpointCard() {
  const { t } = useTranslation();
  const [creds, setCreds] = useState<ControlCredentialStatus | null>(null);
  useEffect(() => {
    api.controlCredentials().then(setCreds).catch(() => setCreds(null));
  }, []);
  return (
    <div className="space-y-3" id="endpoints">
      <p className="text-sm text-[var(--color-muted)]">{t('endpoint.hint')}</p>
      <CredentialForm status={creds} onChange={setCreds} />
      {creds?.configured ? <EndpointManager key={`${creds.source}:${creds.maskedAccessKeyId ?? ''}:${creds.updatedAt ?? ''}`} /> : null}
    </div>
  );
}

function CredentialForm({ status, onChange }: { status: ControlCredentialStatus | null; onChange: (s: ControlCredentialStatus) => void }) {
  const { t } = useTranslation();
  const [ak, setAk] = useState('');
  const [sk, setSk] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(t('error.generic', { message: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4" data-testid="control-credentials">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{t('endpoint.credentials')}</span>
        <span className="text-sm text-[var(--color-muted)]">{status?.configured ? `${t('settings.configured')} · ${status.maskedAccessKeyId ?? ''}` : t('settings.notConfigured')}</span>
      </div>
      {status?.source === 'env' ? (
        <p className="text-sm text-[var(--color-muted)]">{t('endpoint.fromEnv')}</p>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (ak.trim() && sk.trim())
              void run(async () => {
                onChange(await api.setControlCredentials(ak, sk));
                setAk('');
                setSk('');
                return t('settings.saved');
              });
          }}
        >
          <input className={inputClass} autoComplete="off" spellCheck={false} placeholder="AccessKey ID" aria-label="AccessKey ID" value={ak} onChange={(e) => setAk(e.target.value)} />
          <input className={inputClass} type="password" autoComplete="off" spellCheck={false} placeholder="Secret Access Key" aria-label="Secret Access Key" value={sk} onChange={(e) => setSk(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || !ak.trim() || !sk.trim()}>
            {t('settings.save')}
          </Button>
          <Button disabled={busy || !status?.configured} onClick={() => void run(async () => (onChange(await api.clearControlCredentials()), t('settings.cleared')))}>
            {t('settings.clear')}
          </Button>
        </form>
      )}
      {status?.configured ? (
        <Button size="sm" className="mt-2" disabled={busy} onClick={() => void run(async () => t('endpoint.testOk', { n: (await api.testControlCredentials()).total ?? '?' }))}>
          {t('endpoint.test')}
        </Button>
      ) : null}
      {message ? <p className="mt-2 text-sm text-[var(--color-muted)]">{message}</p> : null}
    </div>
  );
}

function EndpointManager() {
  const { t } = useTranslation();
  const tx = useText();
  const [items, setItems] = useState<EndpointInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 状态只在请求返回后写入（effect 里不同步 setState）；手动刷新时由点击处先置 loading。
  // 每次加载编号，只采用最新一次的结果，避免乱序返回时旧状态覆盖新状态
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    return api
      .listEndpoints({ refresh: true })
      .then((list) => {
        if (id !== seq.current) return;
        setItems(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (id === seq.current) setError(errText(e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, []);
  const reload = () => {
    setLoading(true);
    void load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  // 有中间状态时轮询：上一次返回后再排下一次（items 每次更新都会重新调度），最多 MAX_POLLS 次
  const changing = items?.some((e) => transient(e.status)) ?? false;
  const polls = useRef(0);
  useEffect(() => {
    if (!changing) {
      polls.current = 0;
      return;
    }
    if (polls.current >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [changing, items, load]);

  return (
    <div className="space-y-3">
      <CreateEndpointForm onCreated={reload} />
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <span className="font-medium">{t('endpoint.list')}</span>
          <a className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)]" href={ARK_CONSOLE_ENDPOINTS_URL} target="_blank" rel="noreferrer">
            {t('endpoint.console')} <ExternalLink size={12} />
          </a>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={reload} aria-label={t('endpoint.refresh')} title={t('endpoint.refresh')}>
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
          </Button>
        </div>
        {error ? <p className="px-3 py-2 text-sm text-[var(--color-danger)]">{t('error.generic', { message: error })}</p> : null}
        {items && items.length === 0 ? <p className="px-3 py-3 text-sm text-[var(--color-muted)]">{t('endpoint.empty')}</p> : null}
        <ul className="divide-y divide-[var(--color-border)]">
          {items?.map((e) => (
            <EndpointRow key={e.id} e={e} modelLabel={e.modelId ? tx(getModel(e.modelId)?.model.label) : null} onChanged={reload} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function EndpointRow({ e, modelLabel, onChanged }: { e: EndpointInfo; modelLabel: string | null; onChanged: () => void }) {
  const { t } = useTranslation();
  const tx = useText();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 成功与否都刷新列表：失败时上游状态也可能已经变了（例如停止成功但删除失败）
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setMessage(t('error.generic', { message: errText(err) }));
      return false;
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const stopped = /^stopped$/i.test(e.status);
  // 中间状态（调度中等）下不允许操作
  const locked = busy || transient(e.status);
  const fm = e.foundationModel ? `${e.foundationModel.name}-${e.foundationModel.version}` : (e.customModelId ?? '—');

  return (
    <li className="space-y-1 px-3 py-2 text-sm" data-testid={`endpoint-${e.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{e.name}</span>
        <code className="text-xs text-[var(--color-muted)]">{e.id}</code>
        <Badge tone={statusTone(e.status)}>{t(`endpoint.status.${e.status}`, { defaultValue: e.status })}</Badge>
        <Badge tone={e.contentFilter === 'off' ? 'warn' : 'muted'}>{t(`endpoint.filter.${e.contentFilter}`)}</Badge>
        <span className="ml-auto flex gap-1">
          {stopped ? (
            <Button size="sm" variant="ghost" disabled={locked} title={t('endpoint.start')} aria-label={t('endpoint.start')} onClick={() => void act(() => api.startEndpoint(e.id))}>
              <Play size={12} />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={locked} title={t('endpoint.stop')} aria-label={t('endpoint.stop')} onClick={() => (setConfirmDelete(false), setConfirmStop(true))}>
              <Square size={12} />
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} title={t('endpoint.edit')} aria-label={t('endpoint.edit')} onClick={() => setEditing(!editing)}>
            <Pencil size={12} />
          </Button>
          <Button size="sm" variant="ghost" disabled={locked} title={t('endpoint.delete')} aria-label={t('endpoint.delete')} onClick={() => (setConfirmStop(false), setConfirmDelete(true))}>
            <Trash2 size={12} />
          </Button>
        </span>
      </div>
      <div className="text-xs text-[var(--color-muted)]">
        {modelLabel ? `${modelLabel} · ` : ''}
        <code>{fm}</code>
        {e.rateLimit && e.rateLimit.rpm > 0 ? ` · ${t('endpoint.rateLimitValue', { rpm: e.rateLimit.rpm, tpm: e.rateLimit.tpm })}` : ''}
        {e.statusReason ? ` · ${e.statusReason}` : ''}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--color-muted)]">{t('endpoint.contentFilter')}</span>
        <Switch
          checked={e.contentFilter !== 'off'}
          disabled={locked || e.contentFilter === 'unknown'}
          label={t('endpoint.filterToggle', { name: e.name })}
          onChange={(on) =>
            void act(async () => {
              const r = await api.updateEndpoint(e.id, { contentFilter: on });
              if (r.warnings.length) setMessage(r.warnings.map(tx).join(' '));
            })
          }
        />
        <span className="text-[var(--color-muted)]">{t('endpoint.filterEditHint')}</span>
      </div>
      {editing ? <EditForm e={e} onDone={() => (setEditing(false), onChanged())} /> : null}
      {confirmStop ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--color-warn)]/10 px-2 py-1" role="alertdialog" aria-label={t('endpoint.stopConfirm', { name: e.name, id: e.id })}>
          <span>{t('endpoint.stopConfirm', { name: e.name, id: e.id })}</span>
          <Button size="sm" variant="primary" disabled={locked} onClick={() => void act(() => api.stopEndpoint(e.id)).then((ok) => ok && setConfirmStop(false))}>
            {t('endpoint.stopYes')}
          </Button>
          <Button size="sm" onClick={() => setConfirmStop(false)}>
            {t('endpoint.cancel')}
          </Button>
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--color-danger)]/10 px-2 py-1" role="alertdialog" aria-label={t('endpoint.deleteConfirm', { name: e.name, id: e.id })}>
          <span>{t('endpoint.deleteConfirm', { name: e.name, id: e.id })}</span>
          <Button
            size="sm"
            variant="danger"
            disabled={locked}
            onClick={() => {
              setDeleting(true);
              void act(() => api.deleteEndpoint(e.id)).then((ok) => {
                setDeleting(false);
                if (ok) setConfirmDelete(false);
              });
            }}
          >
            {t('endpoint.deleteYes')}
          </Button>
          {deleting ? <span className="text-xs text-[var(--color-muted)]">{t('endpoint.deleting')}</span> : null}
          <Button size="sm" onClick={() => setConfirmDelete(false)}>
            {t('endpoint.cancel')}
          </Button>
        </div>
      ) : null}
      {message ? <p className="text-xs text-[var(--color-danger)]">{message}</p> : null}
    </li>
  );
}

function RateLimitInputs({ rpm, tpm, onChange }: { rpm: string; tpm: string; onChange: (rpm: string, tpm: string) => void }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1 text-xs">
      <input className={clsx(inputClass, 'w-20')} inputMode="numeric" placeholder="RPM" aria-label="RPM" value={rpm} onChange={(e) => onChange(e.target.value, tpm)} />
      <input className={clsx(inputClass, 'w-24')} inputMode="numeric" placeholder="TPM" aria-label="TPM" value={tpm} onChange={(e) => onChange(rpm, e.target.value)} />
      <span className="text-[var(--color-muted)]">{t('endpoint.rateLimitHint')}</span>
    </span>
  );
}

/** 两个都填才算设置限流；只填一个视为输入错误 */
function parseRateLimit(rpm: string, tpm: string): { rpm: number; tpm: number } | undefined | 'invalid' {
  if (!rpm.trim() && !tpm.trim()) return undefined;
  const r = Number(rpm);
  const tk = Number(tpm);
  return Number.isInteger(r) && Number.isInteger(tk) && r > 0 && tk > 0 ? { rpm: r, tpm: tk } : 'invalid';
}

function EditForm({ e, onDone }: { e: EndpointInfo; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(e.name);
  const [description, setDescription] = useState(e.description);
  const [rpm, setRpm] = useState(e.rateLimit && e.rateLimit.rpm > 0 ? String(e.rateLimit.rpm) : '');
  const [tpm, setTpm] = useState(e.rateLimit && e.rateLimit.tpm > 0 ? String(e.rateLimit.tpm) : '');
  const [message, setMessage] = useState<string | null>(null);
  const save = async () => {
    const rl = parseRateLimit(rpm, tpm);
    if (rl === 'invalid') return setMessage(t('endpoint.rateLimitInvalid'));
    try {
      await api.updateEndpoint(e.id, { ...(name !== e.name ? { name } : {}), ...(description !== e.description ? { description } : {}), ...(rl ? { rateLimit: rl } : {}) });
      onDone();
    } catch (err) {
      setMessage(t('error.generic', { message: errText(err) }));
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-2">
      <input className={clsx(inputClass, 'w-full')} aria-label={t('endpoint.name')} value={name} onChange={(x) => setName(x.target.value)} />
      <input className={clsx(inputClass, 'w-full')} aria-label={t('endpoint.description')} placeholder={t('endpoint.description')} value={description} onChange={(x) => setDescription(x.target.value)} />
      <RateLimitInputs rpm={rpm} tpm={tpm} onChange={(a, b) => (setRpm(a), setTpm(b))} />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void save()}>
          {t('settings.save')}
        </Button>
        <Button size="sm" onClick={onDone}>
          {t('endpoint.cancel')}
        </Button>
      </div>
      {message ? <p className="text-xs text-[var(--color-danger)]">{message}</p> : null}
    </div>
  );
}

function CreateEndpointForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const tx = useText();
  const models = useMemo(() => listModels().filter((x) => x.provider.id === 'byteplus').map((x) => x.model), []);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [contentFilter, setContentFilter] = useState(true);
  const [rpm, setRpm] = useState('');
  const [tpm, setTpm] = useState('');
  // 预检结果连同当时的输入快照一起存：创建时提交的就是预检过的那一份
  const [plan, setPlan] = useState<{ result: EndpointCreatePlan; input: EndpointCreateInput } | null>(null);
  const planSeq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 任何输入变化都让预检结果失效，必须重新预检再创建
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPlan(null);
    planSeq.current += 1;
  };
  const input = (): EndpointCreateInput => {
    const rl = parseRateLimit(rpm, tpm);
    if (rl === 'invalid') throw new Error(t('endpoint.rateLimitInvalid'));
    return { modelId, name, ...(description ? { description } : {}), contentFilter, ...(rl ? { rateLimit: rl } : {}) };
  };
  const doPlan = async () => {
    setBusy(true);
    setMessage(null);
    const id = ++planSeq.current;
    try {
      const snapshot = input();
      const result = await api.planEndpoint(snapshot);
      // 预检期间输入变过（理论上已禁用，双保险）就丢弃这次结果
      if (id === planSeq.current) setPlan({ result, input: snapshot });
    } catch (e) {
      setMessage(t('error.generic', { message: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const doCreate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!plan) return;
      const r = await api.createEndpoint(plan.input);
      setMessage([t('endpoint.created', { id: r.id }), ...r.warnings.map(tx)].join(' '));
      setPlan(null);
      setName('');
      onCreated();
    } catch (e) {
      setMessage(t('error.generic', { message: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="endpoint-create-open">
        {t('endpoint.create')}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-sm" data-testid="endpoint-create">
      <div className="font-medium">{t('endpoint.create')}</div>
      {/* 预检 / 创建进行中锁住全部输入，保证提交的就是预检过的那一份 */}
      <fieldset disabled={busy} className="space-y-2">
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[var(--color-muted)]">{t('endpoint.model')}</span>
          <select className={inputClass} aria-label={t('endpoint.model')} value={modelId} onChange={(e) => touch(setModelId)(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {tx(m.label)}（{m.apiModel}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[var(--color-muted)]">{t('endpoint.name')}</span>
          <input className={clsx(inputClass, 'flex-1')} aria-label={t('endpoint.name')} value={name} onChange={(e) => touch(setName)(e.target.value)} />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[var(--color-muted)]">{t('endpoint.description')}</span>
          <input className={clsx(inputClass, 'flex-1')} aria-label={t('endpoint.description')} value={description} onChange={(e) => touch(setDescription)(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[var(--color-muted)]">{t('endpoint.contentFilter')}</span>
          <Switch checked={contentFilter} onChange={touch(setContentFilter)} label={t('endpoint.contentFilter')} />
          <span className="text-xs text-[var(--color-muted)]">{contentFilter ? t('endpoint.filterOnHint') : t('endpoint.filterOffHint')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-[var(--color-muted)]">{t('endpoint.rateLimit')}</span>
          <RateLimitInputs rpm={rpm} tpm={tpm} onChange={(a, b) => (touch(setRpm)(a), touch(setTpm)(b))} />
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button disabled={busy || !name.trim()} onClick={() => void doPlan()}>
          {t('endpoint.plan')}
        </Button>
        <Button variant="primary" disabled={busy || !plan?.result.dryRun.ok} onClick={() => void doCreate()} data-testid="endpoint-create-confirm">
          {t('endpoint.confirmCreate')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('endpoint.cancel')}
        </Button>
      </div>
      {plan ? (
        <div className="space-y-1 rounded-md bg-[var(--color-bg)] p-2 text-xs" data-testid="endpoint-plan">
          <div>{plan.result.dryRun.ok ? t('endpoint.planOk') : t('endpoint.planFail', { code: plan.result.dryRun.code, message: plan.result.dryRun.message })}</div>
          {plan.result.notes.map((n) => (
            <div key={n.en} className="text-[var(--color-muted)]">
              {tx(n)}
            </div>
          ))}
          <pre className="overflow-x-auto font-mono">{JSON.stringify(plan.result.request, null, 2)}</pre>
        </div>
      ) : null}
      {message ? <p className="text-xs text-[var(--color-muted)]">{message}</p> : null}
    </div>
  );
}
