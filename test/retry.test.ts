import { describe, expect, it, vi } from "vitest";
import { backoffDelay, withRetry } from "../src/infra/retry.js";

describe("withRetry", () => {
  it("returns on first success without sleeping", async () => {
    const sleep = vi.fn();
    expect(await withRetry(async () => 42, { attempts: 3, baseMs: 10, sleep })).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("retries with exponential backoff then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new Error("boom"); return "ok"; }, { attempts: 5, baseMs: 100, sleep });
    expect(r).toBe("ok");
    expect(n).toBe(3);
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([100, 200]);
  });
  it("throws the last error after exhausting attempts", async () => {
    let n = 0;
    await expect(withRetry(async () => { throw new Error(`fail ${++n}`); }, { attempts: 3, baseMs: 1, sleep: async () => {} })).rejects.toThrow("fail 3");
    expect(n).toBe(3);
  });
  it("stops early when shouldRetry says no", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error("fatal"); }, { attempts: 5, baseMs: 1, sleep: async () => {}, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(n).toBe(1);
  });
  it("caps delay at maxMs and applies jitter", () => {
    expect(backoffDelay(10, { baseMs: 100, maxMs: 1000 })).toBe(1000);
    expect(backoffDelay(1, { baseMs: 100, jitter: 0.5, random: () => 1 })).toBe(50);
  });
});
