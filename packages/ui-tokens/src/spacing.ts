/** 4px grid. */
export const spacing = {
  'space-1': 4,
  'space-2': 8,
  'space-3': 12,
  'space-4': 16,
  'space-5': 20,
  'space-6': 24,
  'space-8': 32,
} as const;
export type SpacingToken = keyof typeof spacing;
