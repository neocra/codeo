/** Millisecond clock, injectable so tests can control expiry. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
