export const fontFamilies = {
  sans: '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export interface TextStyle {
  family: keyof typeof fontFamilies;
  fontSize: number;
  lineHeight: number;
  fontWeight: 400 | 500 | 600 | 700;
  letterSpacing?: string;
}

/** Interface (Geist) and Code (JetBrains Mono) styles from the design artifact. */
export const textStyles = {
  display: { family: 'sans', fontSize: 32, lineHeight: 38, fontWeight: 700, letterSpacing: '-0.02em' },
  title: { family: 'sans', fontSize: 22, lineHeight: 28, fontWeight: 600, letterSpacing: '-0.01em' },
  heading: { family: 'sans', fontSize: 15, lineHeight: 22, fontWeight: 600 },
  body: { family: 'sans', fontSize: 14, lineHeight: 20, fontWeight: 400 },
  'body-sm': { family: 'sans', fontSize: 13, lineHeight: 18, fontWeight: 400 },
  label: { family: 'sans', fontSize: 12, lineHeight: 16, fontWeight: 500, letterSpacing: '0.01em' },
  overline: { family: 'sans', fontSize: 11, lineHeight: 14, fontWeight: 600, letterSpacing: '0.08em' },
  code: { family: 'mono', fontSize: 13, lineHeight: 20, fontWeight: 400 },
  'code-sm': { family: 'mono', fontSize: 12, lineHeight: 16, fontWeight: 500 },
} as const satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;
