import type { Address } from "viem";
import { readErc20Balances, type TokenBalance } from "../adapters/erc20.js";
import { readUniswapV2Positions, type LpPosition } from "../adapters/uniswapV2.js";
import { readAaveAccount, type AaveAccount } from "../adapters/aaveV3.js";
import type { ChainReader } from "../infra/chainReader.js";
import { tokenValueUsd } from "../math/bigmath.js";
import { priceKey, type PriceProvider } from "../providers/priceProvider.js";

export class UpstreamError extends Error {}

export interface TrackerConfig {
  chainId: number;
  tokens: Address[];
  uniswapPairs: Address[];
  aavePool?: Address;
}

export interface ValuedBalance extends TokenBalance {
  /** USD, 8 decimals; null when no price available */
  valueUsd: bigint | null;
}
export interface ValuedLp extends LpPosition {
  valueUsd: bigint | null;
}
export interface PositionReport {
  address: Address;
  chainId: number;
  fetchedAt: string;
  priceSource: string;
  balances: ValuedBalance[];
  lpPositions: ValuedLp[];
  aave: AaveAccount | null;
  /** sum of priced balances + LP value, USD 8 decimals (Aave not included: collateral is already held as aTokens) */
  totalUsd: bigint;
  warnings: string[];
}

export class PositionTracker {
  constructor(
    private readonly reader: ChainReader,
    private readonly prices: PriceProvider,
    private readonly cfg: TrackerConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPositions(address: Address): Promise<PositionReport> {
    const warnings: string[] = [];
    const sections: string[] = [];
    const failures: string[] = [];
    const run = async <T>(name: string, fn: () => Promise<T>, empty: T): Promise<T> => {
      sections.push(name);
      try {
        return await fn();
      } catch (e) {
        const msg = `${name} failed: ${e instanceof Error ? e.message : String(e)}`;
        failures.push(msg);
        warnings.push(msg);
        return empty;
      }
    };

    const [erc20, lp, aave] = await Promise.all([
      run("erc20", () => readErc20Balances(this.reader, address, this.cfg.tokens), { items: [], warnings: [] }),
      run("uniswap-v2", () => readUniswapV2Positions(this.reader, address, this.cfg.uniswapPairs), { items: [], warnings: [] }),
      this.cfg.aavePool ? run("aave-v3", () => readAaveAccount(this.reader, address, this.cfg.aavePool!), null) : Promise.resolve(null),
    ]);
    // Only fail hard when everything we attempted failed (e.g. RPC down), so callers can tell it apart from "empty wallet".
    if (sections.length > 0 && failures.length === sections.length) {
      throw new UpstreamError(failures.join("; "));
    }
    warnings.push(...erc20.warnings, ...lp.warnings);

    const toPrice = new Set<Address>([...erc20.items.map((b) => b.token), ...lp.items.flatMap((p) => [p.token0.address, p.token1.address])]);
    let priceMap = new Map();
    try {
      priceMap = await this.prices.getPrices([...toPrice]);
    } catch (e) {
      warnings.push(`price provider ${this.prices.name} failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const balances: ValuedBalance[] = erc20.items.map((b) => {
      const p = priceMap.get(priceKey(b.token));
      if (!p) warnings.push(`no price for ${b.symbol} (${b.token})`);
      return { ...b, valueUsd: p ? tokenValueUsd(b.balance, b.decimals, p) : null };
    });
    const lpPositions: ValuedLp[] = lp.items.map((x) => {
      const p0 = priceMap.get(priceKey(x.token0.address));
      const p1 = priceMap.get(priceKey(x.token1.address));
      if (!p0 || !p1) warnings.push(`LP ${x.pair}: missing price for ${!p0 ? x.token0.symbol : x.token1.symbol}, value unavailable`);
      const valueUsd = p0 && p1 ? tokenValueUsd(x.amount0, x.token0.decimals, p0) + tokenValueUsd(x.amount1, x.token1.decimals, p1) : null;
      return { ...x, valueUsd };
    });
    const totalUsd = [...balances, ...lpPositions].reduce((s, x) => s + (x.valueUsd ?? 0n), 0n);

    return {
      address,
      chainId: this.cfg.chainId,
      fetchedAt: this.now().toISOString(),
      priceSource: this.prices.name,
      balances,
      lpPositions,
      aave,
      totalUsd,
      warnings,
    };
  }
}
