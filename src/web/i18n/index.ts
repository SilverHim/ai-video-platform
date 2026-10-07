import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

const STORAGE_KEY = 'ark.ui.lang';

function initialLang(): 'zh' | 'en' {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // 隐私模式等情况下 localStorage 不可用
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'zh' | 'en') {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 忽略
  }
}

export default i18n;
