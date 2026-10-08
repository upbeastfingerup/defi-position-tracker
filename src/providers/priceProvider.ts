import type { Address } from "viem";
import type { Price } from "../math/bigmath.js";

/** Prices keyed by lower-cased token address. Tokens with no price are simply absent. */
export type PriceMap = Map<string, Price>;

export interface PriceProvider {
  readonly name: string;
  getPrices(tokens: readonly Address[]): Promise<PriceMap>;
}

export const priceKey = (a: string) => a.toLowerCase();
