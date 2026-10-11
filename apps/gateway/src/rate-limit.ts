import type { Clock } from './clock';

export interface RateLimiter {
  /** Records one attempt for `key` and reports whether it is within the window budget. */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterMs: number };
  reset(key?: string): void;
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  clock: Clock;
}

/** Fixed-window in-memory limiter. Good enough for one process; replace with a shared store when scaling out. */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  const SWEEP_AT = 10_000;

  const sweep = (now: number) => {
    for (const [key, b] of buckets) if (now - b.windowStart >= opts.windowMs) buckets.delete(key);
  };

  return {
    hit(key) {
      const now = opts.clock();
      if (buckets.size > SWEEP_AT) sweep(now);
      let b = buckets.get(key);
      if (!b || now - b.windowStart >= opts.windowMs) {
        b = { windowStart: now, count: 0 };
        buckets.set(key, b);
      }
      b.count++;
      const allowed = b.count <= opts.max;
      return {
        allowed,
        remaining: Math.max(0, opts.max - b.count),
        retryAfterMs: allowed ? 0 : Math.max(0, b.windowStart + opts.windowMs - now),
      };
    },
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}
