import { describe, expect, it } from "vitest";
import { ChainlinkPriceProvider } from "../src/providers/chainlinkPriceProvider.js";
import { StaticPriceProvider } from "../src/providers/staticPriceProvider.js";
import { USDC, WETH, fakeReader, is } from "./helpers.js";

const FEED_ETH = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" as const;
const FEED_USDC = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6" as const;
const NOW = 1_800_000_000;

function feedReader(over: { ethUpdated?: number; ethAnswer?: bigint; usdcFails?: boolean } = {}) {
  return fakeReader((c) => {
    if (is(c, FEED_ETH, "latestRoundData")) return [1n, over.ethAnswer ?? 300_000_000_000n, 0n, BigInt(over.ethUpdated ?? NOW - 60), 1n];
    if (is(c, FEED_ETH, "decimals")) return 8;
    if (over.usdcFails) throw new Error("feed reverted");
    if (is(c, FEED_USDC, "latestRoundData")) return [1n, 100_000_000n, 0n, BigInt(NOW - 10), 1n];
    if (is(c, FEED_USDC, "decimals")) return 8;
    throw new Error("unexpected");
  });
}
const mk = (reader: ReturnType<typeof feedReader>, warnings: string[] = []) =>
  new ChainlinkPriceProvider(reader, { feeds: { [WETH]: FEED_ETH, [USDC]: FEED_USDC }, maxAgeSeconds: 3600, now: () => NOW, onWarning: (m) => warnings.push(m) });

describe("ChainlinkPriceProvider", () => {
  it("reads all feeds in one multicall, keyed case-insensitively", async () => {
    const r = feedReader();
    const prices = await mk(r).getPrices([WETH, USDC.toLowerCase() as `0x${string}`]);
    expect(r.batches).toHaveLength(1);
    expect(prices.get(WETH.toLowerCase())).toEqual({ value: 300_000_000_000n, decimals: 8 });
    expect(prices.get(USDC.toLowerCase())).toEqual({ value: 100_000_000n, decimals: 8 });
  });
  it("rejects stale prices", async () => {
    const w: string[] = [];
    const prices = await mk(feedReader({ ethUpdated: NOW - 7200 }), w).getPrices([WETH, USDC]);
    expect(prices.has(WETH.toLowerCase())).toBe(false);
    expect(prices.has(USDC.toLowerCase())).toBe(true);
    expect(w[0]).toContain("stale");
  });
  it("rejects non-positive answers and failed feeds", async () => {
    const w: string[] = [];
    const p1 = await mk(feedReader({ ethAnswer: -1n, usdcFails: true }), w).getPrices([WETH, USDC]);
    expect(p1.size).toBe(0);
    expect(w).toHaveLength(2);
  });
  it("makes no call for tokens without a feed", async () => {
    const r = feedReader();
    expect((await mk(r).getPrices(["0x2222222222222222222222222222222222222222"])).size).toBe(0);
    expect(r.batches).toHaveLength(0);
  });
});

describe("StaticPriceProvider", () => {
  it("parses decimal prices exactly and ignores unknown tokens", async () => {
    const p = new StaticPriceProvider({ [WETH]: "3000.12345678" });
    const out = await p.getPrices([WETH.toLowerCase() as `0x${string}`, USDC]);
    expect(out.get(WETH.toLowerCase())).toEqual({ value: 300_012_345_678n, decimals: 8 });
    expect(out.has(USDC.toLowerCase())).toBe(false);
  });
  it("rejects prices with more than 8 decimals", () => {
    expect(() => new StaticPriceProvider({ [WETH]: "1.123456789" })).toThrow();
  });
});
