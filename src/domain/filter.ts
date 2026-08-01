import type { GuildSettings, Job } from "../db/schema.js";

export interface JobFilter {
  programs: string[];
  cycles: string[];
  keywords: string[];
  locations: string[];
  requireLink: boolean;
  remoteOnly?: boolean;
  sponsorship?: string;
}

function includesAny(haystack: string, needles: string[]): boolean {
  const normalized = haystack.toLocaleLowerCase("en-US");
  return needles.length === 0 || needles.some((needle) => normalized.includes(needle));
}

export function normalizeCsv(value: string | null | undefined, limit = 10): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLocaleLowerCase("en-US"))
        .filter((item) => item.length > 0)
        .slice(0, limit),
    ),
  ];
}

export function matchesFilter(job: Job, filter: JobFilter): boolean {
  if (job.status !== "open") return false;
  if (filter.requireLink && job.url === null) return false;
  if (filter.programs.length > 0 && !filter.programs.includes(job.program)) return false;
  if (filter.cycles.length > 0 && !filter.cycles.includes(job.cycle.toLocaleLowerCase("en-US"))) {
    return false;
  }
  if (!includesAny(`${job.company} ${job.title}`, filter.keywords)) return false;
  if (!includesAny(job.location, filter.locations)) return false;
  if (filter.remoteOnly && !/\bremote\b/i.test(job.location)) return false;
  if (filter.sponsorship && filter.sponsorship !== "any") {
    const sponsorship = (job.sponsorship ?? "").toLocaleLowerCase("en-US");
    const restrictive = /(no-sponsorship|does not offer|citizens-only|citizenship)/.test(
      sponsorship,
    );
    if (
      filter.sponsorship === "offers" &&
      (restrictive || !/(^|\b)(offers|sponsor)/.test(sponsorship))
    ) {
      return false;
    }
    if (
      filter.sponsorship === "no-sponsorship" &&
      !/(no-sponsorship|does not offer|citizens-only|citizenship)/.test(sponsorship)
    ) {
      return false;
    }
  }
  return true;
}

export function settingsToFilter(settings: GuildSettings): JobFilter {
  return {
    programs: settings.programs,
    cycles: settings.cycles,
    keywords: settings.keywords,
    locations: settings.locations,
    sponsorship: settings.sponsorship,
    requireLink: settings.requireLink,
    remoteOnly: settings.remoteOnly,
  };
}
