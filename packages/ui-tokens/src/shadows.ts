import type { ThemeId } from './colors';

export const shadows = {
  'shadow-sm': { dark: '0 1px 2px #00000066', light: '0 1px 2px #0c14120f, 0 1px 3px #0c141214' },
  'shadow-lg': { dark: '0 16px 40px -8px #000000cc', light: '0 12px 32px -6px #0c141229' },
  'glow-mint': {
    dark: '0 0 0 1px #4ee3b040, 0 0 24px -2px #4ee3b059',
    light: '0 0 0 1px #087a5733, 0 6px 18px -6px #087a5759',
  },
  'glow-amber': {
    dark: '0 0 0 1px #ffb84d59, 0 0 28px -2px #ffb84d4d',
    light: '0 0 0 1px #9a5a0040, 0 6px 20px -6px #9a5a0059',
  },
  'focus-ring': {
    dark: '0 0 0 2px #0a0e0d, 0 0 0 4px #4ee3b0',
    light: '0 0 0 2px #ffffff, 0 0 0 4px #087a57',
  },
} as const satisfies Record<string, Record<ThemeId, string>>;
export type ShadowToken = keyof typeof shadows;
