import { describe, expect, it } from "vitest";
import {
  MAX_UINT256, WAD, classifyHealth, computeHealthFactor, formatFixed, formatUnits, lpShare,
  mulDivFloor, mulDivRound, parseUnits, scaleDecimals, tokenValueUsd,
} from "../src/math/bigmath.js";

describe("decimals normalization", () => {
  it("scales up exactly and down with half-up rounding", () => {
    expect(scaleDecimals(1_500_000n, 6, 18)).toBe(1_500_000_000_000_000_000n);
    expect(scaleDecimals(1_234_500n, 6, 4)).toBe(12_345n);
    expect(scaleDecimals(1_234_550n, 6, 4)).toBe(12_346n); // .5 rounds up
    expect(scaleDecimals(1_234_549n, 6, 4)).toBe(12_345n);
    expect(scaleDecimals(7n, 3, 3)).toBe(7n);
  });
  it("parseUnits is strict and exact", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("123", 0)).toBe(123n);
    expect(() => parseUnits("0.0000001", 6)).toThrow(RangeError);
    expect(() => parseUnits("-1", 6)).toThrow(SyntaxError);
    expect(() => parseUnits("1e3", 6)).toThrow(SyntaxError);
  });
  it("formatUnits round-trips beyond 2^53 without precision loss", () => {
    const big = 123_456_789_012_345_678_901_234_567n;
    expect(formatUnits(big, 18)).toBe("123456789.012345678901234567");
    expect(parseUnits(formatUnits(big, 18), 18)).toBe(big);
    expect(formatUnits(0n, 18)).toBe("0");
    expect(formatUnits(5n, 6)).toBe("0.000005");
    expect(formatUnits(-1_500_000n, 6)).toBe("-1.5");
  });
});

describe("rounding", () => {
  it("mulDivRound is half-up, mulDivFloor floors", () => {
    expect(mulDivFloor(7n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(7n, 1n, 2n)).toBe(4n);
    expect(mulDivRound(5n, 1n, 3n)).toBe(2n); // 1.67
    expect(mulDivRound(4n, 1n, 3n)).toBe(1n); // 1.33
  });
  it("rejects zero divisor and negatives", () => {
    expect(() => mulDivFloor(1n, 1n, 0n)).toThrow(RangeError);
    expect(() => mulDivRound(-1n, 1n, 1n)).toThrow(RangeError);
  });
  it("formatFixed rounds half up and groups", () => {
    expect(formatFixed(1_234_567_890n, 8, 2, true)).toBe("12.35");
    expect(formatFixed(123_456_789_012n, 8, 2, true)).toBe("1,234.57");
    expect(formatFixed(999_999n, 6, 2)).toBe("1.00");
    expect(formatFixed(0n, 8, 2)).toBe("0.00");
    expect(formatFixed(5n, 1, 0)).toBe("1");
  });
});

describe("USD valuation", () => {
  it("values an 18-dec token with an 8-dec price", () => {
    // 2.5 WETH @ $3,000.12345678
    const v = tokenValueUsd(2_500_000_000_000_000_000n, 18, { value: 300_012_345_678n, decimals: 8 });
    expect(v).toBe(750_030_864_195n); // $7500.30864195 (exact: 2.5 * 3000.12345678 = 7500.30864195)
  });
  it("values a 6-dec token and handles mismatched feed decimals", () => {
    expect(tokenValueUsd(1_000_000n, 6, { value: 99_990_000n, decimals: 8 })).toBe(99_990_000n);
    expect(tokenValueUsd(1_000_000n, 6, { value: 10n ** 18n, decimals: 18 })).toBe(10n ** 8n);
  });
  it("rounds sub-cent dust half up instead of truncating", () => {
    // 1 raw unit of an 18-dec token at $1 = 1e-18 USD -> 0 at 8 decimals
    expect(tokenValueUsd(1n, 18, { value: 10n ** 8n, decimals: 8 })).toBe(0n);
    // 0.5e-8 USD rounds up to 1e-8
    expect(tokenValueUsd(5n * 10n ** 9n, 18, { value: 10n ** 8n, decimals: 8 })).toBe(1n);
  });
});

describe("LP share", () => {
  it("is pro-rata and floors", () => {
    expect(lpShare(10n, 100n, 1_000n)).toBe(100n);
    expect(lpShare(1n, 3n, 10n)).toBe(3n); // 3.33 floors
  });
  it("returns 0 for an empty pool and the full reserve for 100% ownership", () => {
    expect(lpShare(5n, 0n, 1_000n)).toBe(0n);
    expect(lpShare(77n, 77n, 123_456_789n)).toBe(123_456_789n);
  });
  it("does not overflow past Number.MAX_SAFE_INTEGER", () => {
    const supply = 10n ** 30n;
    expect(lpShare(supply / 4n, supply, 4n * 10n ** 28n)).toBe(10n ** 28n);
  });
});

describe("health factor", () => {
  it("matches collateral * threshold / debt", () => {
    // $10,000 collateral, 82.5% threshold, $5,000 debt -> 1.65
    const hf = computeHealthFactor({ collateralBase: 1_000_000_000_000n, debtBase: 500_000_000_000n, liquidationThresholdBps: 8250n });
    expect(hf).toBe(1_650_000_000_000_000_000n);
  });
  it("returns null (infinite) with no debt", () => {
    expect(computeHealthFactor({ collateralBase: 1n, debtBase: 0n, liquidationThresholdBps: 8000n })).toBeNull();
  });
  it("is below 1 when underwater", () => {
    const hf = computeHealthFactor({ collateralBase: 100n * 10n ** 8n, debtBase: 90n * 10n ** 8n, liquidationThresholdBps: 8000n })!;
    expect(hf).toBeLessThan(WAD);
    expect(classifyHealth(hf)).toBe("liquidatable");
  });
  it("classifies bands at exact boundaries", () => {
    expect(classifyHealth(null)).toBe("no-debt");
    expect(classifyHealth(MAX_UINT256)).toBe("no-debt");
    expect(classifyHealth(WAD - 1n)).toBe("liquidatable");
    expect(classifyHealth(WAD)).toBe("at-risk");
    expect(classifyHealth((WAD * 11n) / 10n)).toBe("caution");
    expect(classifyHealth((WAD * 3n) / 2n)).toBe("healthy");
  });
});
