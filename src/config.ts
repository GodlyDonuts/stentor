import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/),
  DISCORD_DEV_GUILD_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().regex(/^\d+$/).optional(),
  ),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(20).default(5),
  KERYX_URL: z
    .url()
    .default("https://raw.githubusercontent.com/GodlyDonuts/keryx/main/data/jobs.json"),
  KERYX_POLL_SECONDS: z.coerce.number().int().min(60).default(900),
  ANNOUNCEMENT_POLL_SECONDS: z.coerce.number().int().min(2).default(5),
  SUBSCRIPTION_POLL_SECONDS: z.coerce.number().int().min(2).default(5),
  DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(90),
  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Config = z.infer<typeof envSchema>;

export function loadLocalEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
