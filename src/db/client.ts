import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Logger } from "../logger.js";
import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string, logger: Logger, maxConnections = 5) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "stentor",
  });
  pool.on("error", (error) => logger.error({ error }, "Unexpected PostgreSQL pool error"));
  return { db: drizzle(pool, { schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
