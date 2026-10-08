import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { PositionTracker, UpstreamError } from "../src/services/tracker.js";
import { StaticPriceProvider } from "../src/providers/staticPriceProvider.js";
import { OWNER, USDC, WETH, fakeReader, is } from "./helpers.js";

let app: FastifyInstance;
afterEach(() => app?.close());

const okTracker = () =>
  new PositionTracker(
    fakeReader((c) => {
      if (is(c, WETH, "balanceOf")) return 2n * 10n ** 18n;
      if (is(c, WETH, "decimals")) return 18;
      if (is(c, WETH, "symbol")) return "WETH";
      throw new Error("x");
    }),
    new StaticPriceProvider({ [WETH]: "3000" }),
    { chainId: 1, tokens: [WETH], uniswapPairs: [] },
    () => new Date("2026-01-01T00:00:00Z"),
  );

// Fastify's inject() drives the full HTTP stack in-process: no socket, no network.
describe("GET /positions/:address", () => {
  it("returns JSON positions", async () => {
    app = buildServer(okTracker());
    const res = await app.inject({ method: "GET", url: `/positions/${OWNER.toLowerCase()}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json();
    expect(body.address).toBe(OWNER);
    expect(body.balances[0]).toMatchObject({ symbol: "WETH", amount: "2", valueUsd: "6000" });
    expect(body.totalUsd).toBe("6000");
  });
  it("returns a text table with ?format=table", async () => {
    app = buildServer(okTracker());
    const res = await app.inject({ method: "GET", url: `/positions/${OWNER}?format=table` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("$6,000.00");
  });
  it("400s on a malformed address", async () => {
    app = buildServer(okTracker());
    const res = await app.inject({ method: "GET", url: "/positions/0x123" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_address");
  });
  it("400s on a bad format", async () => {
    app = buildServer(okTracker());
    const res = await app.inject({ method: "GET", url: `/positions/${OWNER}?format=xml` });
    expect(res.statusCode).toBe(400);
  });
  it("502s when the upstream RPC is down", async () => {
    app = buildServer({ getPositions: async () => { throw new UpstreamError("erc20 failed: ECONNREFUSED"); } });
    const res = await app.inject({ method: "GET", url: `/positions/${OWNER}` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("upstream_failure");
  });
  it("500s without leaking details on unexpected errors", async () => {
    app = buildServer({ getPositions: async () => { throw new TypeError("secret internals"); } });
    const res = await app.inject({ method: "GET", url: `/positions/${OWNER}` });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret");
  });
  it("serves /health and 404s unknown routes", async () => {
    app = buildServer(okTracker());
    expect((await app.inject({ url: "/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ url: "/nope" })).statusCode).toBe(404);
  });
});
