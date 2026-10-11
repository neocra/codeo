import { useMemo } from 'react';
import { createTranslator, type Translator } from '@codeo/i18n';
import { useSettings } from './settings';

/** The translator for the current locale (French by default). */
export function useT(): Translator {
  const locale = useSettings((s) => s.locale);
  return useMemo(() => createTranslator(locale), [locale]);
}
