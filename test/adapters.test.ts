import { describe, expect, it } from "vitest";
import { readAaveAccount } from "../src/adapters/aaveV3.js";
import { readErc20Balances } from "../src/adapters/erc20.js";
import { readUniswapV2Positions } from "../src/adapters/uniswapV2.js";
import { AAVE, OWNER, PAIR, USDC, WETH, fakeReader, is } from "./helpers.js";

describe("erc20 adapter", () => {
  it("batches 3 calls per token into ONE multicall and hides zero balances", async () => {
    const r = fakeReader((c) => {
      if (is(c, WETH, "balanceOf")) return 2n * 10n ** 18n;
      if (is(c, WETH, "decimals")) return 18;
      if (is(c, WETH, "symbol")) return "WETH";
      if (is(c, USDC, "balanceOf")) return 0n;
      return 6;
    });
    const out = await readErc20Balances(r, OWNER, [WETH, USDC]);
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]).toHaveLength(6);
    expect(out.items).toEqual([{ token: WETH, symbol: "WETH", decimals: 18, balance: 2n * 10n ** 18n }]);
  });
  it("skips a broken token with a warning but keeps the rest", async () => {
    const r = fakeReader((c) => {
      if (c.address === USDC) throw new Error("revert");
      if (c.functionName === "balanceOf") return 5n;
      if (c.functionName === "decimals") return 18;
      throw new Error("no symbol"); // symbol failure is tolerated
    });
    const out = await readErc20Balances(r, OWNER, [USDC, WETH]);
    expect(out.items.map((i) => [i.token, i.symbol])).toEqual([[WETH, "?"]]);
    expect(out.warnings[0]).toContain(USDC);
  });
});

describe("uniswap v2 adapter", () => {
  const handler = (opts: { lp?: bigint } = {}) => (c: any) => {
    if (is(c, PAIR, "balanceOf")) return opts.lp ?? 10n ** 17n; // 0.1 LP
    if (is(c, PAIR, "totalSupply")) return 10n ** 18n;
    if (is(c, PAIR, "decimals")) return 18;
    if (is(c, PAIR, "getReserves")) return [1_000n * 10n ** 18n, 3_000_000n * 10n ** 6n, 0] as const;
    if (is(c, PAIR, "token0")) return WETH;
    if (is(c, PAIR, "token1")) return USDC;
    if (is(c, WETH, "decimals")) return 18;
    if (is(c, WETH, "symbol")) return "WETH";
    if (is(c, USDC, "decimals")) return 6;
    if (is(c, USDC, "symbol")) return "USDC";
    throw new Error("unexpected " + c.functionName);
  };
  it("computes the pro-rata underlying amounts in two multicall rounds", async () => {
    const r = fakeReader(handler());
    const { items } = await readUniswapV2Positions(r, OWNER, [PAIR]);
    expect(r.batches).toHaveLength(2);
    expect(items).toHaveLength(1);
    expect(items[0]!.amount0).toBe(100n * 10n ** 18n); // 10% of 1000 WETH
    expect(items[0]!.amount1).toBe(300_000n * 10n ** 6n); // 10% of 3M USDC
    expect(items[0]!.token1).toMatchObject({ symbol: "USDC", decimals: 6 });
  });
  it("skips zero-LP pairs without a second round", async () => {
    const r = fakeReader(handler({ lp: 0n }));
    const out = await readUniswapV2Positions(r, OWNER, [PAIR]);
    expect(out.items).toEqual([]);
    expect(r.batches).toHaveLength(1);
  });
  it("warns when a pair read fails", async () => {
    const r = fakeReader(() => { throw new Error("not a pair"); });
    const out = await readUniswapV2Positions(r, OWNER, [PAIR]);
    expect(out.items).toEqual([]);
    expect(out.warnings[0]).toContain("read failed");
  });
  it("makes no RPC calls for an empty pair list", async () => {
    const r = fakeReader(handler());
    await readUniswapV2Positions(r, OWNER, []);
    expect(r.batches).toHaveLength(0);
  });
});

describe("aave v3 adapter", () => {
  const acct = (c: bigint, d: bigint, thr: bigint, hf: bigint) => fakeReader(() => [c, d, 0n, thr, 8000n, hf] as const);
  it("reads a healthy account and the recomputed HF agrees with on-chain", async () => {
    const a = (await readAaveAccount(acct(10_000n * 10n ** 8n, 5_000n * 10n ** 8n, 8250n, 1_650_000_000_000_000_000n), OWNER, AAVE))!;
    expect(a.healthFactor).toBe(1_650_000_000_000_000_000n);
    expect(a.recomputedHealthFactor).toBe(a.healthFactor);
    expect(a.status).toBe("healthy");
  });
  it("treats max-uint health factor / zero debt as no-debt", async () => {
    const a = (await readAaveAccount(acct(100n * 10n ** 8n, 0n, 8000n, (1n << 256n) - 1n), OWNER, AAVE))!;
    expect(a.healthFactor).toBeNull();
    expect(a.status).toBe("no-debt");
  });
  it("flags a liquidatable account", async () => {
    const a = (await readAaveAccount(acct(100n * 10n ** 8n, 90n * 10n ** 8n, 8000n, 888_888_888_888_888_889n), OWNER, AAVE))!;
    expect(a.status).toBe("liquidatable");
  });
  it("returns null when the user has no Aave position", async () => {
    expect(await readAaveAccount(acct(0n, 0n, 0n, (1n << 256n) - 1n), OWNER, AAVE)).toBeNull();
  });
  it("throws when the pool call reverts", async () => {
    await expect(readAaveAccount(fakeReader(() => { throw new Error("revert"); }), OWNER, AAVE)).rejects.toThrow("getUserAccountData failed");
  });
});
