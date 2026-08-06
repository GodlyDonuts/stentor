import { describe, expect, it } from "vitest";
import { keryxPayloadSchema } from "../src/domain/keryx.js";

const canonicalListing = {
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
  sources: [{ id: "ats:example", label: "Source", url: "https://example.com" }],
  url_fingerprint: "abc",
};

const academicEligibility = {
  extractor_version: 1,
  status: "explicit-window",
  summary: "Dec 2026–Jun 2027",
  confidence: "direct-ats",
  checked_at: "2026-08-06",
  source_id: "ats:example",
  source_label: "Source",
  requirement_level: "required",
  evidence: "Candidates must graduate between December 2026 and June 2027.",
  graduation_evidence: "Candidates must graduate between December 2026 and June 2027.",
  graduation_years: [2026, 2027],
  graduation_start: "2026-12",
  graduation_end: "2027-06",
};

describe("Keryx schema", () => {
  it("accepts a canonical listing", () => {
    const result = keryxPayloadSchema.safeParse({
      schema_version: 1,
      country: "United States",
      additive_metadata: "accepted",
      jobs: [
        {
          ...canonicalListing,
          additive_job_metadata: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects listings outside the expected country and programs", () => {
    expect(
      keryxPayloadSchema.safeParse({ schema_version: 1, country: "Canada", jobs: [] }).success,
    ).toBe(false);
  });

  it("accepts Keryx v2 academic eligibility and preserves its provenance", () => {
    const result = keryxPayloadSchema.safeParse({
      schema_version: 2,
      country: "United States",
      jobs: [{ ...canonicalListing, academic_eligibility: academicEligibility }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobs[0]?.academic_eligibility).toMatchObject({
        status: "explicit-window",
        requirement_level: "required",
        source_id: "ats:example",
      });
    }
  });

  it("accepts v2 records when posting text is unavailable", () => {
    expect(
      keryxPayloadSchema.safeParse({
        schema_version: 2,
        country: "United States",
        jobs: [
          {
            ...canonicalListing,
            academic_eligibility: {
              extractor_version: 1,
              status: "unavailable",
              summary: "Posting text unavailable",
              confidence: "metadata-only",
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects incomplete v2 records and future breaking schema versions", () => {
    expect(
      keryxPayloadSchema.safeParse({
        schema_version: 2,
        country: "United States",
        jobs: [canonicalListing],
      }).success,
    ).toBe(false);
    expect(
      keryxPayloadSchema.safeParse({ schema_version: 3, country: "United States", jobs: [] })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate IDs before they reach PostgreSQL", () => {
    const listing = { ...canonicalListing, id: "job_duplicate" };
    expect(
      keryxPayloadSchema.safeParse({
        schema_version: 1,
        country: "United States",
        jobs: [listing, listing],
      }).success,
    ).toBe(false);
  });
});
