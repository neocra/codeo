export interface SeqItem<T> {
  seq: number;
  item: T;
}

/**
 * Bounded buffer of sequence-numbered items, kept in insertion order. Used by the relay to replay
 * the most recent runtime events to a device that reconnects with `afterSeq`.
 */
export class SeqRingBuffer<T> {
  private readonly items: SeqItem<T>[] = [];
  private _lastSeq = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('capacity must be a positive integer');
  }

  get lastSeq(): number {
    return this._lastSeq;
  }

  get oldestSeq(): number | null {
    return this.items[0]?.seq ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  /** Appends when `seq` advances the buffer; returns false (and ignores) on duplicates or out-of-order items. */
  push(seq: number, item: T): boolean {
    if (seq <= this._lastSeq) return false;
    this.items.push({ seq, item });
    this._lastSeq = seq;
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return true;
  }

  /** Items with seq > afterSeq, oldest first. */
  since(afterSeq: number): SeqItem<T>[] {
    return this.items.filter((e) => e.seq > afterSeq);
  }

  /** True when events between `afterSeq` and the oldest retained item have been evicted. */
  hasGapAfter(afterSeq: number): boolean {
    const oldest = this.oldestSeq;
    if (oldest === null) return afterSeq < this._lastSeq;
    return afterSeq < oldest - 1;
  }

  clear(): void {
    this.items.length = 0;
    this._lastSeq = 0;
  }
}
