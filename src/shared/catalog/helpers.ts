import type { DocRef } from './types.js';
import type { I18nText } from '../i18n.js';

export const T = (zh: string, en: string): I18nText => ({ zh, en });

/** 声明里引用的文档，统一核对日期 */
export const CHECKED_AT = '2026-10-08';
export const doc = (url: string, note?: string): DocRef => ({ url, checkedAt: CHECKED_AT, ...(note ? { note } : {}) });

export const MB = 1024 * 1024;
