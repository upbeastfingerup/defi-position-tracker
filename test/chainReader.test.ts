import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, decodeFunctionResult, encodeFunctionData, multicall3Abi, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { erc20Abi } from "../src/infra/abis.js";
import { ViemChainReader, type MulticallCapable } from "../src/infra/chainReader.js";
import { OWNER, USDC } from "./helpers.js";

const noSleep = { attempts: 3, baseMs: 1, sleep: async () => {} };
const call = (i: number) => ({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [OWNER] as const, i });

describe("ViemChainReader (fake client)", () => {
  it("splits calls into batches of batchSize and preserves order", async () => {
    const seen: number[] = [];
    const client: MulticallCapable = {
      multicall: async ({ contracts }) => { seen.push(contracts.length); return contracts.map(() => ({ status: "success", result: 1n })); },
    };
    const out = await new ViemChainReader(client, noSleep, 2).multicall([call(0), call(1), call(2), call(3), call(4)]);
    expect(seen).toEqual([2, 2, 1]);
    expect(out).toHaveLength(5);
  });
  it("retries a failing batch and recovers", async () => {
    const m = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue([{ status: "success", result: 7n }]);
    const out = await new ViemChainReader({ multicall: m }, noSleep).multicall([call(0)]);
    expect(m).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ status: "success", result: 7n }]);
  });
  it("throws after exhausting retries", async () => {
    const m = vi.fn().mockRejectedValue(new Error("rpc down"));
    await expect(new ViemChainReader({ multicall: m }, noSleep).multicall([call(0)])).rejects.toThrow("rpc down");
    expect(m).toHaveBeenCalledTimes(3);
  });
  it("keeps per-call failures isolated", async () => {
    const m = vi.fn().mockResolvedValue([{ status: "failure", error: new Error("revert") }, { status: "success", result: 1n }]);
    const out = await new ViemChainReader({ multicall: m }, noSleep).multicall([call(0), call(1)]);
    expect(out[0]).toMatchObject({ status: "failure" });
    expect(out[1]).toEqual({ status: "success", result: 1n });
  });
});

/** Real viem client + real Multicall3 ABI encoding, answered by an in-memory JSON-RPC transport. No sockets. */
describe("ViemChainReader (real viem client over mocked transport)", () => {
  function mockClient(opts: { failFirstRpc?: boolean } = {}) {
    let rpcCalls = 0;
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      rpcCalls++;
      if (opts.failFirstRpc && rpcCalls === 1) throw new Error("temporary rpc error");
      if (method !== "eth_call") throw new Error(`unexpected rpc ${method}`);
      const [{ data }] = params as [{ data: Hex }];
      const { args } = decodeFunctionData({ abi: multicall3Abi, data });
      const calls = (args as unknown as [readonly { target: string; callData: Hex }[]])[0];
      const results = calls.map((c) => {
        const inner = decodeFunctionData({ abi: erc20Abi, data: c.callData });
        if (inner.functionName === "balanceOf") return { success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 1_234_567n }) };
        if (inner.functionName === "decimals") return { success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 6 }) };
        return { success: false, returnData: "0x" as Hex }; // symbol "reverts"
      });
      return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
    };
    const client = createPublicClient({ chain: mainnet, transport: custom({ request } as never, { retryCount: 0 }) });
    return { client, rpcCalls: () => rpcCalls };
  }
  const calls = [
    { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [OWNER] },
    { address: USDC, abi: erc20Abi, functionName: "decimals" },
    { address: USDC, abi: erc20Abi, functionName: "symbol" },
  ];

  it("encodes/decodes a real Multicall3 round trip in a single eth_call", async () => {
    const { client, rpcCalls } = mockClient();
    const out = await new ViemChainReader(client, noSleep).multicall(calls);
    expect(rpcCalls()).toBe(1);
    expect(out[0]).toEqual({ status: "success", result: 1_234_567n });
    expect(out[1]).toEqual({ status: "success", result: 6 });
    expect(out[2]!.status).toBe("failure");
  });
  it("retries transport errors through the backoff layer", async () => {
    const { client, rpcCalls } = mockClient({ failFirstRpc: true });
    const out = await new ViemChainReader(client, noSleep).multicall(calls);
    expect(rpcCalls()).toBe(2);
    expect(out[0]).toEqual({ status: "success", result: 1_234_567n });
  });
  it("sanity: helper encoders agree", () => {
    const d = encodeFunctionData({ abi: erc20Abi, functionName: "decimals" });
    expect(decodeFunctionResult({ abi: erc20Abi, functionName: "decimals", data: encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 18 }) })).toBe(18);
    expect(d.startsWith("0x313ce567")).toBe(true);
  });
});

import { isBatchTransportFailure } from "../src/infra/chainReader.js";
describe("isBatchTransportFailure", () => {
  const e = new Error("503");
  it("flags a shared non-revert error", () => {
    expect(isBatchTransportFailure([{ status: "failure", error: e }, { status: "failure", error: e }])).toBe(true);
  });
  it("ignores mixed results, distinct errors and revert-typed errors", () => {
    expect(isBatchTransportFailure([{ status: "success" }, { status: "failure", error: e }])).toBe(false);
    expect(isBatchTransportFailure([{ status: "failure", error: e }, { status: "failure", error: new Error("x") }])).toBe(false);
    const revert = Object.assign(new Error("wrap"), { cause: Object.assign(new Error("r"), { name: "ContractFunctionRevertedError" }) });
    expect(isBatchTransportFailure([{ status: "failure", error: revert }])).toBe(false);
    expect(isBatchTransportFailure([])).toBe(false);
  });
});
