import { z } from "zod";

const nullableDate = z.iso.date().nullable();

export const keryxJobSchema = z.object({
  id: z.string().regex(/^job_[a-z0-9]+$/),
  company: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  location: z.string().min(1).max(500),
  program: z.enum(["internship", "new-grad"]),
  cycle: z.string().min(1).max(100),
  status: z.enum(["open", "closed"]),
  url: z.url().nullable(),
  url_host: z.string().min(1).max(253).nullable(),
  link_status: z.enum(["ats-verified", "cross-source", "platform-structured", "unverified"]),
  sponsorship: z.string().max(300).nullable(),
  first_seen: z.iso.date(),
  posted_at: nullableDate,
  closed_at: nullableDate,
  last_changed: z.iso.date(),
  missed_runs: z.number().int().min(0),
  sources: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      url: z.url(),
    }),
  ),
  url_fingerprint: z.string().nullable(),
});

export const keryxPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    country: z.literal("United States"),
    jobs: z.array(keryxJobSchema).max(100_000),
  })
  .superRefine((payload, context) => {
    const ids = new Set<string>();
    for (const job of payload.jobs) {
      if (ids.has(job.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Keryx job ID: ${job.id}`,
          path: ["jobs"],
        });
        return;
      }
      ids.add(job.id);
    }
  });

export type KeryxJob = z.infer<typeof keryxJobSchema>;
export type KeryxPayload = z.infer<typeof keryxPayloadSchema>;

export function dateAtUtcMidnight(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
