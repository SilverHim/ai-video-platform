import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvaluatedForm, FormInput } from '../../shared/catalog/types';
import { evaluate } from '../../shared/engine/evaluate';
import { getModel } from '../../shared/providers/registry';
import { api, type PreviewResponse } from '../lib/api-client';
import { currentForm, useStudio } from '../stores/studio';

/** 当前表单 + 本地即时求值（渲染表单用） */
export function useCurrentForm(): { form: FormInput | null; evaluated: EvaluatedForm | null } {
  const modelId = useStudio((s) => s.modelId);
  const drafts = useStudio((s) => s.drafts);
  const form = useMemo(() => currentForm({ modelId, drafts }), [modelId, drafts]);
  const evaluated = useMemo(() => {
    if (!form) return null;
    const found = getModel(form.modelId);
    if (!found) return null;
    try {
      return evaluate(found.provider, found.model, form);
    } catch {
      return null;
    }
  }, [form]);
  return { form, evaluated };
}

/** 服务端预览（请求体、curl、体积、费用），防抖 200ms */
export function usePreview(form: FormInput | null, tempHost?: string): { preview: PreviewResponse | null; loading: boolean; error: string | null } {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = form ? JSON.stringify(form) + (tempHost ?? '') : '';
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!form) return;
    const timer = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      api
        .preview(form, c.signal, tempHost ? { tempHost } : {})
        .then((p) => {
          setPreview(p);
          setError(null);
        })
        .catch((e: unknown) => {
          if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { preview, loading, error };
}
