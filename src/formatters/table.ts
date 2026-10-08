import { USD_DECIMALS, formatFixed } from "../math/bigmath.js";
import type { PositionReport } from "../services/tracker.js";

export function renderTable(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const cell = (s: string, i: number) => (rightAlign.includes(i) ? s.padStart(widths[i]!) : s.padEnd(widths[i]!));
  const line = (r: string[]) => "| " + r.map(cell).join(" | ") + " |";
  const sep = "|-" + widths.map((w) => "-".repeat(w)).join("-|-") + "-|";
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

export const fmtUsd = (v: bigint | null) => (v === null ? "n/a" : "$" + formatFixed(v, USD_DECIMALS, 2, true));
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export function formatTable(r: PositionReport): string {
  const out: string[] = [`Positions for ${r.address} (chain ${r.chainId}, prices: ${r.priceSource}, ${r.fetchedAt})`, ""];

  out.push("ERC-20 balances");
  out.push(
    r.balances.length
      ? renderTable(
          ["Token", "Amount", "USD"],
          r.balances.map((b) => [b.symbol, formatFixed(b.balance, b.decimals, Math.min(6, b.decimals), true), fmtUsd(b.valueUsd)]),
          [1, 2],
        )
      : "(none)",
  );

  out.push("", "Uniswap V2 LP positions");
  out.push(
    r.lpPositions.length
      ? renderTable(
          ["Pair", "Pool", "Amount0", "Amount1", "USD"],
          r.lpPositions.map((p) => [
            short(p.pair),
            `${p.token0.symbol}/${p.token1.symbol}`,
            formatFixed(p.amount0, p.token0.decimals, Math.min(6, p.token0.decimals), true),
            formatFixed(p.amount1, p.token1.decimals, Math.min(6, p.token1.decimals), true),
            fmtUsd(p.valueUsd),
          ]),
          [2, 3, 4],
        )
      : "(none)",
  );

  out.push("", "Aave V3");
  if (r.aave) {
    const a = r.aave;
    out.push(
      renderTable(
        ["Collateral", "Debt", "Borrowable", "Liq. threshold", "Health factor", "Status"],
        [[fmtUsd(a.totalCollateralBase), fmtUsd(a.totalDebtBase), fmtUsd(a.availableBorrowsBase), formatFixed(a.liquidationThresholdBps, 2, 2) + "%", a.healthFactor === null ? "inf" : formatFixed(a.healthFactor, 18, 3), a.status]],
        [0, 1, 2, 3, 4],
      ),
    );
  } else out.push("(none)");

  out.push("", `Total priced value: ${fmtUsd(r.totalUsd)}`);
  if (r.warnings.length) out.push("", "Warnings:", ...r.warnings.map((w) => `  - ${w}`));
  return out.join("\n");
}
