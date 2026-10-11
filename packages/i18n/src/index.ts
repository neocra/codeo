import { en } from './en';
import { fr, type MessageKey } from './fr';

export type Locale = 'fr' | 'en';
export type { MessageKey };
export const DEFAULT_LOCALE: Locale = 'fr';
export const locales: Record<Locale, Record<MessageKey, string>> = { fr, en };

export type Params = Record<string, string | number>;

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = locales[locale][key] ?? locales.fr[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function createTranslator(locale: Locale) {
  return (key: MessageKey, params?: Params) => translate(locale, key, params);
}
export type Translator = ReturnType<typeof createTranslator>;

/** Relative time in the product's short French style ("il y a 1 h 24", "Hier à 16:42"). */
export function formatRelative(t: Translator, iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffMin = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay || diffMin < 24 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return t('time.hoursAgo', { h, m: m.toString().padStart(2, '0') });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  if (d.toDateString() === yesterday.toDateString()) return t('time.yesterdayAt', { time });
  return t('time.onDate', { date: `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${time}` });
}
