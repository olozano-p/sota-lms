/**
 * Exhaustive matrix for `canSeeLesson`: rule type × course status × lesson status × entitlement
 * scope × `until` × cohort drip. If a case here changes, an ADR or the spec changed first.
 */
import { describe, expect, it } from "vitest";
import {
  canSeeLesson,
  isEntitled,
  type AccessInput,
  type Decision,
} from "../src/server/access/rules.ts";

const TZ = "Europe/Madrid";
const NOW = new Date("2026-09-11T10:00:00Z");
const rules: AccessInput["rules"] = {
  immediate: { type: "immediate" },
  delayed: { type: "delayed_after_course_end", days: 30 },
  fixed: { type: "fixed_date", date: "2026-10-01" },
};
const course = { slug: "c1", status: "published" as const, endedAt: null };
const lesson = { id: "l1", chapterId: "ch1", status: "published" as const };

function decide(over: Partial<AccessInput>): Decision {
  return canSeeLesson({
    now: NOW,
    timeZone: TZ,
    rules,
    course,
    lesson,
    entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: null }],
    cohorts: [],
    privileged: false,
    ...over,
  });
}

describe("publish state", () => {
  it("blocks draft courses and draft lessons before looking at entitlements", () => {
    expect(decide({ course: { ...course, status: "draft" } })).toEqual({
      ok: false,
      reason: "course_not_published",
    });
    expect(decide({ lesson: { ...lesson, status: "draft" } })).toEqual({
      ok: false,
      reason: "lesson_not_published",
    });
    expect(decide({ course: { ...course, status: "draft" }, entitlements: [] })).toEqual({
      ok: false,
      reason: "course_not_published",
    });
  });
  it("keeps archived courses readable for entitled people", () => {
    expect(decide({ course: { ...course, status: "archived" } })).toEqual({ ok: true });
  });
  it("lets privileged people (course teachers, admins) see everything, drafts included", () => {
    expect(
      decide({
        privileged: true,
        course: { ...course, status: "draft" },
        lesson: { ...lesson, status: "draft" },
        entitlements: [],
      }),
    ).toEqual({ ok: true });
  });
});

describe("entitlement matching", () => {
  it("requires a matching scope", () => {
    expect(decide({ entitlements: [] })).toEqual({ ok: false, reason: "not_entitled" });
    expect(
      decide({ entitlements: [{ scope: "course", ref: "other", rule: "immediate", until: null }] }),
    ).toEqual({ ok: false, reason: "not_entitled" });
    expect(
      decide({
        entitlements: [{ scope: "all_courses", ref: null, rule: "immediate", until: null }],
      }),
    ).toEqual({ ok: true });
  });
  it("matches cohort scope only through membership of a cohort of this course", () => {
    const e = [{ scope: "cohort" as const, ref: "g1", rule: "immediate", until: null }];
    expect(decide({ entitlements: e })).toEqual({ ok: false, reason: "not_entitled" });
    expect(decide({ entitlements: e, cohorts: [{ slug: "g1", releases: [] }] })).toEqual({
      ok: true,
    });
    expect(decide({ entitlements: e, cohorts: [{ slug: "g2", releases: [] }] })).toEqual({
      ok: false,
      reason: "not_entitled",
    });
  });
  it("reports unknown rule keys instead of granting access", () => {
    expect(
      decide({ entitlements: [{ scope: "course", ref: "c1", rule: "gold_tier", until: null }] }),
    ).toEqual({ ok: false, reason: "unknown_rule" });
  });
});

describe("until", () => {
  it("is inclusive of the last day in the configured zone", () => {
    expect(
      decide({
        entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: "2026-09-11" }],
      }),
    ).toEqual({ ok: true });
    expect(
      decide({
        entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: "2026-09-10" }],
      }),
    ).toEqual({ ok: false, reason: "expired", expiredOn: "2026-09-10" });
  });
  it("uses the zone's calendar, not UTC", () => {
    // 23:30 UTC on the 10th is already the 11th in Madrid.
    const late = new Date("2026-09-10T23:30:00Z");
    expect(
      decide({
        now: late,
        entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: "2026-09-10" }],
      }),
    ).toEqual({ ok: false, reason: "expired", expiredOn: "2026-09-10" });
  });
  it("prefers a live entitlement over an expired one", () => {
    expect(
      decide({
        entitlements: [
          { scope: "course", ref: "c1", rule: "immediate", until: "2020-01-01" },
          { scope: "all_courses", ref: null, rule: "immediate", until: null },
        ],
      }),
    ).toEqual({ ok: true });
  });
});

