import clsx from 'clsx';
import { ArrowDown, ArrowUp, AtSign, Link2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssetRef, EvaluatedForm, SlotDef } from '../../../shared/catalog/types';
import { formatBytes } from '../../../shared/engine/media';
import { useText } from '../../i18n/useText';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { Badge, Button, inputClass } from '../../ui/primitives';

const ACCEPT: Record<string, string> = { jpeg: 'image/jpeg,.jpg,.jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff,.tif,.tiff', gif: 'image/gif', heic: '.heic', heif: '.heif', mp4: 'video/mp4', mov: 'video/quicktime,.mov', wav: 'audio/wav,.wav', mp3: 'audio/mpeg,.mp3' };

function thumbSrc(a: AssetRef): string | null {
  const s = a.source;
  if (s.type === 'local') return api.assetUrl(s.assetId);
  if (s.type === 'url') return s.url;
  if (s.type === 'task-output' && s.localPath) return api.fileUrl(s.localPath);
  return null;
}

function label(a: AssetRef): string {
  const s = a.source;
  if (s.type === 'local') return s.filename ?? s.assetId.slice(0, 8);
  if (s.type === 'url') return s.url;
  if (s.type === 'task-output') return `task ${s.taskId.slice(0, 8)} #${s.index}`;
  return s.uri;
}

function AssetItem({ a, slot, index, count, issues, onInsertRef }: { a: AssetRef; slot: SlotDef; index: number; count: number; issues: string[]; onInsertRef?: ((id: string) => void) | undefined }) {
  const { t } = useTranslation();
  const { moveAsset, removeAsset } = useStudio.getState();
  const src = thumbSrc(a);
  const m = a.meta;
  return (
    <li className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-1.5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--color-bg)] text-[10px] text-[var(--color-muted)]">
        {src && slot.kind === 'image' ? <img src={src} alt="" className="h-full w-full object-cover" /> : slot.kind}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate" title={label(a)}>
          {label(a)}
        </div>
        <div className="text-[var(--color-muted)]">
          {m?.width && m.height ? `${m.width}×${m.height}` : ''}
          {m?.bytes ? ` · ${formatBytes(m.bytes)}` : ''}
          {m?.durationSec ? ` · ${m.durationSec.toFixed(1)}s` : ''}
          {m?.hasAlpha ? ' · alpha' : ''}
        </div>
        {issues.map((msg) => (
          <div key={msg} className="text-[var(--color-danger)]">
            {msg}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onInsertRef ? (
          <Button size="sm" variant="ghost" title={t('assets.insertRef')} onClick={() => onInsertRef(a.id)}>
            <AtSign size={12} />
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => moveAsset(slot.id, a.id, -1)}>
          <ArrowUp size={12} />
        </Button>
        <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => moveAsset(slot.id, a.id, 1)}>
          <ArrowDown size={12} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => removeAsset(slot.id, a.id)}>
          <X size={12} />
        </Button>
      </div>
    </li>
  );
}

function SlotBox({ slot, evaluated, onInsertRef }: { slot: SlotDef; evaluated: EvaluatedForm; onInsertRef?: ((id: string) => void) | undefined }) {
  const { t } = useTranslation();
  const tx = useText();
  const addAssets = useStudio((s) => s.addAssets);
  const items = evaluated.ctx.input.slots[slot.id] ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const full = items.length >= slot.max;
  const slotIssues = evaluated.issues.filter((i) => i.slots?.includes(slot.id) && !i.id.startsWith('asset:'));
  const itemIssues = (i: number) => evaluated.issues.filter((x) => x.id === `asset:${slot.id}:${i}` && x.severity === 'error').map((x) => tx(x.message));

  const upload = async (files: FileList | File[]) => {
    setErr(null);
    setBusy(true);
    try {
      const room = slot.max - items.length;
      const list = [...files].slice(0, Math.max(0, room));
      const refs: AssetRef[] = [];
      for (const f of list) {
        const up = await api.uploadAsset(f);
        refs.push({ id: crypto.randomUUID(), source: { type: 'local', assetId: up.id, mime: up.mime, bytes: up.bytes, ...(up.filename ? { filename: up.filename } : {}), sha256: up.sha256 }, meta: up.meta ?? { kind: slot.kind, mime: up.mime, bytes: up.bytes } });
      }
      if (refs.length) addAssets(slot.id, refs);
      if (files.length > list.length) setErr(t('assets.tooMany', { max: slot.max }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addUrl = () => {
    const v = url.trim();
    if (!v) return;
    const isAsset = v.startsWith('asset://');
    if (isAsset && !slot.sources.includes('provider-asset')) return setErr(t('assets.assetNotAllowed'));
    if (!isAsset && !/^https:\/\//i.test(v)) return setErr(t('assets.httpsOnly'));
    addAssets(slot.id, [{ id: crypto.randomUUID(), source: isAsset ? { type: 'provider-asset', uri: v } : { type: 'url', url: v }, meta: { kind: slot.kind } }]);
    setUrl('');
    setErr(null);
  };

  return (
    <div
      className={clsx('space-y-2 rounded-md border border-dashed p-2', drag ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)]')}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (slot.sources.includes('local') && e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{tx(slot.label)}</span>
        {slot.role ? <code className="text-[11px] text-[var(--color-muted)]">{slot.role}</code> : null}
        <Badge>{`${items.length}/${slot.max}${slot.min ? ` · ≥${slot.min}` : ''}`}</Badge>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          {slot.spec.formats.join('/')} · ≤{formatBytes(slot.spec.maxBytes)}
        </span>
      </div>
      {slot.help ? <p className="text-xs text-[var(--color-muted)]">{tx(slot.help)}</p> : null}
      {items.length ? (
        <ul className="space-y-1">
          {items.map((a, i) => (
            <AssetItem key={a.id} a={a} slot={slot} index={i} count={items.length} issues={itemIssues(i)} onInsertRef={onInsertRef} />
          ))}
        </ul>
      ) : null}
      {!full ? (
        <div className="flex flex-wrap items-center gap-2">
          {slot.sources.includes('local') ? (
            <>
              <input ref={fileRef} type="file" hidden multiple={slot.max > 1} accept={slot.spec.formats.map((f) => ACCEPT[f] ?? `.${f}`).join(',')} onChange={(e) => e.target.files && void upload(e.target.files).then(() => ((e.target as HTMLInputElement).value = ''))} />
              <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={12} />
                {busy ? t('assets.uploading') : t('assets.local')}
              </Button>
            </>
          ) : null}
          {slot.sources.includes('url') || slot.sources.includes('provider-asset') ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input className={clsx(inputClass, 'min-w-0 flex-1 text-xs')} placeholder={slot.sources.includes('provider-asset') ? 'https://… / asset://…' : 'https://…'} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
              <Button size="sm" onClick={addUrl}>
                <Link2 size={12} />
                {t('assets.addUrl')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {err ? <p className="text-xs text-[var(--color-danger)]">{err}</p> : null}
      {slotIssues.map((i) => (
        <p key={i.id} className={clsx('text-xs', i.severity === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-warn)]')}>
          {tx(i.message)}
        </p>
      ))}
    </div>
  );
}

export function SlotList({ evaluated, onInsertRef }: { evaluated: EvaluatedForm; onInsertRef?: (id: string) => void }) {
  const slots = evaluated.ctx.mode.slots;
  if (!slots.length) return null;
  return (
    <div className="space-y-2">
      {slots.map((s) => (
        <SlotBox key={s.id} slot={s} evaluated={evaluated} onInsertRef={onInsertRef} />
      ))}
    </div>
  );
}
