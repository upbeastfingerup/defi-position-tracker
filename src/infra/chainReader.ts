import type { Abi, Address } from "viem";
import { withRetry, type RetryOptions } from "./retry.js";

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type CallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

/** The only chain capability the app needs: batched read calls with per-call failure isolation. */
export interface ChainReader {
  multicall(calls: readonly ContractCall[]): Promise<CallResult[]>;
}

/** Structural subset of viem's PublicClient, so tests can supply a fake. */
export interface MulticallCapable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  multicall(args: { contracts: any; allowFailure: true }): Promise<readonly any[]>;
}

/** viem-backed reader: chunks calls into Multicall3 batches, retrying each batch with backoff. */
export class ViemChainReader implements ChainReader {
  constructor(
    private readonly client: MulticallCapable,
    private readonly retry: RetryOptions,
    private readonly batchSize = 100,
  ) {}

  async multicall(calls: readonly ContractCall[]): Promise<CallResult[]> {
    const out: CallResult[] = [];
    for (let i = 0; i < calls.length; i += this.batchSize) {
      const chunk = calls.slice(i, i + this.batchSize);
      const res = await withRetry(async () => {
        const r = await this.client.multicall({ contracts: chunk, allowFailure: true });
        // viem's allowFailure:true also swallows transport/RPC errors into per-call failures.
        // Re-surface those so the retry layer sees them (see isBatchTransportFailure).
        if (isBatchTransportFailure(r)) throw r[0].error;
        return r;
      }, this.retry);
      for (const r of res) {
        out.push(
          r.status === "success"
            ? { status: "success", result: r.result }
            : { status: "failure", error: r.error instanceof Error ? r.error : new Error(String(r.error)) },
        );
      }
    }
    return out;
  }
}

const CONTRACT_LEVEL = new Set(["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError", "AbiDecodingDataSizeTooSmallError"]);

/**
 * When the whole eth_call fails (HTTP 429, timeout, ...) viem copies the SAME error object into every
 * result. Contract-level reverts produce distinct, revert-typed errors. Share-by-identity and not
 * revert-typed => transport failure.
 */
export function isBatchTransportFailure(res: readonly { status: string; error?: unknown }[]): boolean {
  if (res.length === 0 || res.some((r) => r.status !== "failure")) return false;
  const first = res[0]!.error;
  if (!res.every((r) => r.error === first)) return false;
  let e: unknown = first;
  for (let i = 0; e && i < 10; i++) {
    if (CONTRACT_LEVEL.has((e as { name?: string }).name ?? "")) return false;
    e = (e as { cause?: unknown }).cause;
  }
  return true;
}

/** Unwrap a successful result or return undefined. */
export function ok<T>(r: CallResult | undefined): T | undefined {
  return r?.status === "success" ? (r.result as T) : undefined;
}
