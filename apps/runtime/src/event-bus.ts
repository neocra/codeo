import type { RuntimeEvent } from '@codeo/contracts';
import type { EventRepo } from '@codeo/database';
import { newId, TypedEmitter, type Logger } from '@codeo/shared-utils';

type Draft<T extends RuntimeEvent['type']> = Omit<Extract<RuntimeEvent, { type: T }>, 'id' | 'at' | 'type'>;

/**
 * Persists every domain event (append-only) and fans it out with its sequence number.
 * Writes are serialised so sequence numbers always match emission order.
 */
export class EventBus extends TypedEmitter<{ event: { seq: number; event: RuntimeEvent } }> {
  private chain: Promise<void> = Promise.resolve();
  private _lastSeq = 0;

  constructor(
    private readonly repo: EventRepo,
    private readonly log: Logger,
  ) {
    super();
  }

  async init(): Promise<void> {
    this._lastSeq = await this.repo.lastSeq();
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  publish<T extends RuntimeEvent['type']>(type: T, draft: Draft<T>): void {
    const event = { ...draft, type, id: newId('evt'), at: new Date().toISOString() } as unknown as RuntimeEvent;
    this.chain = this.chain
      .then(async () => {
        const seq = await this.repo.append({ id: event.id, type: event.type, at: event.at }, event);
        this._lastSeq = seq;
        this.emit('event', { seq, event });
      })
      .catch((err) => this.log.error('event persist failed', { type, err: String(err) }));
  }

  /** Flush pending writes (tests and shutdown). */
  flush(): Promise<void> {
    return this.chain;
  }

  replay(afterSeq: number, limit = 500): Promise<{ seq: number; payload: unknown }[]> {
    return this.repo.after(afterSeq, limit);
  }
}
