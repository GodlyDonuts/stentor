import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv } from "../config.js";

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new pg.Client({
  connectionString: databaseUrl,
  application_name: "stentor-migrate",
});
await client.connect();
try {
  await client.query("select pg_advisory_lock(hashtext('stentor_migrations'))");
  await client.query(`
    create table if not exists stentor_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const directory = resolve(process.cwd(), "drizzle");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const appliedRows = await client.query<{ name: string }>("select name from stentor_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const source = await readFile(resolve(directory, file), "utf8");
    const statements = source
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await client.query("begin");
    try {
      for (const statement of statements) await client.query(statement);
      await client.query("insert into stentor_migrations (name) values ($1)", [file]);
      await client.query("commit");
      process.stdout.write(`Applied ${file}\n`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  if (files.every((file) => applied.has(file))) process.stdout.write("Database is current.\n");
} finally {
  await client
    .query("select pg_advisory_unlock(hashtext('stentor_migrations'))")
    .catch(() => undefined);
  await client.end();
}
