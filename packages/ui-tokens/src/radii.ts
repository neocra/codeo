export const radii = {
  'radius-xs': 6,
  'radius-sm': 8,
  'radius-md': 12,
  'radius-lg': 16,
  'radius-full': 999,
} as const;
export type RadiusToken = keyof typeof radii;
