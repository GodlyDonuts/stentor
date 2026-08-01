import { describe, expect, it } from "vitest";
import { keryxPayloadSchema } from "../src/domain/keryx.js";

describe("Keryx schema", () => {
  it("accepts a canonical listing", () => {
    const result = keryxPayloadSchema.safeParse({
      country: "United States",
      jobs: [
        {
          id: "job_123abc",
          company: "Acme",
          title: "Software Intern",
          location: "Remote, US",
          program: "internship",
          cycle: "summer-2027",
          status: "open",
          url: "https://jobs.example.com/1",
          url_host: "jobs.example.com",
          link_status: "ats-verified",
          sponsorship: null,
          first_seen: "2026-08-01",
          posted_at: null,
          closed_at: null,
          last_changed: "2026-08-01",
          missed_runs: 0,
          sources: [{ id: "source", label: "Source", url: "https://example.com" }],
          url_fingerprint: "abc",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects listings outside the expected country and programs", () => {
    expect(keryxPayloadSchema.safeParse({ country: "Canada", jobs: [] }).success).toBe(false);
  });

  it("rejects duplicate IDs before they reach PostgreSQL", () => {
    const listing = {
      id: "job_duplicate",
      company: "Acme",
      title: "Engineer",
      location: "Remote, US",
      program: "new-grad",
      cycle: "2027",
      status: "open",
      url: null,
      url_host: "example.com",
      link_status: "unverified",
      sponsorship: null,
      first_seen: "2026-08-01",
      posted_at: null,
      closed_at: null,
      last_changed: "2026-08-01",
      missed_runs: 0,
      sources: [{ id: "source", label: "Source", url: "https://example.com" }],
      url_fingerprint: "abc",
    };
    expect(
      keryxPayloadSchema.safeParse({ country: "United States", jobs: [listing, listing] }).success,
    ).toBe(false);
  });
});
