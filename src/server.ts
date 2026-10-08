import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { addressSchema } from "./config.js";
import { formatTable } from "./formatters/table.js";
import { toJson } from "./formatters/json.js";
import { UpstreamError, type PositionTracker } from "./services/tracker.js";

const querySchema = z.object({ format: z.enum(["json", "table"]).default("json") });

export function buildServer(tracker: Pick<PositionTracker, "getPositions">, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/positions/:address", async (req, reply) => {
    const addr = addressSchema.safeParse((req.params as { address: string }).address);
    if (!addr.success) return reply.code(400).send({ error: "invalid_address", message: "path param must be a valid EVM address" });
    const q = querySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query", message: "format must be json or table" });
    try {
      const report = await tracker.getPositions(addr.data);
      if (q.data.format === "table") return reply.type("text/plain; charset=utf-8").send(formatTable(report));
      return toJson(report);
    } catch (e) {
      if (e instanceof UpstreamError) return reply.code(502).send({ error: "upstream_failure", message: e.message });
      req.log.error(e);
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  return app;
}
