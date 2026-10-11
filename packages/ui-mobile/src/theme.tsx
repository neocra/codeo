import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { theme as buildTheme, type ColorToken, type Theme, type ThemeId } from '@codeo/ui-tokens';
import { defaultFontFamily, type FontFamilyResolver } from './fonts';

export interface ThemeContextValue {
  theme: Theme;
  fontFamily: FontFamilyResolver;
  /** "Mode focus": stops ambient loops (attention-ladder rungs 1, 2 and 4). */
  calm: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  themeId?: ThemeId;
  fontFamily?: FontFamilyResolver;
  calm?: boolean;
  children: ReactNode;
}

export function ThemeProvider({ themeId = 'dark', fontFamily = defaultFontFamily, calm = false, children }: ThemeProviderProps) {
  const value = useMemo<ThemeContextValue>(
    () => ({ theme: buildTheme(themeId), fontFamily, calm }),
    [themeId, fontFamily, calm],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/** Resolves a colour token, or passes through a raw colour string (e.g. one handed over by react-navigation). */
export function resolveColor(theme: Theme, value: ColorToken | (string & {})): string {
  return value in theme.colors ? theme.colors[value as ColorToken] : value;
}

/** Appends an alpha byte to a 6-digit hex colour: withAlpha('#4ee3b0', 0.25) → '#4ee3b040'. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
