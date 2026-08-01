import pino from "pino";
import type { Config } from "./config.js";

export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">) {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: "stentor", environment: config.NODE_ENV },
    redact: {
      paths: ["token", "DISCORD_TOKEN", "req.headers.authorization", "databaseUrl"],
      censor: "[redacted]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
