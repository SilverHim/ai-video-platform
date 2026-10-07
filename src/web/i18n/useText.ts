import { useTranslation } from 'react-i18next';
import type { I18nText } from '../../shared/i18n';

/** 取声明里双语文案的当前语言版本 */
export function useText() {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'zh';
  return (t: I18nText | undefined | null): string => (t ? t[lang] : '');
}
