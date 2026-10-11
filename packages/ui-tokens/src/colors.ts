/** Codeo Motion colour roles. Source: official design artifact tokens.json (dark first). */
export const colorTokens = {
  'bg-000': { dark: '#0a0e0d', light: '#f3f6f5' },
  'bg-100': { dark: '#0f1514', light: '#eaefed' },
  'bg-200': { dark: '#141b19', light: '#ffffff' },
  'bg-300': { dark: '#1b2422', light: '#f0f4f2' },
  'bg-400': { dark: '#223230', light: '#e1ebe7' },
  line: { dark: '#24302d', light: '#dbe3e0' },
  'line-strong': { dark: '#5a756f', light: '#7a8c86' },
  ink: { dark: '#e9f1ee', light: '#0c1412' },
  'ink-muted': { dark: '#a0aeaa', light: '#47554f' },
  'ink-faint': { dark: '#83938e', light: '#5c6b66' },
  mint: { dark: '#4ee3b0', light: '#087a57' },
  'mint-strong': { dark: '#7af0c6', light: '#066347' },
  'mint-soft': { dark: '#0e2c23', light: '#d9f5ea' },
  'on-mint': { dark: '#03140e', light: '#ffffff' },
  amber: { dark: '#ffb84d', light: '#9a5a00' },
  'amber-soft': { dark: '#2e220c', light: '#fdefd6' },
  'on-amber': { dark: '#1c1100', light: '#ffffff' },
  sky: { dark: '#63b0ff', light: '#1a64c4' },
  'sky-soft': { dark: '#0f2236', light: '#e0edfc' },
  coral: { dark: '#ff7a6b', light: '#c2352a' },
  'coral-soft': { dark: '#33140f', light: '#fde4e1' },
  'diff-add': { dark: '#0f2e22', light: '#dcf5e9' },
  'diff-del': { dark: '#36151a', light: '#fde2e2' },
  'syn-keyword': { dark: '#ff8fb1', light: '#b4235a' },
  'syn-string': { dark: '#ffd28a', light: '#8a5300' },
  'syn-type': { dark: '#6fd8ff', light: '#0b6e94' },
  'syn-fn': { dark: '#c9b0ff', light: '#6a3fc2' },
  /* aliases in the source: syn-comment = {ink-faint}, syn-number = {amber} */
  'syn-comment': { dark: '#83938e', light: '#5c6b66' },
  'syn-number': { dark: '#ffb84d', light: '#9a5a00' },
} as const;

export type ColorToken = keyof typeof colorTokens;
export type ThemeId = 'dark' | 'light';
export const themeIds: readonly ThemeId[] = ['dark', 'light'];

export function color(token: ColorToken, theme: ThemeId): string {
  return colorTokens[token][theme];
}
