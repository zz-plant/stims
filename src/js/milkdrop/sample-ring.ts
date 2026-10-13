/**
 * Fixed-capacity Float32Array ring buffers for rolling per-frame history.
 *
 * The Inspect tab and the stage watch HUD both keep a moving window of
 * per-frame values. Plain arrays did that with `push()` plus `shift()` —
 * `shift()` is O(n) on the render path (once per variable per rendered
 * frame), and the sliding backing store keeps the GC busy. A typed ring
 * writes O(1) into one allocation that never moves and never reallocates.
 *
 * Capacity is explicit per instance; `count` never exceeds it.
 */

/** Reads oldest → newest; the caller keeps `index` within `count`. */
export class SampleRing {
  readonly capacity: number;
  private readonly samples: Float32Array;
  /** Index the next `push` writes; oldest sample sits at `head` when full. */
  private head = 0;
  private held = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `SampleRing capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.samples = new Float32Array(capacity);
  }

  /** Samples currently held, never above `capacity`. */
  get count(): number {
    return this.held;
  }

  /** Append one sample, overwriting the oldest once the ring is full. */
  push(value: number): void {
    this.samples[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.held < this.capacity) this.held += 1;
  }

  /** Sample `index` steps from the oldest (0) to the newest (count − 1). */
  at(index: number): number {
    return this.samples[
      (this.head - this.held + index + this.capacity) % this.capacity
    ];
  }

  /** The most recent sample, or 0 when nothing has been recorded yet. */
  newest(): number {
    return this.held === 0
      ? 0
      : this.samples[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Forget every sample; the allocation stays for the next recording. */
  clear(): void {
    this.head = 0;
    this.held = 0;
  }
}
