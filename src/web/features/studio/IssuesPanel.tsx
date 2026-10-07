import clsx from 'clsx';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Issue } from '../../../shared/catalog/types';
import { useText } from '../../i18n/useText';
import { useStudio } from '../../stores/studio';
import { Button } from '../../ui/primitives';

export function IssuesPanel({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  const tx = useText();
  const patchValues = useStudio((s) => s.patchValues);
  // 同一 id 只显示一条（本地求值与服务端预览可能重复）
  const seen = new Set<string>();
  const list = issues.filter((i) => (seen.has(i.id + i.message.zh) ? false : (seen.add(i.id + i.message.zh), true)));
  if (!list.length) return null;
  const order = { error: 0, warn: 1, info: 2 } as const;
  return (
    <ul className="space-y-1" data-testid="issues">
      {list
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i) => (
          <li key={i.id + i.message.zh} className={clsx('flex items-start gap-2 rounded-md px-2 py-1 text-sm', i.severity === 'error' ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]' : i.severity === 'warn' ? 'bg-[var(--color-warn)]/10 text-[var(--color-warn)]' : 'bg-[var(--color-bg)] text-[var(--color-muted)]')}>
            <span className="mt-0.5">{i.severity === 'error' ? <XCircle size={14} /> : i.severity === 'warn' ? <AlertTriangle size={14} /> : <Info size={14} />}</span>
            <span className="flex-1">{tx(i.message)}</span>
            {i.fix ? (
              <Button size="sm" onClick={() => patchValues(i.fix!.patch)} title={t('issues.fix')}>
                {tx(i.fix.label)}
              </Button>
            ) : null}
          </li>
        ))}
    </ul>
  );
}
