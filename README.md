# defi-position-tracker

> **Personal demo project.** Built as a portfolio sample. It is not client work, has no users, and no production metrics are claimed. All example output below is **illustrative mock data**.

A read-only TypeScript backend/CLI that, given a wallet address and an EVM RPC endpoint, reports DeFi positions:

- **ERC-20 balances** valued in USD
- **Uniswap V2-style LP positions** (pro-rata share of reserves, valued in USD)
- **Aave V3-style account health** (`getUserAccountData`: collateral, debt, health factor, risk band)

Output is a text table or JSON, via a CLI or `GET /positions/:address` (Fastify).

## Architecture

```
            CLI (src/cli.ts)            HTTP (src/server.ts, Fastify)
                    \                        /
                     v                      v
              PositionTracker  (src/services/tracker.ts)
              orchestrates sections, valuation, degradation
               /          |               \                \
   adapters/erc20   adapters/uniswapV2   adapters/aaveV3    PriceProvider (interface)
        \               |                /                   /               \
         \              |               /        ChainlinkPriceProvider   StaticPriceProvider
          v             v              v                  |                  (tests/offline)
              ChainReader (interface)  <-----------------+
                       |
              ViemChainReader: Multicall3 batching + retry/backoff
                       |
                 viem PublicClient ---> JSON-RPC

   formatters/{table,json}   math/bigmath.ts (bigint-only fixed point)   config.ts (zod)
```

Layers:

| Layer | Responsibility |
|---|---|
| `infra/` | `ChainReader` interface, viem implementation (multicall chunking, retry with exponential backoff + jitter), ABIs |
| `providers/` | `PriceProvider` interface; Chainlink reader (staleness + sign checks) and a static provider |
| `adapters/` | Protocol-specific reads that return plain bigint data; no pricing, no formatting |
| `services/` | `PositionTracker` combines adapters and prices; partial failures become `warnings` |
| `formatters/` | Table and JSON presentation only |
| `math/` | All arithmetic: decimals normalization, rounding, LP share, health factor |
| `app.ts` | Composition root wiring config to concrete classes |

### Design notes

- **No floats for amounts.** Everything is `bigint`. USD values use 8 decimals (Chainlink and Aave base-currency convention) and round half up; LP shares floor like the pair contract. JSON output emits exact decimal strings.
- **Failure isolation.** One broken token or one section reverting yields a warning, not a failed report. If *every* attempted section fails (e.g. RPC down) the tracker throws and the API returns `502`.
- **A viem detail worth knowing.** With `allowFailure: true`, viem's `multicall` converts a whole-request transport error (429, timeout) into per-call "failures", which would silently bypass any retry layer. `ViemChainReader` detects that case (same error object shared by every result, not revert-typed) and rethrows it so backoff applies. This is covered by tests.
- **Honest limits:** native-ETH balance is not included; LP valuation needs a price for both tokens (otherwise value is `n/a`, never guessed); Aave collateral is not added to the total (it is already held as aTokens); only V2-style constant-product pairs are supported.

## Usage

Requires Node 20+ (developed on Node 24).

```bash
npm install
cp .env.example .env   # then edit; see below
export $(grep -v '^#' .env | xargs)   # or use your own env loader

npm run dev -- positions 0xYourAddress --format table
npm run dev -- positions 0xYourAddress --format json
npm run build && npm start            # HTTP server on $PORT
curl localhost:3000/positions/0xYourAddress
curl "localhost:3000/positions/0xYourAddress?format=table"
```

### Configuration (env, validated with zod)

| Var | Default | Notes |
|---|---|---|
| `RPC_URL` | required | HTTP RPC endpoint |
| `CHAIN_ID` | `1` | Known: 1, 8453, 42161, 10, 137; others use canonical Multicall3 address |
| `PRICE_SOURCE` | `chainlink` | `chainlink` or `static` |
| `TRACKED_TOKENS` | `[]` | JSON array of token addresses |
| `CHAINLINK_FEEDS` | `{}` | JSON map token -> USD aggregator address |
| `STATIC_PRICES` | `{}` | JSON map token -> decimal string (max 8 places) |
| `UNISWAP_V2_PAIRS` | `[]` | JSON array of pair addresses |
| `AAVE_POOL` | unset | Aave V3 Pool address; omit to skip |
| `MAX_PRICE_AGE_SECONDS` | `86400` | Chainlink staleness limit |
| `RETRY_ATTEMPTS` / `RETRY_BASE_MS` | `3` / `200` | Backoff settings |
| `MULTICALL_BATCH_SIZE` | `100` | Calls per Multicall3 request |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |

Invalid config fails fast and lists every problem at once.

### HTTP API

- `GET /positions/:address[?format=json|table]` returns `200`; `400` on bad address/format; `502` if the chain is unreachable; `500` otherwise.
- `GET /health`

## Example output (illustrative mock data, not a real wallet)

```
Positions for 0x1111111111111111111111111111111111111111 (chain 1, prices: static, 2026-01-01T00:00:00.000Z)

ERC-20 balances
| Token |    Amount |       USD |
|-------|-----------|-----------|
| WETH  |  2.500000 | $7,500.00 |
| USDC  | 1,500.500 | $1,500.50 |

Uniswap V2 LP positions
| Pair          | Pool       |   Amount0 |    Amount1 |         USD |
|---------------|------------|-----------|------------|-------------|
| 0xB4e1...C9Dc | WETH/USDC  | 100.00000 | 300,000.00 | $600,000.00 |

Aave V3
| Collateral | Debt      | Borrowable | Liq. threshold | Health factor | Status  |
| $10,000.00 | $5,000.00 | $0.00      | 82.50%         | 1.650         | healthy |

Total priced value: $609,000.50
```

(The table above is hand-condensed for the README; the real renderer pads columns consistently.)

## Tests

```bash
npm test          # vitest run, no network required
npm run typecheck
```

Tests never touch the network: adapters/tracker use an in-memory `ChainReader`, and `chainReader.test.ts` additionally drives a **real viem client + real Multicall3 ABI encoding** through a mocked JSON-RPC transport. The HTTP endpoint is tested with Fastify's in-process `inject()` (no socket). Coverage: decimals normalization, half-up rounding, LP share, health factor and bands, retry/backoff and exhaustion, per-call vs. whole-batch failures, stale/negative Chainlink answers, config validation, and API status codes.

## Docker / CI

`Dockerfile` is a two-stage Node 24 build running the HTTP server. `.github/workflows/ci.yml` runs typecheck, tests and build. Neither has been executed as part of authoring this repo.

## License

MIT
