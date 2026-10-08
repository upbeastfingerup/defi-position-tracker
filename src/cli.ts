#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createTracker } from "./app.js";
import { addressSchema, loadConfig } from "./config.js";
import { formatJson } from "./formatters/json.js";
import { formatTable } from "./formatters/table.js";
import { buildServer } from "./server.js";

const USAGE = `Usage:
  cli positions <address> [--format table|json]
  cli serve`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { format: { type: "string", default: "table" } } });
  const [cmd, arg] = positionals;
  if (cmd !== "positions" && cmd !== "serve") {
    console.error(USAGE);
    return 2;
  }
  const cfg = loadConfig();
  const tracker = createTracker(cfg);
  if (cmd === "serve") {
    await buildServer(tracker, { logger: true }).listen({ port: cfg.PORT, host: cfg.HOST });
    return -1; // keep running
  }
  const addr = addressSchema.safeParse(arg);
  if (!addr.success) {
    console.error("error: invalid address\n" + USAGE);
    return 2;
  }
  if (values.format !== "table" && values.format !== "json") {
    console.error("error: --format must be table or json");
    return 2;
  }
  const report = await tracker.getPositions(addr.data);
  console.log(values.format === "json" ? formatJson(report) : formatTable(report));
  return 0;
}

main().then(
  (code) => code >= 0 && process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
