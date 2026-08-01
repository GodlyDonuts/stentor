import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  DISCORD_TOKEN: "test-token",
  DISCORD_APPLICATION_ID: "1234567890",
  DATABASE_URL: "postgres://stentor:secret@localhost:5432/stentor",
};

describe("configuration", () => {
  it("applies resource-conscious production defaults", () => {
    const config = loadConfig({ ...required, NODE_ENV: "production" });

    expect(config.DB_POOL_MAX).toBe(5);
    expect(config.KERYX_POLL_SECONDS).toBe(900);
    expect(config.DELIVERY_RETENTION_DAYS).toBe(90);
    expect(config.HTTP_PORT).toBe(3000);
  });

  it("treats an empty development guild as global command registration", () => {
    const config = loadConfig({ ...required, DISCORD_DEV_GUILD_ID: "" });

    expect(config.DISCORD_DEV_GUILD_ID).toBeUndefined();
  });

  it("rejects malformed identifiers and unsafe worker intervals", () => {
    expect(() =>
      loadConfig({
        ...required,
        DISCORD_APPLICATION_ID: "not-a-snowflake",
        KERYX_POLL_SECONDS: "5",
      }),
    ).toThrow("Invalid configuration");
  });
});
