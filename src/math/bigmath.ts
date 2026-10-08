/** Bigint-only fixed-point helpers. No floating point is ever used for token amounts. */

export const USD_DECIMALS = 8; // matches Chainlink USD feeds and Aave V3 base currency
export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export const pow10 = (n: number): bigint => {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`invalid exponent ${n}`);
  return 10n ** BigInt(n);
};

function assertDivisor(d: bigint): void {
  if (d <= 0n) throw new RangeError("divisor must be positive");
}

/** floor(a*b/d) for non-negative operands. */
export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  assertDivisor(d);
  if (a < 0n || b < 0n) throw new RangeError("negative operand");
  return (a * b) / d;
}

/** round-half-up(a*b/d) for non-negative operands. */
export function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  assertDivisor(d);
  if (a < 0n || b < 0n) throw new RangeError("negative operand");
  return (2n * a * b + d) / (2n * d);
}

/** Re-scale an integer from `from` to `to` decimals. Narrowing rounds half up. */
export function scaleDecimals(value: bigint, from: number, to: number): bigint {
  if (from === to) return value;
  if (to > from) return value * pow10(to - from);
  return mulDivRound(value, 1n, pow10(from - to));
}

/** Strict decimal-string parser: throws instead of silently truncating precision. */
export function parseUnits(text: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new SyntaxError(`invalid decimal string "${text}"`);
  const [, whole = "0", frac = ""] = m;
  if (frac.length > decimals) throw new RangeError(`"${text}" has more than ${decimals} decimals`);
  return BigInt(whole) * pow10(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Exact decimal string, trailing zeros trimmed ("1.5", "0.000001", "42"). */
export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Fixed number of fraction digits, round half up, optional thousands grouping. */
export function formatFixed(value: bigint, decimals: number, fractionDigits: number, group = false): string {
  const neg = value < 0n;
  const scaled = scaleDecimals(neg ? -value : value, decimals, fractionDigits);
  const s = scaled.toString().padStart(fractionDigits + 1, "0");
  let whole = s.slice(0, s.length - fractionDigits);
  const frac = s.slice(s.length - fractionDigits);
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}${fractionDigits ? "." + frac : ""}`;
}

export interface Price {
  /** USD price of one whole token, scaled by 10^decimals. */
  value: bigint;
  decimals: number;
}

/** USD value of `amount` raw token units, returned with USD_DECIMALS decimals (round half up). */
export function tokenValueUsd(amount: bigint, tokenDecimals: number, price: Price): bigint {
  return mulDivRound(amount * price.value, pow10(USD_DECIMALS), pow10(tokenDecimals + price.decimals));
}

/** A holder's pro-rata claim on a pool reserve (floor, like the pair contract itself). */
export function lpShare(lpBalance: bigint, totalSupply: bigint, reserve: bigint): bigint {
  if (totalSupply === 0n) return 0n;
  return mulDivFloor(lpBalance, reserve, totalSupply);
}

/** Aave: percentMul with half-up rounding. */
const percentMul = (v: bigint, bps: bigint) => (v * bps + BPS / 2n) / BPS;

/**
 * Aave V3 health factor (WAD scaled) = collateral * liquidationThreshold / debt.
 * Returns null for "infinite" (no debt).
 */
export function computeHealthFactor(p: {
  collateralBase: bigint;
  debtBase: bigint;
  liquidationThresholdBps: bigint;
}): bigint | null {
  if (p.debtBase === 0n) return null;
  const adjusted = percentMul(p.collateralBase, p.liquidationThresholdBps);
  return (adjusted * WAD + p.debtBase / 2n) / p.debtBase;
}

export type HealthStatus = "no-debt" | "liquidatable" | "at-risk" | "caution" | "healthy";

export function classifyHealth(hf: bigint | null): HealthStatus {
  if (hf === null || hf >= MAX_UINT256) return "no-debt";
  if (hf < WAD) return "liquidatable";
  if (hf < (WAD * 11n) / 10n) return "at-risk";
  if (hf < (WAD * 3n) / 2n) return "caution";
  return "healthy";
}
