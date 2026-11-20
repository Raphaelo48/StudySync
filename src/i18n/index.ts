/**
 * Локализация интерфейса.
 *
 * - Словари лежат в locales/, ключи — смысловые (t('settings.title')).
 * - Язык по умолчанию — системный, с откатом на русский, если язык устройства
 *   не поддерживается.
 * - Экранные компоненты используют хук useT(), чтобы перерисовываться при
 *   смене языка; вне React-дерева доступна функция translate().
 */
import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import type { LanguagePref } from '../models/types';
import { ru } from './locales/ru';
import { en } from './locales/en';

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export type TranslateParams = Record<string, string | number>;
export type TFunction = (key: string, params?: TranslateParams) => string;

const i18n = new I18n({ ru, en });
i18n.defaultLocale = 'ru';
i18n.enableFallback = true;
i18n.locale = 'ru';

/** Язык устройства; всё неподдерживаемое сводится к русскому. */
export function deviceLocale(): AppLocale {
  try {
    const code = getLocales()[0]?.languageCode ?? '';
    return code.toLowerCase().startsWith('en') ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

/** Превратить настройку языка в конкретную локаль. */
export function resolveLocale(pref: LanguagePref): AppLocale {
  return pref === 'system' ? deviceLocale() : pref;
}

/** Переключить глобальную локаль i18n (вызывается хуком при смене настроек). */
export function setLocale(locale: AppLocale): void {
  i18n.locale = locale;
}

/** Перевод вне React-дерева (уведомления, логика). */
export function translate(key: string, params?: TranslateParams): string {
  return String(i18n.t(key, params ?? {}));
}
