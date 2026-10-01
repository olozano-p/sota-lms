/**
 * Exhaustive matrix for `canSeeLesson`: course status × lesson status × enrollment status ×
 * validity window × cohort drip. If a case here changes, an ADR or the spec changed first.
 */
import { describe, expect, it } from "vitest";
import {
  canSeeLesson,
  isEnrolled,
  type AccessInput,
  type Decision,
  type EnrollmentFact,
} from "../src/server/access/rules.ts";

const TZ = "Europe/Madrid";
const NOW = new Date("2026-09-11T10:00:00Z");
const course = { slug: "c1", status: "published" as const };
const lesson = { id: "l1", chapterId: "ch1", status: "published" as const };

function enrollment(over: Partial<EnrollmentFact> = {}): EnrollmentFact {
  return {
    courseSlug: "c1",
    status: "active",
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null,
    ...over,
  };
}

function decide(over: Partial<AccessInput>): Decision {
  return canSeeLesson({
    now: NOW,
    timeZone: TZ,
    course,
    lesson,
    enrollments: [enrollment()],
    cohorts: [],
    privileged: false,
    ...over,
  });
}

describe("publish state", () => {
  it("blocks draft courses and draft lessons before looking at enrollments", () => {
    expect(decide({ course: { ...course, status: "draft" } })).toEqual({
      ok: false,
      reason: "course_not_published",
    });
    expect(decide({ lesson: { ...lesson, status: "draft" } })).toEqual({
      ok: false,
      reason: "lesson_not_published",
    });
    expect(decide({ course: { ...course, status: "draft" }, enrollments: [] })).toEqual({
      ok: false,
      reason: "course_not_published",
    });
  });
  it("keeps archived courses readable for enrolled people", () => {
    expect(decide({ course: { ...course, status: "archived" } })).toEqual({ ok: true });
  });
  it("lets privileged people (course teachers, admins) see everything, drafts included", () => {
    expect(
      decide({
        privileged: true,
        course: { ...course, status: "draft" },
        lesson: { ...lesson, status: "draft" },
        enrollments: [],
      }),
    ).toEqual({ ok: true });
  });
});

describe("enrollment matching", () => {
  it("requires an enrollment in this course", () => {
    expect(decide({ enrollments: [] })).toEqual({ ok: false, reason: "not_enrolled" });
    expect(decide({ enrollments: [enrollment({ courseSlug: "other" })] })).toEqual({
      ok: false,
      reason: "not_enrolled",
    });
  });
  it("treats a revoked enrollment as none", () => {
    expect(decide({ enrollments: [enrollment({ status: "revoked" })] })).toEqual({
      ok: false,
      reason: "not_enrolled",
    });
  });
});

describe("validity window", () => {
  it("is open before valid_until and closed from that instant on", () => {
    const until = new Date("2026-09-11T10:00:01Z");
    expect(decide({ enrollments: [enrollment({ validUntil: until })] })).toEqual({ ok: true });
    expect(decide({ enrollments: [enrollment({ validUntil: NOW })] })).toEqual({
      ok: false,
      reason: "expired",
      expiredOn: "2026-09-11",
    });
  });
  it("names the day in the deployment's zone", () => {
    const d = decide({
      enrollments: [enrollment({ validUntil: new Date("2026-09-10T22:30:00Z") })],
    });
    expect(d).toEqual({ ok: false, reason: "expired", expiredOn: "2026-09-11" });
  });
  it("opens exactly at valid_from", () => {
    const from = new Date("2026-09-20T08:00:00Z");
    expect(decide({ enrollments: [enrollment({ validFrom: from })] })).toEqual({
      ok: false,
      reason: "not_yet_released",
      availableAt: from,
    });
    expect(decide({ enrollments: [enrollment({ validFrom: NOW })] })).toEqual({ ok: true });
  });
  it("honours a stored status of expired even inside the window", () => {
    expect(decide({ enrollments: [enrollment({ status: "expired" })] })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });
  it("prefers a live enrollment over an expired one", () => {
    expect(
      decide({
        enrollments: [enrollment({ validUntil: new Date("2026-01-31T00:00:00Z") }), enrollment()],
      }),
    ).toEqual({ ok: true });
  });
  it("reports the latest lapse when every enrollment has ended", () => {
    const d = decide({
      enrollments: [
        enrollment({ validUntil: new Date("2026-03-01T12:00:00Z") }),
        enrollment({ validUntil: new Date("2026-05-01T12:00:00Z") }),
      ],
    });
    expect(d).toEqual({ ok: false, reason: "expired", expiredOn: "2026-05-01" });
  });
  it("shows an upcoming renewal rather than the lapse before it", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const d = decide({
      enrollments: [
        enrollment({ validUntil: new Date("2026-06-01T00:00:00Z") }),
        enrollment({ validFrom: from }),
      ],
    });
    expect(d).toEqual({ ok: false, reason: "not_yet_released", availableAt: from });
  });
});

describe("cohort drip", () => {
  const future = new Date("2026-09-20T08:00:00Z");
  const past = new Date("2026-09-01T08:00:00Z");
  it("locks a lesson until its chapter's release", () => {
    expect(
      decide({
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: false, reason: "not_yet_released", availableAt: future });
    expect(
      decide({
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: past }] },
        ],
      }),
    ).toEqual({ ok: true });
  });
  it("lets a lesson-level release override the chapter's", () => {
    const releases = [
      { chapterId: "ch1", lessonId: null, releaseAt: future },
      { chapterId: null, lessonId: "l1", releaseAt: past },
    ];
    expect(decide({ cohorts: [{ slug: "g1", releases }] })).toEqual({ ok: true });
  });
  it("leaves unscheduled lessons to the enrollment alone", () => {
    expect(
      decide({
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "other", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: true });
  });
  it("never opens earlier than the enrollment's valid_from", () => {
    const from = new Date("2026-09-30T22:00:00Z");
    const d = decide({
      enrollments: [enrollment({ validFrom: from })],
      cohorts: [{ slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: past }] }],
    });
    expect(d).toEqual({ ok: false, reason: "not_yet_released", availableAt: from });
  });
  it("uses the earliest schedule when a person is in several cohorts", () => {
    const cohorts = [
      { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
      { slug: "g2", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: past }] },
    ];
    expect(decide({ cohorts })).toEqual({ ok: true });
  });
  it("does not drip at course level", () => {
    expect(
      decide({
        lesson: null,
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: true });
  });
});

describe("isEnrolled (catalogue)", () => {
  const base = { now: NOW, timeZone: TZ, course, cohorts: [], privileged: false };
  it("counts not-yet-started access as enrolled", () => {
    expect(
      isEnrolled({
        ...base,
        enrollments: [enrollment({ validFrom: new Date("2026-12-01T00:00:00Z") })],
      }),
    ).toBe(true);
  });
  it("excludes expired, revoked and absent enrollments", () => {
    expect(
      isEnrolled({
        ...base,
        enrollments: [enrollment({ validUntil: new Date("2020-01-01T00:00:00Z") })],
      }),
    ).toBe(false);
    expect(isEnrolled({ ...base, enrollments: [enrollment({ status: "revoked" })] })).toBe(false);
    expect(isEnrolled({ ...base, enrollments: [] })).toBe(false);
  });
  it("includes privileged people", () => {
    expect(isEnrolled({ ...base, privileged: true, enrollments: [] })).toBe(true);
  });
});
