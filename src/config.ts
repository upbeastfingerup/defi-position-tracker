import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "invalid EVM address")
  .transform((v) => getAddress(v.toLowerCase()) as Address);

const jsonOf = <T extends z.ZodType>(schema: T, fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s.trim() === "" ? fallback : s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "must be valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);

const schema = z.object({
  RPC_URL: z.url(),
  CHAIN_ID: z.coerce.number().int().positive().default(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  PRICE_SOURCE: z.enum(["chainlink", "static"]).default("chainlink"),
  MAX_PRICE_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_MS: z.coerce.number().int().min(0).default(200),
  MULTICALL_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  TRACKED_TOKENS: jsonOf(z.array(address), "[]"),
  CHAINLINK_FEEDS: jsonOf(z.record(address, address), "{}"),
  STATIC_PRICES: jsonOf(z.record(address, z.string().regex(/^\d+(\.\d{1,8})?$/, "decimal with <= 8 places")), "{}"),
  UNISWAP_V2_PAIRS: jsonOf(z.array(address), "[]"),
  AAVE_POOL: z.preprocess((v) => (v === "" ? undefined : v), address.optional()),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const addressSchema = address;
