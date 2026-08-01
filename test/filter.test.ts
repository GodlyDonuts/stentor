import { describe, expect, it } from "vitest";
import type { Job } from "../src/db/schema.js";
import { matchesFilter, normalizeCsv, type JobFilter } from "../src/domain/filter.js";

const job = {
  status: "open",
  company: "Acme Robotics",
  title: "Software Engineering Intern",
  location: "New York, NY / Remote",
  program: "internship",
  cycle: "summer-2027",
  url: "https://example.com/apply",
} as Job;

const filter: JobFilter = {
  programs: [],
  cycles: [],
  keywords: [],
  locations: [],
  requireLink: false,
};

describe("job filtering", () => {
  it("accepts a job when no filters are set", () => {
    expect(matchesFilter(job, filter)).toBe(true);
  });

  it("combines filters across categories and ORs within each category", () => {
    expect(
      matchesFilter(job, {
        programs: ["internship"],
        cycles: ["summer-2027"],
        keywords: ["robotics", "security"],
        locations: ["remote", "boston"],
        requireLink: true,
      }),
    ).toBe(true);
  });

  it("rejects closed and linkless jobs", () => {
    expect(matchesFilter({ ...job, status: "closed" }, filter)).toBe(false);
    expect(matchesFilter({ ...job, url: null }, { ...filter, requireLink: true })).toBe(false);
  });

  it("supports remote and sponsorship preferences without false positives", () => {
    expect(
      matchesFilter(
        { ...job, sponsorship: "Offers Sponsorship" },
        { ...filter, remoteOnly: true, sponsorship: "offers" },
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        { ...job, sponsorship: "Does Not Offer Sponsorship" },
        { ...filter, sponsorship: "offers" },
      ),
    ).toBe(false);
    expect(
      matchesFilter(
        { ...job, sponsorship: "U.S. Citizenship is Required" },
        { ...filter, sponsorship: "no-sponsorship" },
      ),
    ).toBe(true);
  });
});

describe("normalizeCsv", () => {
  it("trims, lowercases, de-duplicates, and removes blanks", () => {
    expect(normalizeCsv(" Remote, New York, remote, , Boston ")).toEqual([
      "remote",
      "new york",
      "boston",
    ]);
  });
});
