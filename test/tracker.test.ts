import { describe, expect, it } from "vitest";
import { PositionTracker, UpstreamError } from "../src/services/tracker.js";
import { StaticPriceProvider } from "../src/providers/staticPriceProvider.js";
import type { ChainReader } from "../src/infra/chainReader.js";
import { AAVE, OWNER, PAIR, USDC, WETH, fakeReader, is } from "./helpers.js";

const chain = (c: any) => {
  if (is(c, WETH, "balanceOf")) return 2n * 10n ** 18n;
  if (is(c, WETH, "decimals")) return 18;
  if (is(c, WETH, "symbol")) return "WETH";
  if (is(c, USDC, "balanceOf")) return 1_500_500_000n; // 1500.5
  if (is(c, USDC, "decimals")) return 6;
  if (is(c, USDC, "symbol")) return "USDC";
  if (is(c, PAIR, "balanceOf")) return 10n ** 17n;
  if (is(c, PAIR, "totalSupply")) return 10n ** 18n;
  if (is(c, PAIR, "decimals")) return 18;
  if (is(c, PAIR, "getReserves")) return [1_000n * 10n ** 18n, 3_000_000n * 10n ** 6n, 0] as const;
  if (is(c, PAIR, "token0")) return WETH;
  if (is(c, PAIR, "token1")) return USDC;
  if (is(c, AAVE, "getUserAccountData")) return [10_000n * 10n ** 8n, 5_000n * 10n ** 8n, 0n, 8250n, 8000n, 1_650_000_000_000_000_000n] as const;
  throw new Error("unexpected call");
};
const cfg = { chainId: 1, tokens: [WETH, USDC], uniswapPairs: [PAIR], aavePool: AAVE };
const clock = () => new Date("2026-01-01T00:00:00.000Z");

describe("PositionTracker", () => {
  it("aggregates balances, LP value, Aave and total in exact bigint USD", async () => {
    const t = new PositionTracker(fakeReader(chain), new StaticPriceProvider({ [WETH]: "3000", [USDC]: "1" }), cfg, clock);
    const r = await t.getPositions(OWNER);
    expect(r.balances.map((b) => b.valueUsd)).toEqual([6_000n * 10n ** 8n, 1_500_50n * 10n ** 6n]);
    // LP: 100 WETH * 3000 + 300,000 USDC * 1 = 600,000
    expect(r.lpPositions[0]!.valueUsd).toBe(600_000n * 10n ** 8n);
    expect(r.aave?.status).toBe("healthy");
    expect(r.totalUsd).toBe((6_000n + 1_500n * 1n + 600_000n) * 10n ** 8n + 50n * 10n ** 6n);
    expect(r.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(r.warnings).toEqual([]);
  });
  it("leaves unpriced assets null, warns, and excludes them from the total", async () => {
    const t = new PositionTracker(fakeReader(chain), new StaticPriceProvider({ [USDC]: "1" }), cfg, clock);
    const r = await t.getPositions(OWNER);
    expect(r.balances[0]!.valueUsd).toBeNull();
    expect(r.lpPositions[0]!.valueUsd).toBeNull();
    expect(r.totalUsd).toBe(1_500_50n * 10n ** 6n);
    expect(r.warnings.some((w) => w.includes("no price for WETH"))).toBe(true);
  });
  it("degrades gracefully when one section fails (aave reverts)", async () => {
    const t = new PositionTracker(fakeReader((c) => { if (c.address === AAVE) throw new Error("revert"); return chain(c); }),
      new StaticPriceProvider({ [WETH]: "3000", [USDC]: "1" }), cfg, clock);
    const r = await t.getPositions(OWNER);
    expect(r.aave).toBeNull();
    expect(r.balances).toHaveLength(2);
    expect(r.warnings.some((w) => w.startsWith("aave-v3 failed"))).toBe(true);
  });
  it("throws UpstreamError when every section fails (RPC down)", async () => {
    const down: ChainReader = { multicall: async () => { throw new Error("ECONNREFUSED"); } };
    const t = new PositionTracker(down, new StaticPriceProvider({}), cfg, clock);
    await expect(t.getPositions(OWNER)).rejects.toBeInstanceOf(UpstreamError);
  });
  it("survives a failing price provider", async () => {
    const bad = { name: "bad", getPrices: async () => { throw new Error("feed outage"); } };
    const r = await new PositionTracker(fakeReader(chain), bad, cfg, clock).getPositions(OWNER);
    expect(r.totalUsd).toBe(0n);
    expect(r.warnings.some((w) => w.includes("feed outage"))).toBe(true);
  });
});
