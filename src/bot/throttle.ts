export class Throttler {
  private lastRun = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => Promise<void>) | null = null;

  constructor(private minMs: number) {}

  schedule(fn: () => Promise<void>): void {
    this.pending = fn;
    if (this.timer) return;
    // +1: fire strictly after minMs, not exactly on the boundary.
    const wait = Math.max(0, this.lastRun + this.minMs - Date.now() + 1);
    this.timer = setTimeout(() => void this.flushNow(), wait);
  }

  async flushNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const fn = this.pending;
    this.pending = null;
    if (!fn) return;
    this.lastRun = Date.now();
    try { await fn(); } catch { /* ignore */ }
  }

  /** Drop the pending run so it can't overwrite a final status. */
  cancel(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
  }
}