describe("rule types", () => {
  it("immediate opens at once", () => {
    expect(decide({})).toEqual({ ok: true });
  });
  it("fixed_date opens at local midnight of the date", () => {
    const e = [{ scope: "course" as const, ref: "c1", rule: "fixed", until: null }];
    expect(decide({ entitlements: e })).toEqual({
      ok: false,
      reason: "not_yet_released",
      availableAt: new Date("2026-09-30T22:00:00Z"),
    });
    expect(decide({ entitlements: e, now: new Date("2026-09-30T22:00:00Z") })).toEqual({
      ok: true,
    });
    expect(decide({ entitlements: e, now: new Date("2026-09-30T21:59:59Z") }).ok).toBe(false);
  });
  it("delayed_after_course_end waits for the course to end, then N days", () => {
    const e = [{ scope: "all_courses" as const, ref: null, rule: "delayed", until: null }];
    expect(decide({ entitlements: e })).toEqual({ ok: false, reason: "awaiting_course_end" });
    const ended = { ...course, endedAt: "2026-07-31" };
    // 2026-07-31 00:00 Madrid = 07-30 22:00Z; + 30 days = 08-29 22:00Z
    expect(
      decide({ entitlements: e, course: ended, now: new Date("2026-08-29T21:59:00Z") }),
    ).toEqual({
      ok: false,
      reason: "not_yet_released",
      availableAt: new Date("2026-08-29T22:00:00Z"),
    });
    expect(
      decide({ entitlements: e, course: ended, now: new Date("2026-08-29T22:00:00Z") }),
    ).toEqual({ ok: true });
  });
  it("takes the earliest availability across several live entitlements", () => {
    expect(
      decide({
        entitlements: [
          { scope: "all_courses", ref: null, rule: "delayed", until: null },
          { scope: "course", ref: "c1", rule: "immediate", until: null },
        ],
      }),
    ).toEqual({ ok: true });
  });
});

describe("cohort drip", () => {
  const member = [{ scope: "cohort" as const, ref: "g1", rule: "immediate", until: null }];
  const future = new Date("2026-09-20T08:00:00Z");
  const past = new Date("2026-09-01T08:00:00Z");
  it("locks a lesson until its chapter's release", () => {
    expect(
      decide({
        entitlements: member,
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: false, reason: "not_yet_released", availableAt: future });
    expect(
      decide({
        entitlements: member,
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
    expect(decide({ entitlements: member, cohorts: [{ slug: "g1", releases }] })).toEqual({
      ok: true,
    });
  });
  it("leaves unscheduled lessons to the entitlement alone", () => {
    expect(
      decide({
        entitlements: member,
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "other", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: true });
  });
  it("applies drip to any member, whatever the entitlement scope", () => {
    expect(
      decide({
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: false, reason: "not_yet_released", availableAt: future });
  });
  it("never opens earlier than the entitlement rule", () => {
    const fixed = [{ scope: "course" as const, ref: "c1", rule: "fixed", until: null }];
    const d = decide({
      entitlements: fixed,
      cohorts: [{ slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: past }] }],
    });
    expect(d).toEqual({
      ok: false,
      reason: "not_yet_released",
      availableAt: new Date("2026-09-30T22:00:00Z"),
    });
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
        entitlements: member,
        cohorts: [
          { slug: "g1", releases: [{ chapterId: "ch1", lessonId: null, releaseAt: future }] },
        ],
      }),
    ).toEqual({ ok: true });
  });
});

describe("isEntitled (catalogue)", () => {
  const base = { now: NOW, timeZone: TZ, rules, course, cohorts: [], privileged: false };
  it("counts delayed and not-yet-released access as entitled", () => {
    expect(
      isEntitled({
        ...base,
        entitlements: [{ scope: "all_courses", ref: null, rule: "delayed", until: null }],
      }),
    ).toBe(true);
    expect(
      isEntitled({
        ...base,
        entitlements: [{ scope: "course", ref: "c1", rule: "fixed", until: null }],
      }),
    ).toBe(true);
  });
  it("excludes expired, unmatched and draft", () => {
    expect(
      isEntitled({
        ...base,
        entitlements: [{ scope: "course", ref: "c1", rule: "immediate", until: "2020-01-01" }],
      }),
    ).toBe(false);
    expect(isEntitled({ ...base, entitlements: [] })).toBe(false);
    expect(
      isEntitled({
        ...base,
        course: { ...course, status: "draft" },
        entitlements: [{ scope: "all_courses", ref: null, rule: "immediate", until: null }],
      }),
    ).toBe(false);
  });
});
