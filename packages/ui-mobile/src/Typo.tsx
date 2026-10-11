import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import type { ColorToken, TextStyleName } from '@codeo/ui-tokens';
import { useTheme } from './theme';

export type TypoVariant = TextStyleName;

export interface TypoProps extends TextProps {
  variant?: TypoVariant;
  color?: ColorToken;
  /** Tabular numerals for anything that ticks (timers, counts, percentages). */
  tabular?: boolean;
  align?: TextStyle['textAlign'];
}

/** Returns the React Native text style for a design text variant. */
export function useTextStyle(variant: TypoVariant, color: ColorToken = 'ink'): TextStyle {
  const { theme, fontFamily } = useTheme();
  const s = theme.text[variant];
  const style: TextStyle = {
    fontFamily: fontFamily(s.fontWeight, s.family === 'mono'),
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    color: theme.colors[color],
  };
  if ('letterSpacing' in s) style.letterSpacing = parseFloat(s.letterSpacing) * s.fontSize;
  if (variant === 'overline') style.textTransform = 'uppercase';
  return style;
}

/** Text set in one of the design's text styles (display, title, heading, body, body-sm, label, overline, code, code-sm). */
export function Typo({ variant = 'body', color = 'ink', tabular = false, align, style, ...rest }: TypoProps) {
  const base = useTextStyle(variant, color);
  const extra: TextStyle = {};
  if (tabular) extra.fontVariant = ['tabular-nums'];
  if (align) extra.textAlign = align;
  return <RNText {...rest} style={[base, extra, style]} />;
}
