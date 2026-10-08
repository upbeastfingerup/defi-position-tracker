import type { Address } from "viem";
import { erc20Abi, pairAbi } from "../infra/abis.js";
import { ok, type ChainReader } from "../infra/chainReader.js";
import { lpShare } from "../math/bigmath.js";
import type { AdapterOutput } from "./erc20.js";

export interface PairToken {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface LpPosition {
  pair: Address;
  lpBalance: bigint;
  lpDecimals: number;
  totalSupply: bigint;
  token0: PairToken;
  token1: PairToken;
  reserve0: bigint;
  reserve1: bigint;
  /** the holder's underlying claim on each side (floor) */
  amount0: bigint;
  amount1: bigint;
}

/** Uniswap V2-style pairs (also works for Sushi, Pancake V2, ...). Two multicall rounds total. */
export async function readUniswapV2Positions(
  reader: ChainReader,
  owner: Address,
  pairs: readonly Address[],
): Promise<AdapterOutput<LpPosition>> {
  const warnings: string[] = [];
  const items: LpPosition[] = [];
  if (pairs.length === 0) return { items, warnings };

  const r1 = await reader.multicall(
    pairs.flatMap((address) => [
      { address, abi: pairAbi, functionName: "balanceOf", args: [owner] },
      { address, abi: pairAbi, functionName: "totalSupply" },
      { address, abi: pairAbi, functionName: "decimals" },
      { address, abi: pairAbi, functionName: "getReserves" },
      { address, abi: pairAbi, functionName: "token0" },
      { address, abi: pairAbi, functionName: "token1" },
    ]),
  );

  type Stage = { pair: Address; lpBalance: bigint; totalSupply: bigint; lpDecimals: number; r0: bigint; r1: bigint; t0: Address; t1: Address };
  const stage: Stage[] = [];
  pairs.forEach((pair, i) => {
    const o = 6 * i;
    const lpBalance = ok<bigint>(r1[o]);
    const totalSupply = ok<bigint>(r1[o + 1]);
    const lpDecimals = ok<number>(r1[o + 2]);
    const reserves = ok<readonly [bigint, bigint, number]>(r1[o + 3]);
    const t0 = ok<Address>(r1[o + 4]);
    const t1 = ok<Address>(r1[o + 5]);
    if (lpBalance === undefined || totalSupply === undefined || !reserves || !t0 || !t1) {
      warnings.push(`uniswap-v2 pair ${pair}: read failed, skipped`);
      return;
    }
    if (lpBalance === 0n) return;
    stage.push({ pair, lpBalance, totalSupply, lpDecimals: Number(lpDecimals ?? 18), r0: reserves[0], r1: reserves[1], t0, t1 });
  });
  if (stage.length === 0) return { items, warnings };

  const r2 = await reader.multicall(
    stage.flatMap((s) =>
      [s.t0, s.t1].flatMap((address) => [
        { address, abi: erc20Abi, functionName: "decimals" },
        { address, abi: erc20Abi, functionName: "symbol" },
      ]),
    ),
  );
  stage.forEach((s, i) => {
    const d0 = ok<number>(r2[4 * i]);
    const d1 = ok<number>(r2[4 * i + 2]);
    if (d0 === undefined || d1 === undefined) {
      warnings.push(`uniswap-v2 pair ${s.pair}: token decimals failed, skipped`);
      return;
    }
    items.push({
      pair: s.pair,
      lpBalance: s.lpBalance,
      lpDecimals: s.lpDecimals,
      totalSupply: s.totalSupply,
      token0: { address: s.t0, decimals: Number(d0), symbol: ok<string>(r2[4 * i + 1]) ?? "?" },
      token1: { address: s.t1, decimals: Number(d1), symbol: ok<string>(r2[4 * i + 3]) ?? "?" },
      reserve0: s.r0,
      reserve1: s.r1,
      amount0: lpShare(s.lpBalance, s.totalSupply, s.r0),
      amount1: lpShare(s.lpBalance, s.totalSupply, s.r1),
    });
  });
  return { items, warnings };
}
