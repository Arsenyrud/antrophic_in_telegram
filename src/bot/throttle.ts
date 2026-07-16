export class Throttler {
  private lastRun = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => Promise<void>) | null = null;

  constructor(private minMs: number) {}

  schedule(fn: () => Promise<void>): void {
    this.pending = fn;
    if (this.timer) return;
    // +1: коалесцированный запуск строго ПОСЛЕ минимального интервала,
    // а не ровно на границе lastRun + minMs.
    const wait = Math.max(0, this.lastRun + this.minMs - Date.now() + 1);
    this.timer = setTimeout(() => void this.flushNow(), wait);
  }

  async flushNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const fn = this.pending;
    this.pending = null;
    if (!fn) return;
    this.lastRun = Date.now();
    try { await fn(); } catch { /* Телеграм переживёт */ }
  }

  /** Отменить отложенный вызов, не выполняя его (чтобы не перезатереть финальный статус). */
  cancel(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
  }
}
