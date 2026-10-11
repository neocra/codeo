import { colorTokens, themeIds, type ColorToken, type ThemeId } from './colors';
import { durations, easings, travel } from './motion';
import { radii } from './radii';
import { shadows } from './shadows';
import { spacing } from './spacing';
import { fontFamilies, textStyles } from './typography';

/** Everything a non-CSS consumer (React Native) needs for one theme, as plain values. */
export interface Theme {
  id: ThemeId;
  colors: Record<ColorToken, string>;
  spacing: typeof spacing;
  radii: typeof radii;
  durations: typeof durations;
  easings: typeof easings;
  travel: typeof travel;
  shadows: Record<keyof typeof shadows, string>;
  fonts: typeof fontFamilies;
  text: typeof textStyles;
}

export function theme(id: ThemeId): Theme {
  const colors = Object.fromEntries(
    (Object.keys(colorTokens) as ColorToken[]).map((k) => [k, colorTokens[k][id]]),
  ) as Record<ColorToken, string>;
  const sh = Object.fromEntries(
    (Object.keys(shadows) as (keyof typeof shadows)[]).map((k) => [k, shadows[k][id]]),
  ) as Record<keyof typeof shadows, string>;
  return { id, colors, spacing, radii, durations, easings, travel, shadows: sh, fonts: fontFamilies, text: textStyles };
}

function colorVars(id: ThemeId): string {
  return (Object.keys(colorTokens) as ColorToken[])
    .map((k) => `  --${k}: ${colorTokens[k][id]};`)
    .concat((Object.keys(shadows) as (keyof typeof shadows)[]).map((k) => `  --${k}: ${shadows[k][id]};`))
    .join('\n');
}

/**
 * Generates the CSS custom properties for both themes. Dark is the default; light applies
 * under `[data-theme="light"]`, and follows the OS when `data-theme="system"`.
 */
export function buildTokensCss(): string {
  const staticVars = [
    `  --font-sans: ${fontFamilies.sans};`,
    `  --font-mono: ${fontFamilies.mono};`,
    ...Object.entries(spacing).map(([k, v]) => `  --${k}: ${v}px;`),
    ...Object.entries(radii).map(([k, v]) => `  --${k}: ${v}px;`),
    ...Object.entries(durations).map(([k, v]) => `  --${k}: ${v}ms;`),
    ...Object.entries(easings).map(([k, v]) => `  --${k}: ${v};`),
    ...Object.entries(travel).map(([k, v]) => `  --${k}: ${v}px;`),
  ].join('\n');
  const textVars = Object.entries(textStyles)
    .map(
      ([name, s]) =>
        `  --text-${name}: ${s.fontWeight} ${s.fontSize}px/${s.lineHeight}px var(--font-${s.family});` +
        ('letterSpacing' in s ? `\n  --tracking-${name}: ${s.letterSpacing};` : ''),
    )
    .join('\n');
  const lines = [
    '/* Codeo Motion — generated from @codeo/ui-tokens. Do not edit by hand: run `pnpm --filter @codeo/ui-tokens build:css`. */',
    ':root {',
    '  color-scheme: dark;',
    staticVars,
    textVars,
    colorVars('dark'),
    '}',
    ':root[data-theme="light"] {',
    '  color-scheme: light;',
    colorVars('light'),
    '}',
    '@media (prefers-color-scheme: light) {',
    '  :root[data-theme="system"] {',
    '    color-scheme: light;',
    colorVars('light').replace(/^ {2}/gm, '    '),
    '  }',
    '}',
    '',
  ];
  void themeIds;
  return lines.join('\n');
}
