import { describe, expect, it } from "vitest";
import { nextDigestAt } from "../src/domain/schedule.js";

describe("nextDigestAt", () => {
  it("schedules the requested local hour across the spring DST boundary", () => {
    expect(nextDigestAt("America/New_York", 9, new Date("2026-03-08T12:00:00Z"))).toEqual(
      new Date("2026-03-08T13:00:00Z"),
    );
  });

  it("schedules the requested local hour across the fall DST boundary", () => {
    expect(nextDigestAt("America/New_York", 9, new Date("2026-11-01T12:00:00Z"))).toEqual(
      new Date("2026-11-01T14:00:00Z"),
    );
  });

  it("moves to the next local calendar day after today's delivery hour", () => {
    expect(nextDigestAt("America/Los_Angeles", 9, new Date("2026-08-01T20:00:00Z"))).toEqual(
      new Date("2026-08-02T16:00:00Z"),
    );
  });

  it("rejects an invalid hour", () => {
    expect(() => nextDigestAt("UTC", 24)).toThrow("0–23");
  });
});
