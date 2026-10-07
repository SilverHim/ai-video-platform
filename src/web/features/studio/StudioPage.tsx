import { useTranslation } from 'react-i18next';

export function StudioPage() {
  const { t } = useTranslation();
  return <p className="text-[var(--color-muted)]">{t('studio.placeholder')}</p>;
}
