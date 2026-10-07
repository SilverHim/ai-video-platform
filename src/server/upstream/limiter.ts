/** 令牌桶：按 key（服务商:endpoint）限速，令牌不足时排队等待，最多等 maxWaitMs */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number; rps: number; burst: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async acquire(key: string, rps: number, opts: { burst?: number; maxWaitMs?: number; signal?: AbortSignal } = {}): Promise<void> {
    const burst = opts.burst ?? Math.max(1, Math.ceil(rps));
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: burst, last: this.now(), rps, burst };
      this.buckets.set(key, b);
    }
    const deadline = this.now() + (opts.maxWaitMs ?? 5000);
    for (;;) {
      const t = this.now();
      b.tokens = Math.min(b.burst, b.tokens + ((t - b.last) / 1000) * b.rps);
      b.last = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      const wait = Math.ceil(((1 - b.tokens) / b.rps) * 1000);
      if (t + wait > deadline) throw new RateLimitedLocally(key);
      await sleep(wait, opts.signal);
    }
  }
}

export class RateLimitedLocally extends Error {
  constructor(readonly key: string) {
    super(`本机限速：${key} 请求过于频繁`);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}
