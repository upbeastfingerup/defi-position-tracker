import type { Address } from "viem";
import { USD_DECIMALS, parseUnits } from "../math/bigmath.js";
import { priceKey, type PriceMap, type PriceProvider } from "./priceProvider.js";

/** Fixed prices from a map of address -> decimal string. Used by tests and offline demos. */
export class StaticPriceProvider implements PriceProvider {
  readonly name = "static";
  private readonly prices: PriceMap = new Map();

  constructor(prices: Record<string, string>) {
    for (const [addr, p] of Object.entries(prices)) {
      this.prices.set(priceKey(addr), { value: parseUnits(p, USD_DECIMALS), decimals: USD_DECIMALS });
    }
  }

  async getPrices(tokens: readonly Address[]): Promise<PriceMap> {
    const out: PriceMap = new Map();
    for (const t of tokens) {
      const p = this.prices.get(priceKey(t));
      if (p) out.set(priceKey(t), p);
    }
    return out;
  }
}
