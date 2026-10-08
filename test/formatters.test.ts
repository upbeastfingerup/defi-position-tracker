import { describe, expect, it } from "vitest";
import { formatJson, toJson } from "../src/formatters/json.js";
import { formatTable, renderTable } from "../src/formatters/table.js";
import { loadConfig } from "../src/config.js";
import type { PositionReport } from "../src/services/tracker.js";
import { AAVE, OWNER, PAIR, USDC, WETH } from "./helpers.js";

const report: PositionReport = {
  address: OWNER, chainId: 1, fetchedAt: "2026-01-01T00:00:00.000Z", priceSource: "static",
  balances: [{ token: WETH, symbol: "WETH", decimals: 18, balance: 2_500_000_000_000_000_000n, valueUsd: 750_000_000_000n }],
  lpPositions: [{
    pair: PAIR, lpBalance: 10n ** 17n, lpDecimals: 18, totalSupply: 10n ** 18n,
    token0: { address: WETH, symbol: "WETH", decimals: 18 }, token1: { address: USDC, symbol: "USDC", decimals: 6 },
    reserve0: 1000n * 10n ** 18n, reserve1: 3_000_000n * 10n ** 6n, amount0: 100n * 10n ** 18n, amount1: 300_000n * 10n ** 6n, valueUsd: null,
  }],
  aave: { pool: AAVE, totalCollateralBase: 10_000n * 10n ** 8n, totalDebtBase: 5_000n * 10n ** 8n, availableBorrowsBase: 0n, liquidationThresholdBps: 8250n, ltvBps: 8000n,
    healthFactor: 1_650_000_000_000_000_000n, recomputedHealthFactor: 1_650_000_000_000_000_000n, status: "healthy" },
  totalUsd: 750_000_000_000n, warnings: ["demo warning"],
};

describe("json formatter", () => {
  it("emits exact strings, never numbers, for bigints", () => {
    const j = toJson(report);
    expect(j.balances[0]).toMatchObject({ raw: "2500000000000000000", amount: "2.5", valueUsd: "7500" });
    expect(j.lpPositions[0]).toMatchObject({ valueUsd: null, poolShare: "10%" });
    expect(j.aave).toMatchObject({ healthFactor: "1.65", liquidationThreshold: "82.5%", totalDebtUsd: "5000" });
    expect(() => JSON.parse(formatJson(report))).not.toThrow();
  });
});

describe("table formatter", () => {
  it("renders aligned sections, n/a for unpriced, and warnings", () => {
    const t = formatTable(report);
    expect(t).toContain("$7,500.00");
    expect(t).toContain("n/a");
    expect(t).toContain("1.650");
    expect(t).toContain("WETH/USDC");
    expect(t).toContain("  - demo warning");
    const lines = t.split("\n").filter((l) => l.startsWith("|"));
    expect(new Set(lines.filter((l) => l.includes("Token") || l.includes("WETH ")).map((l) => l.length)).size).toBeGreaterThan(0);
  });
  it("renderTable pads columns to equal width", () => {
    const out = renderTable(["A", "Bee"], [["xxxx", "1"]], [1]).split("\n");
    expect(new Set(out.map((l) => l.length)).size).toBe(1);
  });
});

describe("config (zod)", () => {
  it("applies defaults and normalizes addresses", () => {
    const c = loadConfig({ RPC_URL: "https://rpc.example", TRACKED_TOKENS: JSON.stringify([WETH.toLowerCase()]) });
    expect(c.CHAIN_ID).toBe(1);
    expect(c.PORT).toBe(3000);
    expect(c.PRICE_SOURCE).toBe("chainlink");
    expect(c.TRACKED_TOKENS).toEqual([WETH]); // checksummed
    expect(c.AAVE_POOL).toBeUndefined();
  });
  it("accepts an empty AAVE_POOL and parses numbers from strings", () => {
    const c = loadConfig({ RPC_URL: "https://rpc.example", AAVE_POOL: "", PORT: "8080", CHAIN_ID: "8453" });
    expect(c.PORT).toBe(8080);
    expect(c.CHAIN_ID).toBe(8453);
  });
  it("reports every problem at once", () => {
    expect(() => loadConfig({ RPC_URL: "nope", PORT: "abc", TRACKED_TOKENS: "[\"0x123\"]", STATIC_PRICES: "{bad" }))
      .toThrow(/RPC_URL[\s\S]*PORT[\s\S]*TRACKED_TOKENS[\s\S]*STATIC_PRICES/);
  });
  it("requires RPC_URL", () => {
    expect(() => loadConfig({})).toThrow(/RPC_URL/);
  });
});
