import { randomUUID } from 'node:crypto';

/** Stable, URL-safe entity identifier with a type prefix (e.g. `ws_8f3…`). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function isId(value: unknown, prefix?: string): value is string {
  if (typeof value !== 'string') return false;
  return prefix ? value.startsWith(`${prefix}_`) : /^[a-z]+_[0-9a-f]{32}$/.test(value);
}
