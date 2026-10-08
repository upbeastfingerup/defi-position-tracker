import { USD_DECIMALS, formatUnits } from "../math/bigmath.js";
import type { PositionReport } from "../services/tracker.js";

const usd = (v: bigint | null) => (v === null ? null : formatUnits(v, USD_DECIMALS));

/** JSON-safe DTO: every bigint becomes an exact decimal string (raw + human readable). */
export function toJson(r: PositionReport) {
  return {
    address: r.address,
    chainId: r.chainId,
    fetchedAt: r.fetchedAt,
    priceSource: r.priceSource,
    totalUsd: usd(r.totalUsd),
    balances: r.balances.map((b) => ({
      token: b.token,
      symbol: b.symbol,
      decimals: b.decimals,
      raw: b.balance.toString(),
      amount: formatUnits(b.balance, b.decimals),
      valueUsd: usd(b.valueUsd),
    })),
    lpPositions: r.lpPositions.map((p) => ({
      pair: p.pair,
      lpBalance: formatUnits(p.lpBalance, p.lpDecimals),
      poolShare: p.totalSupply === 0n ? "0" : `${formatUnits((p.lpBalance * 10n ** 8n) / p.totalSupply, 6)}%`,
      token0: { symbol: p.token0.symbol, address: p.token0.address, amount: formatUnits(p.amount0, p.token0.decimals), raw: p.amount0.toString() },
      token1: { symbol: p.token1.symbol, address: p.token1.address, amount: formatUnits(p.amount1, p.token1.decimals), raw: p.amount1.toString() },
      valueUsd: usd(p.valueUsd),
    })),
    aave: r.aave && {
      pool: r.aave.pool,
      totalCollateralUsd: usd(r.aave.totalCollateralBase),
      totalDebtUsd: usd(r.aave.totalDebtBase),
      availableBorrowsUsd: usd(r.aave.availableBorrowsBase),
      liquidationThreshold: formatUnits(r.aave.liquidationThresholdBps, 2) + "%",
      ltv: formatUnits(r.aave.ltvBps, 2) + "%",
      healthFactor: r.aave.healthFactor === null ? null : formatUnits(r.aave.healthFactor, 18),
      status: r.aave.status,
    },
    warnings: r.warnings,
  };
}

export const formatJson = (r: PositionReport) => JSON.stringify(toJson(r), null, 2);
