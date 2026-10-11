/** Serialises async work per key (e.g. a workspace id) without blocking other keys. */
export class KeyedLock {
  private chains = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, settled);
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return result;
  }
}
