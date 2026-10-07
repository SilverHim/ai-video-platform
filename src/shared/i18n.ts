/** 声明式目录里的双语文案；界面其余文案走 i18next */
export interface I18nText {
  zh: string;
  en: string;
}

export type Locale = 'zh' | 'en';

export function t(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.zh;
}
