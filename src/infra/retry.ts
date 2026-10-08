export interface RetryOptions {
  attempts: number; // total tries, >= 1
  baseMs: number;
  maxMs?: number;
  factor?: number;
  /** 0..1 fraction of random jitter subtracted from the delay. */
  jitter?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(attempt: number, o: Pick<RetryOptions, "baseMs" | "maxMs" | "factor" | "jitter" | "random">): number {
  const raw = Math.min(o.maxMs ?? 10_000, o.baseMs * (o.factor ?? 2) ** (attempt - 1));
  const j = o.jitter ?? 0;
  return Math.round(raw * (1 - j * (o.random ?? Math.random)()));
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  const sleep = o.sleep ?? defaultSleep;
  let last: unknown;
  for (let attempt = 1; attempt <= Math.max(1, o.attempts); attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (attempt >= o.attempts || (o.shouldRetry && !o.shouldRetry(err, attempt))) break;
      await sleep(backoffDelay(attempt, o));
    }
  }
  throw last;
}
