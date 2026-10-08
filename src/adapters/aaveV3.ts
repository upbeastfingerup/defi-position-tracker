import type { Address } from "viem";
import { aavePoolAbi } from "../infra/abis.js";
import { ok, type ChainReader } from "../infra/chainReader.js";
import { MAX_UINT256, classifyHealth, computeHealthFactor, type HealthStatus } from "../math/bigmath.js";

export interface AaveAccount {
  pool: Address;
  /** all *Base amounts are USD with 8 decimals (Aave V3 base currency) */
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  liquidationThresholdBps: bigint;
  ltvBps: bigint;
  /** WAD-scaled; null = no debt (infinite) */
  healthFactor: bigint | null;
  /** health factor recomputed locally from collateral/threshold/debt, for cross-checking */
  recomputedHealthFactor: bigint | null;
  status: HealthStatus;
}

export async function readAaveAccount(reader: ChainReader, owner: Address, pool: Address): Promise<AaveAccount | null> {
  const [res] = await reader.multicall([{ address: pool, abi: aavePoolAbi, functionName: "getUserAccountData", args: [owner] }]);
  if (res?.status === "failure") throw new Error(`aave getUserAccountData failed: ${res.error.message}`);
  const d = ok<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(res);
  if (!d) throw new Error("aave getUserAccountData returned nothing");
  const [collateral, debt, avail, liqThr, ltv, hfRaw] = d;
  if (collateral === 0n && debt === 0n) return null; // no Aave position
  const healthFactor = debt === 0n || hfRaw >= MAX_UINT256 ? null : hfRaw;
  return {
    pool,
    totalCollateralBase: collateral,
    totalDebtBase: debt,
    availableBorrowsBase: avail,
    liquidationThresholdBps: liqThr,
    ltvBps: ltv,
    healthFactor,
    recomputedHealthFactor: computeHealthFactor({ collateralBase: collateral, debtBase: debt, liquidationThresholdBps: liqThr }),
    status: classifyHealth(healthFactor),
  };
}
