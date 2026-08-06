import { z } from "zod";

const nullableDate = z.iso.date().nullable();
const requirementLevelSchema = z.enum(["required", "preferred", "stated"]);
const academicStatusSchema = z.enum([
  "explicit-date",
  "explicit-window",
  "explicit-lower-bound",
  "explicit-upper-bound",
  "student-status",
  "not-found",
  "unavailable",
]);
const academicEvidenceSchema = z.string().min(1).max(280);
const graduationBoundarySchema = z.string().regex(/^20\d{2}(?:-\d{2})?$/);

/** Keryx schema v2's provenance-aware academic eligibility record. */
export const academicEligibilitySchema = z
  .object({
    extractor_version: z.number().int().positive(),
    status: academicStatusSchema,
    summary: z.string().min(1).max(160),
    confidence: z.enum(["direct-ats", "source-text", "metadata-only"]),
    checked_at: z.iso.date().optional(),
    source_id: z.string().min(1).optional(),
    source_label: z.string().min(1).max(300).optional(),
    requirement_level: requirementLevelSchema.optional(),
    evidence: academicEvidenceSchema.optional(),
    graduation_evidence: academicEvidenceSchema.optional(),
    graduation_years: z.array(z.number().int().min(2000).max(2099)).max(10).optional(),
    graduation_start: graduationBoundarySchema.optional(),
    graduation_end: graduationBoundarySchema.optional(),
    currently_enrolled: z.boolean().optional(),
    currently_enrolled_level: requirementLevelSchema.optional(),
    currently_enrolled_evidence: academicEvidenceSchema.optional(),
    return_to_school: z.boolean().optional(),
    return_to_school_level: requirementLevelSchema.optional(),
    return_to_school_evidence: academicEvidenceSchema.optional(),
  })
  .passthrough()
  .superRefine((eligibility, context) => {
    const isExplicit = eligibility.status.startsWith("explicit-");
    if (isExplicit && !eligibility.requirement_level) {
      context.addIssue({
        code: "custom",
        message: "Explicit academic eligibility must include its requirement level",
        path: ["requirement_level"],
      });
    }
    if (isExplicit && !eligibility.graduation_evidence) {
      context.addIssue({
        code: "custom",
        message: "Explicit academic eligibility must include graduation evidence",
        path: ["graduation_evidence"],
      });
    }
    if (eligibility.currently_enrolled) {
      if (!eligibility.currently_enrolled_level || !eligibility.currently_enrolled_evidence) {
        context.addIssue({
          code: "custom",
          message: "Enrollment conditions must include modality and evidence",
          path: ["currently_enrolled"],
        });
      }
    }
    if (eligibility.return_to_school) {
      if (!eligibility.return_to_school_level || !eligibility.return_to_school_evidence) {
        context.addIssue({
          code: "custom",
          message: "Return-to-school conditions must include modality and evidence",
          path: ["return_to_school"],
        });
      }
    }
    if (eligibility.status === "unavailable") {
      if (
        eligibility.checked_at ||
        eligibility.source_id ||
        eligibility.confidence !== "metadata-only"
      ) {
        context.addIssue({
          code: "custom",
          message: "Unavailable academic eligibility cannot claim checked source text",
        });
      }
    } else if (
      !eligibility.checked_at ||
      !eligibility.source_id ||
      eligibility.confidence === "metadata-only"
    ) {
      context.addIssue({
        code: "custom",
        message: "Checked academic eligibility must include date and source provenance",
      });
    }
  });

const sourceSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    url: z.url(),
  })
  .passthrough();

export const keryxJobSchema = z
  .object({
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
    sources: z.array(sourceSchema),
    url_fingerprint: z.string().nullable(),
    academic_eligibility: academicEligibilitySchema.optional(),
  })
  .passthrough();

const keryxV2JobSchema = keryxJobSchema
  .safeExtend({ academic_eligibility: academicEligibilitySchema })
  .superRefine((job, context) => {
    const sourceId = job.academic_eligibility.source_id;
    if (sourceId && !job.sources.some((source) => source.id === sourceId)) {
      context.addIssue({
        code: "custom",
        message: "Academic eligibility source must be present in job sources",
        path: ["academic_eligibility", "source_id"],
      });
    }
  });

const keryxPayloadBase = z.object({
  country: z.literal("United States"),
});

export const keryxPayloadSchema = z
  .discriminatedUnion("schema_version", [
    keryxPayloadBase.extend({
      schema_version: z.literal(1),
      jobs: z.array(keryxJobSchema).max(100_000),
    }),
    keryxPayloadBase.extend({
      schema_version: z.literal(2),
      jobs: z.array(keryxV2JobSchema).max(100_000),
    }),
  ])
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

export type AcademicEligibility = z.infer<typeof academicEligibilitySchema>;
export type KeryxJob = z.infer<typeof keryxJobSchema>;
export type KeryxPayload = z.infer<typeof keryxPayloadSchema>;

export function dateAtUtcMidnight(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}
