import { describe, expect, it } from 'vitest';
import { createTranslator, formatRelative, locales, translate } from '../src/index';

describe('i18n', () => {
  it('interpolates parameters', () => {
    expect(translate('fr', 'home.greeting', { name: 'Aurélien' })).toBe('Bonjour Aurélien');
  });
  it('has every French key in English', () => {
    for (const k of Object.keys(locales.fr)) expect(locales.en, k).toHaveProperty(k);
  });
  it('formats relative times in the product style', () => {
    const t = createTranslator('fr');
    const now = new Date('2026-10-11T18:00:00Z');
    expect(formatRelative(t, '2026-10-11T16:36:00Z', now)).toBe('il y a 1 h 24');
    expect(formatRelative(t, '2026-10-11T17:55:00Z', now)).toBe('il y a 5 min');
  });
});
