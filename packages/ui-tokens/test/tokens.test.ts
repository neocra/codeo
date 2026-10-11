import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTokensCss, colorTokens, theme } from '../src/index';

describe('ui-tokens', () => {
  it('tokens.css is in sync with the generator', () => {
    const file = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');
    expect(file).toBe(buildTokensCss());
  });
  it('exposes both themes for every colour role', () => {
    for (const [k, v] of Object.entries(colorTokens)) {
      expect(v.dark, k).toMatch(/^#[0-9a-f]{6}$/);
      expect(v.light, k).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(theme('light').colors.mint).toBe('#087a57');
  });
});
