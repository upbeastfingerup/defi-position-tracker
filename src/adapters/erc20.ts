import type { Address } from "viem";
import { erc20Abi } from "../infra/abis.js";
import { ok, type ChainReader } from "../infra/chainReader.js";

export interface TokenBalance {
  token: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
}

export interface AdapterOutput<T> {
  items: T[];
  warnings: string[];
}

/** balanceOf/decimals/symbol for all tokens in one batched call. Failing tokens become warnings. */
export async function readErc20Balances(
  reader: ChainReader,
  owner: Address,
  tokens: readonly Address[],
  opts: { hideZero?: boolean } = {},
): Promise<AdapterOutput<TokenBalance>> {
  const calls = tokens.flatMap((address) => [
    { address, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
    { address, abi: erc20Abi, functionName: "decimals" },
    { address, abi: erc20Abi, functionName: "symbol" },
  ]);
  const res = await reader.multicall(calls);
  const items: TokenBalance[] = [];
  const warnings: string[] = [];
  tokens.forEach((token, i) => {
    const balance = ok<bigint>(res[3 * i]);
    const decimals = ok<number>(res[3 * i + 1]);
    const symbol = ok<string>(res[3 * i + 2]);
    if (balance === undefined || decimals === undefined) {
      warnings.push(`erc20 ${token}: balanceOf/decimals failed, skipped`);
      return;
    }
    if (opts.hideZero !== false && balance === 0n) return;
    items.push({ token, symbol: symbol ?? "?", decimals: Number(decimals), balance });
  });
  return { items, warnings };
}
