/**
 * One task at a time per key: a promise chain per key, removed once the chain is empty. A failed task does not
 * stop the next one.
 */
export class KeyedLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.chains.set(key, run);
    try {
      return await run;
    } finally {
      if (this.chains.get(key) === run) this.chains.delete(key);
    }
  }
}
