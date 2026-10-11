/** Seven speeds, four curves and a line, four travel distances. */
export const durations = {
  'dur-instant': 80,
  'dur-quick': 140,
  'dur-base': 220,
  'dur-slow': 360,
  'dur-deliberate': 560,
  'dur-shimmer': 1600,
  'dur-ambient': 2400,
  'stagger-step': 45,
} as const;
export type DurationToken = keyof typeof durations;

export const easings = {
  'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease-enter': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  'ease-exit': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  'ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  'ease-breathe': 'cubic-bezier(0.45, 0, 0.55, 1)',
  'ease-linear': 'linear',
} as const;
export type EasingToken = keyof typeof easings;

export const travel = {
  'shift-1': 2,
  'shift-2': 4,
  'shift-3': 8,
  'shift-4': 16,
} as const;
export type TravelToken = keyof typeof travel;
