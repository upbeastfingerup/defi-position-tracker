import type { Address } from "viem";
import type { CallResult, ChainReader, ContractCall } from "../src/infra/chainReader.js";

export const OWNER = "0x1111111111111111111111111111111111111111" as Address;
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
export const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
export const PAIR = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc" as Address;
export const AAVE = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address;

export type Handler = (c: ContractCall) => unknown;

/** In-memory ChainReader: handler returns a value (success) or throws (per-call failure). */
export function fakeReader(handler: Handler): ChainReader & { batches: ContractCall[][] } {
  const batches: ContractCall[][] = [];
  return {
    batches,
    async multicall(calls) {
      batches.push([...calls]);
      return calls.map((c): CallResult => {
        try {
          return { status: "success", result: handler(c) };
        } catch (e) {
          return { status: "failure", error: e as Error };
        }
      });
    },
  };
}

const lc = (a: string) => a.toLowerCase();
export const is = (c: ContractCall, addr: string, fn: string) => lc(c.address) === lc(addr) && c.functionName === fn;
