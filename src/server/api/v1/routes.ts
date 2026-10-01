/**
 * The service API registry (docs/integration.md). The dispatcher serves exactly these routes and
 * `openapi.ts` documents exactly these routes, from the same schemas.
 */
import { sql } from "drizzle-orm";
import { db } from "~/db";
import {
  putServiceEnrollment,
  revokeServiceEnrollment,
  ServiceApiError,
} from "~/server/mutations/service-enrollments-core";
import { buildOpenApi } from "./openapi";
import { listCourses, userProgress } from "./queries";
import { defineRoute, type RouteDef } from "./route";
import {
  courseList,
  deleteEnrollmentResponse,
  errorSchema,
  externalIdParams,
  healthResponse,
  openApiDocument,
  progressResponse,
  putEnrollmentBody,
  putEnrollmentResponse,
  subParams,
} from "./schemas";
import type { z } from "zod";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const unauthorized = {
  description: "Missing or wrong token, bad signature or stale timestamp.",
  schema: errorSchema,
};
const invalid = { description: "The request does not match the schema.", schema: errorSchema };

/** Liveness and database reachability; also served at `/api/health`. */
export async function healthResult() {
  try {
    await db.execute(sql`select 1`);
    return { status: 200, body: { status: "ok", db: "ok" } };
  } catch {
    return { status: 503, body: { status: "degraded", db: "unreachable" } };
  }
}

const health = defineRoute({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Liveness and database check",
  description: "No authentication. Also available while the rest of the API is disabled.",
  tags: ["Operations"],
  auth: "none",
  responses: {
    200: { description: "The server and its database answer.", schema: healthResponse },
    503: { description: "The database is unreachable.", schema: healthResponse },
  },
  handler: () => healthResult(),
});

const openapi = defineRoute({
  method: "get",
  path: "/openapi.json",
  operationId: "getOpenApiDocument",
  summary: "This document",
  description: "Generated from the route schemas; no authentication.",
  tags: ["Operations"],
  auth: "none",
  responses: { 200: { description: "The OpenAPI 3.1 document.", schema: openApiDocument } },
  handler: async () => ({ status: 200, body: buildOpenApi(routes) }),
});

const putEnrollment = defineRoute<
  z.infer<typeof externalIdParams>,
  z.infer<typeof putEnrollmentBody>
>({
  method: "put",
  path: "/enrollments/{external_id}",
  operationId: "putEnrollment",
  summary: "Create or update an enrollment",
  description:
    "Idempotent upsert of the `webhook` enrollment keyed by `external_id`. Repeating a call changes nothing; calling it after a DELETE reactivates the enrollment. In `oidc` mode an unknown user gets a placeholder person that the first sign-in adopts. `manual` and `claims` enrollments are never touched.",
  tags: ["Enrollments"],
  auth: "service",
  params: externalIdParams,
  body: putEnrollmentBody,
  responses: {
    200: { description: "Updated, or already in that state.", schema: putEnrollmentResponse },
    201: { description: "Created.", schema: putEnrollmentResponse },
    401: unauthorized,
    404: { description: "Unknown course, cohort or (in local mode) user.", schema: errorSchema },
    409: {
      description:
        "external_id belongs to another user, or the user already has another enrollment for that course and cohort.",
      schema: errorSchema,
    },
    422: invalid,
  },
  handler: async ({ params, body, actor }) => {
    const r = await putServiceEnrollment(actor!, {
      externalId: params.external_id,
      user: body.user,
      course: body.course,
      cohort: body.cohort ?? null,
      validFrom: body.valid_from ? new Date(body.valid_from) : null,
      validUntil: body.valid_until ? new Date(body.valid_until) : null,
    });
    const e = r.enrollment;
    return {
      status: r.created ? 201 : 200,
      body: {
        enrollment: {
          external_id: e.externalId,
          course: { slug: e.course.slug, external_ref: e.course.externalRef },
          cohort: e.cohort && { slug: e.cohort.slug, external_ref: e.cohort.externalRef },
          user: e.user,
          status: e.status,
          valid_from: e.validFrom.toISOString(),
          valid_until: iso(e.validUntil),
        },
        created: r.created,
        changed: r.changed,
      } satisfies z.infer<typeof putEnrollmentResponse>,
    };
  },
});

const deleteEnrollment = defineRoute<z.infer<typeof externalIdParams>, undefined>({
  method: "delete",
  path: "/enrollments/{external_id}",
  operationId: "revokeEnrollment",
  summary: "Revoke an enrollment",
  description:
    "Marks the `webhook` enrollment `revoked` (kept for the history). Idempotent: an unknown or already revoked id answers 200 with `changed: false`.",
  tags: ["Enrollments"],
  auth: "service",
  params: externalIdParams,
  responses: {
    200: { description: "Revoked, or nothing to revoke.", schema: deleteEnrollmentResponse },
    401: unauthorized,
    422: invalid,
  },
  handler: async ({ params, actor }) => {
    const r = await revokeServiceEnrollment(actor!, params.external_id);
    return {
      status: 200,
      body: {
        external_id: r.externalId,
        found: r.found,
        changed: r.changed,
        status: "revoked",
      } satisfies z.infer<typeof deleteEnrollmentResponse>,
    };
  },
});

const getProgress = defineRoute<z.infer<typeof subParams>, undefined>({
  method: "get",
  path: "/users/{sub}/progress",
  operationId: "getUserProgress",
  summary: "Progress of a user",
  description:
    "Per course the user is enrolled in or has progress in: lessons completed over published lessons.",
  tags: ["Users"],
  auth: "service",
  params: subParams,
  responses: {
    200: { description: "The user's progress.", schema: progressResponse },
    401: unauthorized,
    404: { description: "No person has that sub.", schema: errorSchema },
    422: invalid,
  },
  handler: async ({ params }) => {
    const p = await userProgress(params.sub);
    if (!p) throw new ServiceApiError(404, "user_not_found", "no person has that sub");
    return {
      status: 200,
      body: {
        user: p.user,
        courses: p.courses.map((c) => ({
          slug: c.slug,
          external_ref: c.externalRef,
          title: c.title,
          lessons_total: c.lessonsTotal,
          lessons_completed: c.lessonsCompleted,
          ratio: c.ratio,
          last_activity_at: iso(c.lastActivityAt),
          completed_at: iso(c.completedAt),
        })),
      } satisfies z.infer<typeof progressResponse>,
    };
  },
});

const getCourses = defineRoute({
  method: "get",
  path: "/courses",
  operationId: "listCourses",
  summary: "List courses",
  description: "The slug and external_ref are what the enrollment calls accept as `course`.",
  tags: ["Courses"],
  auth: "service",
  responses: {
    200: { description: "All courses.", schema: courseList },
    401: unauthorized,
  },
  handler: async () => ({
    status: 200,
    body: {
      data: (await listCourses()).map((c) => ({
        slug: c.slug,
        external_ref: c.externalRef,
        title: c.title,
        status: c.status,
      })),
    } satisfies z.infer<typeof courseList>,
  }),
});

export const routes: RouteDef[] = [
  health,
  openapi,
  putEnrollment,
  deleteEnrollment,
  getProgress,
  getCourses,
];
