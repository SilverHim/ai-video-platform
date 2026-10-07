import { BookmarkPlus, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FormInput } from '../../../shared/catalog/types';
import type { PresetRecord, TemplateRecord } from '../../../shared/task/records';
import { api } from '../../lib/api-client';
import { useStudio } from '../../stores/studio';
import { Button, inputClass } from '../../ui/primitives';

/** 工作台里的预设（存 / 套用）与模板插入 */
export function PresetBar({ form, onInsertText }: { form: FormInput; onInsertText: (text: string) => void }) {
  const { t } = useTranslation();
  const { patchValues, setPrompt, selectMode } = useStudio();
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const reload = () => {
    void api.listPresets(form.modelId).then(setPresets).catch(() => setPresets([]));
    void api.listTemplates().then(setTemplates).catch(() => setTemplates([]));
  };
  useEffect(reload, [form.modelId]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className={inputClass}
        value=""
        onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value);
          if (!p) return;
          selectMode(p.modeId);
          patchValues(p.values);
          if (p.prompt) setPrompt(p.prompt);
        }}
      >
        <option value="">{t('library.applyPreset', { n: presets.length })}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={() => {
          const name = prompt(t('library.presetName'));
          if (!name?.trim()) return;
          const withPrompt = confirm(t('library.includePrompt'));
          void api.savePreset({ name: name.trim(), modelId: form.modelId, modeId: form.modeId, values: form.values, prompt: withPrompt ? form.prompt : null }).then(reload);
        }}
      >
        <BookmarkPlus size={12} />
        {t('library.savePreset')}
      </Button>
      {templates.length ? (
        <select
          className={inputClass}
          value=""
          onChange={(e) => {
            const tp = templates.find((x) => x.id === e.target.value);
            if (!tp) return;
            let text = tp.text;
            for (const v of [...new Set([...text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]!))]) {
              if (v.startsWith('ref:')) continue;
              const val = window.prompt(t('library.fillVar', { v }));
              text = text.replaceAll(`{{${v}}}`, val ?? '');
            }
            onInsertText(text);
          }}
        >
          <option value="">{t('library.insertTemplate')}</option>
          {templates.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
          <FileText size={12} />
          {t('library.noTemplates')}
        </span>
      )}
    </div>
  );
}
