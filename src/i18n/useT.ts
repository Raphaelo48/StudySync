/**
 * Хук перевода: подписывается на настройку языка, поэтому смена языка
 * перерисовывает экран без перезапуска приложения.
 */
import { useMemo } from 'react';
import { useSettings } from '../state/AppContexts';
import { resolveLocale, setLocale, translate, type TFunction } from './index';

export function useT(): TFunction {
  const { settings } = useSettings();
  const locale = resolveLocale(settings.language);
  return useMemo(() => {
    setLocale(locale);
    return (key: string, params?: Record<string, string | number>) => translate(key, params);
  }, [locale]);
}
