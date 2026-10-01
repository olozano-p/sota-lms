/**
 * The service API's contract, defined once: each schema validates the request or response in the
 * dispatcher and is turned into the OpenAPI document by `openapi.ts` (docs/integration.md).
 */
import { z } from "zod";
import { COURSE_STATUSES, ENROLLMENT_STATUSES } from "~/db/schema";

const instant = z.iso.datetime({ offset: true });

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string().describe("Stable machine-readable code, e.g. course_not_found."),
      message: z.string(),
      issues: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe("Validation problems, one per offending field."),
    }),
  })
  .meta({ id: "Error" });

/** Headers of an authenticated call; the signature pair is required only when WEBHOOK_HMAC_SECRET is set. */
export const authHeaders = z.object({
  "X-Timestamp": z
    .string()
    .optional()
    .describe("Unix seconds. Required with a signature; must be within 5 minutes of the server."),
  "X-Signature": z
    .string()
    .optional()
    .describe(
      'hex HMAC-SHA256 of "{X-Timestamp}.{METHOD}.{path}.{raw body}" with WEBHOOK_HMAC_SECRET. Required when the server has a secret.',
    ),
});

export const externalIdParams = z.object({
  external_id: z
    .string()
    .min(1)
    .max(200)
    .describe("The caller's own id for this enrollment; the idempotency key."),
});

export const putEnrollmentBody = z
  .object({
    user: z
      .object({
        sub: z.string().min(1).max(255).optional().describe("The user's OIDC subject."),
        email: z.email().optional().describe("Used when the user has not signed in yet."),
        name: z.string().min(1).max(200).optional().describe("Display name of a new placeholder."),
      })
      .refine((u) => u.sub || u.email, { message: "user.sub or user.email is required" }),
    course: z.string().min(1).describe("Course slug or external_ref."),
    cohort: z.string().min(1).nullish().describe("Cohort slug or external_ref, of that course."),
    valid_from: instant.nullish().describe("Defaults to now on creation; kept on later calls."),
    valid_until: instant
      .nullish()
      .describe("Exclusive end of access; absent or null is open-ended."),
  })
  .refine(
    (b) => !b.valid_from || !b.valid_until || new Date(b.valid_until) > new Date(b.valid_from),
    {
      message: "valid_until must be after valid_from",
      path: ["valid_until"],
    },
  )
  .meta({ id: "PutEnrollmentRequest" });

const ref = z.object({ slug: z.string(), external_ref: z.string().nullable() });

export const enrollmentResource = z
  .object({
    external_id: z.string(),
    course: ref,
    cohort: ref.nullable(),
    user: z.object({
      sub: z.string().nullable(),
      email: z.string(),
      pending: z.boolean().describe("True until the person has signed in for the first time."),
    }),
    status: z.enum(ENROLLMENT_STATUSES),
    valid_from: instant,
    valid_until: instant.nullable(),
  })
  .meta({ id: "Enrollment" });

export const putEnrollmentResponse = z.object({
  enrollment: enrollmentResource,
  created: z.boolean(),
  changed: z.boolean().describe("False when the call repeated the stored state."),
});

export const deleteEnrollmentResponse = z.object({
  external_id: z.string(),
  found: z.boolean(),
  changed: z.boolean(),
  status: z.literal("revoked"),
});

export const courseList = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      external_ref: z.string().nullable(),
      title: z.string(),
      status: z.enum(COURSE_STATUSES),
    }),
  ),
});

export const subParams = z.object({ sub: z.string().min(1).describe("The user's OIDC subject.") });

export const progressResponse = z.object({
  user: z.object({ sub: z.string(), email: z.string(), name: z.string() }),
  courses: z.array(
    z.object({
      slug: z.string(),
      external_ref: z.string().nullable(),
      title: z.string(),
      lessons_total: z.number().int(),
      lessons_completed: z.number().int(),
      ratio: z.number().describe("Completed over published lessons, 0 to 1."),
      last_activity_at: instant.nullable(),
      completed_at: instant
        .nullable()
        .describe("When the last published lesson was completed; null until all are."),
    }),
  ),
});

export const healthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  /** The package version of the running build. */
  version: z.string(),
  db: z.enum(["ok", "unreachable"]),
  /** Round trip of `select 1`; for an unreachable database, how long the attempt took. */
  dbLatencyMs: z.number().int().nonnegative(),
});

export const openApiDocument = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({}),
  paths: z.record(z.string(), z.unknown()),
});
