import type { Address } from "viem";
import { aggregatorAbi } from "../infra/abis.js";
import { ok, type ChainReader } from "../infra/chainReader.js";
import { priceKey, type PriceMap, type PriceProvider } from "./priceProvider.js";

export interface ChainlinkOptions {
  /** token address -> Chainlink USD aggregator address */
  feeds: Record<string, Address>;
  maxAgeSeconds: number;
  now?: () => number; // unix seconds
  onWarning?: (msg: string) => void;
}

/** Reads latestRoundData()/decimals() for every feed in a single multicall. Rejects stale or non-positive answers. */
export class ChainlinkPriceProvider implements PriceProvider {
  readonly name = "chainlink";
  private readonly feeds: Map<string, Address>;

  constructor(private readonly reader: ChainReader, private readonly opts: ChainlinkOptions) {
    this.feeds = new Map(Object.entries(opts.feeds).map(([t, f]) => [priceKey(t), f]));
  }

  async getPrices(tokens: readonly Address[]): Promise<PriceMap> {
    const wanted = [...new Set(tokens.map(priceKey))].filter((t) => this.feeds.has(t));
    const out: PriceMap = new Map();
    if (wanted.length === 0) return out;

    const calls = wanted.flatMap((t) => {
      const address = this.feeds.get(t)!;
      return [
        { address, abi: aggregatorAbi, functionName: "latestRoundData" },
        { address, abi: aggregatorAbi, functionName: "decimals" },
      ];
    });
    const res = await this.reader.multicall(calls);
    const now = (this.opts.now ?? (() => Math.floor(Date.now() / 1000)))();

    wanted.forEach((t, i) => {
      const round = ok<readonly [bigint, bigint, bigint, bigint, bigint]>(res[2 * i]);
      const decimals = ok<number>(res[2 * i + 1]);
      if (!round || decimals === undefined) return this.opts.onWarning?.(`chainlink feed call failed for ${t}`);
      const [, answer, , updatedAt] = round;
      if (answer <= 0n) return this.opts.onWarning?.(`non-positive chainlink answer for ${t}`);
      if (now - Number(updatedAt) > this.opts.maxAgeSeconds) {
        return this.opts.onWarning?.(`stale chainlink price for ${t} (updated ${updatedAt})`);
      }
      out.set(t, { value: answer, decimals: Number(decimals) });
    });
    return out;
  }
}
