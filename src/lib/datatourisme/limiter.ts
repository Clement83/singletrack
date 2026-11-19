/**
 * Strict request limiter for the DATAtourisme API (#1643). The published quotas are 20–30 concurrent requests,
 * ~10 req/s sustained and 1,000 requests/hour per client; we stay far below them on purpose:
 * one request in flight, at least `minIntervalMs` between two starts, at most `maxPerHour` starts in any
 * sliding hour. When the hourly budget is used up, `schedule` waits until the oldest start leaves the window.
 */
export type LimiterOptions = {
  minIntervalMs: number;
  maxPerHour: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const HOUR_MS = 3_600_000;

export class RequestLimiter {
  private readonly starts: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Number of calls started so far (for the end-of-sync summary). */
  count = 0;

  constructor(private readonly opts: LimiterOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Delay before the next call may start (0 = now). Pure with respect to the recorded starts. */
  waitMs(at = this.now()): number {
    while (this.starts.length && this.starts[0] <= at - HOUR_MS) this.starts.shift();
    let wait = 0;
    const last = this.starts[this.starts.length - 1];
    if (last !== undefined) wait = Math.max(wait, last + this.opts.minIntervalMs - at);
    if (this.starts.length >= this.opts.maxPerHour) wait = Math.max(wait, this.starts[0] + HOUR_MS - at);
    return Math.max(0, wait);
  }

  /** Runs `fn` once every previous call has finished and the spacing / hourly rules allow it. */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      for (let w = this.waitMs(); w > 0; w = this.waitMs()) await this.sleep(w);
      this.starts.push(this.now());
      this.count++;
      return fn();
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
