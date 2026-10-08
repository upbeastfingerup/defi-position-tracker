import { createPublicClient, defineChain, http } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import type { Config } from "./config.js";
import { ViemChainReader, type ChainReader } from "./infra/chainReader.js";
import { ChainlinkPriceProvider } from "./providers/chainlinkPriceProvider.js";
import type { PriceProvider } from "./providers/priceProvider.js";
import { StaticPriceProvider } from "./providers/staticPriceProvider.js";
import { PositionTracker } from "./services/tracker.js";

const known = [mainnet, base, arbitrum, optimism, polygon];

/** Composition root: wires config -> viem client -> reader -> providers -> tracker. */
export function createTracker(cfg: Config): PositionTracker {
  const chain =
    known.find((c) => c.id === cfg.CHAIN_ID) ??
    defineChain({
      id: cfg.CHAIN_ID,
      name: `chain-${cfg.CHAIN_ID}`,
      nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [cfg.RPC_URL] } },
      // canonical Multicall3 deployment address
      contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    });
  // retryCount 0: retries are owned by our own backoff layer (infra/retry.ts)
  const client = createPublicClient({ chain, transport: http(cfg.RPC_URL, { retryCount: 0 }) });
  const reader: ChainReader = new ViemChainReader(
    client,
    { attempts: cfg.RETRY_ATTEMPTS, baseMs: cfg.RETRY_BASE_MS, jitter: 0.2 },
    cfg.MULTICALL_BATCH_SIZE,
  );
  const prices: PriceProvider =
    cfg.PRICE_SOURCE === "static"
      ? new StaticPriceProvider(cfg.STATIC_PRICES)
      : new ChainlinkPriceProvider(reader, { feeds: cfg.CHAINLINK_FEEDS, maxAgeSeconds: cfg.MAX_PRICE_AGE_SECONDS });
  return new PositionTracker(reader, prices, {
    chainId: cfg.CHAIN_ID,
    tokens: cfg.TRACKED_TOKENS,
    uniswapPairs: cfg.UNISWAP_V2_PAIRS,
    aavePool: cfg.AAVE_POOL,
  });
}
