import { describe, expect, it } from 'vitest';
import { KeyedLock } from '../src/keyed-lock';

describe('KeyedLock', () => {
  it('serialises work per key and keeps keys independent', async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    const slow = lock.run('a', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('a1');
    });
    const fast = lock.run('a', async () => {
      order.push('a2');
    });
    const other = lock.run('b', async () => {
      order.push('b1');
    });
    await Promise.all([slow, fast, other]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });
  it('keeps the chain alive after a failure', async () => {
    const lock = new KeyedLock();
    await expect(lock.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await lock.run('k', async () => 42)).toBe(42);
  });
});
