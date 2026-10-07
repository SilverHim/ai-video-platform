import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { getModel } from '../../../shared/providers/registry';
import type { PresetRecord, TemplateRecord } from '../../../shared/task/records';
import { useText } from '../../i18n/useText';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { Button, inputClass, Panel } from '../../ui/primitives';

export function LibraryPage() {
  const { t } = useTranslation();
  const tx = useText();
  const navigate = useNavigate();
  const loadForm = useStudio((s) => s.loadForm);
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const reload = () => {
    void api.listPresets().then(setPresets);
    void api.listTemplates().then(setTemplates);
  };
  useEffect(reload, []);

  return (
    <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
      <Panel title={t('library.presets')}>
        {presets.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{t('library.noPresets')}</p> : null}
        <ul className="space-y-1">
          {presets.map((p) => {
            const found = getModel(p.modelId);
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-[var(--color-bg)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-[var(--color-muted)]">
                    {found ? tx(found.model.label) : p.modelId} · {p.modeId}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!found}
                  onClick={() => {
                    if (!found) return;
                    loadForm({ providerId: found.provider.id, modelId: p.modelId, modeId: p.modeId, values: p.values, slots: {}, prompt: p.prompt ?? '' });
                    void navigate('/');
                  }}
                >
                  {t('library.apply')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void api.deletePreset(p.id).then(reload)}>
                  <Trash2 size={12} />
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-[var(--color-muted)]">{t('library.presetHint')}</p>
      </Panel>

      <Panel title={t('library.templates')}>
        <form
          className="mb-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !text.trim()) return;
            void api.saveTemplate({ name, text, tags: tags.split(/[,，\s]+/).filter(Boolean) }).then(() => {
              setName('');
              setText('');
              setTags('');
              reload();
            });
          }}
        >
          <input className={`${inputClass} w-full`} placeholder={t('library.templateName')} value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className={`${inputClass} w-full`} rows={3} placeholder={t('library.templateText')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <input className={`${inputClass} flex-1`} placeholder={t('library.templateTags')} value={tags} onChange={(e) => setTags(e.target.value)} />
            <Button type="submit" variant="primary">
              {t('library.add')}
            </Button>
          </div>
        </form>
        <ul className="space-y-1">
          {templates.map((tp) => (
            <li key={tp.id} className="rounded-md p-1.5 text-sm hover:bg-[var(--color-bg)]">
              <div className="flex items-center gap-2">
                <span className="font-medium">{tp.name}</span>
                {tp.tags.map((g) => (
                  <span key={g} className="text-xs text-[var(--color-muted)]">
                    #{g}
                  </span>
                ))}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void api.deleteTemplate(tp.id).then(reload)}>
                  <Trash2 size={12} />
                </Button>
              </div>
              <p className="line-clamp-2 text-xs text-[var(--color-muted)]">{tp.text}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
