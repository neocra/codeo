import { createTranslator, formatRelative as fr, type MessageKey, type Params } from '@codeo/i18n';
import { useMemo } from 'react';
import { useUi } from './store';

export function useT() {
  const locale = useUi((s) => s.locale);
  return useMemo(() => createTranslator(locale), [locale]);
}
export type { MessageKey, Params };
export const formatRelative = fr;
