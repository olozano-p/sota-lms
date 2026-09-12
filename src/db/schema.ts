/**
 * Application tables (docs/spec.md §4). Conventions: snake_case columns, camelCase properties,
 * UUID v7 ids generated in the app, `timestamptz` instants, `date` for calendar dates, `jsonb`
 * payloads. No table or column carries an organisation-specific name.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

// ---------- Identity mirror ----------

export const ROLES = ["student", "teacher", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Mirror of the IdP user. Written only from IdP/entitlement data. */
export const person = pgTable("person", {
  id: id(),
  idpSub: text("idp_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  locale: text("locale"),
  roles: text("roles")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Last successful pull or push from the entitlement source; drives the 15-minute TTL. */
  entitlementsSyncedAt: timestamp("entitlements_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** SOTA's own session: opaque id in the cookie, expiry enforced here (12 h absolute, 2 h idle). */
export const session = pgTable(
  "session",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    /** Passed as `id_token_hint` to the IdP's end-session endpoint on logout. */
    idTokenHint: text("id_token_hint"),
    /** Snapshot of the roles at creation; a change on sync rotates the session. */
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [index("session_person_idx").on(t.personId)],
);

export const ENTITLEMENT_SCOPES = ["course", "all_courses", "cohort"] as const;
export type EntitlementScope = (typeof ENTITLEMENT_SCOPES)[number];
export const ENTITLEMENT_SOURCES = ["external", "admin"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const entitlement = pgTable(
  "entitlement",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ENTITLEMENT_SCOPES }).notNull(),
    /** Course or cohort slug; null for `all_courses`. Stored as "" in the unique key's eyes via coalesce. */
    ref: text("ref"),
    /** Key into `lms.config.ts → accessRules`. */
    rule: text("rule").notNull(),
    until: date("until"),
    source: text("source", { enum: ENTITLEMENT_SOURCES }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("entitlement_person_scope_ref_source_idx").on(
      t.personId,
      t.scope,
      sql`coalesce(${t.ref}, '')`,
      t.source,
    ),
    index("entitlement_person_idx").on(t.personId),
  ],
);

// ---------- Catalogue ----------

export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const course = pgTable("course", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  descriptionMd: text("description_md").notNull().default(""),
  /** Content language of the course (one per course in v1). */
  language: text("language").notNull(),
  coverImageKey: text("cover_image_key"),
  status: text("status", { enum: COURSE_STATUSES }).notNull().default("draft"),
  /** Date live delivery ended; input to `delayed_after_course_end`. */
  endedAt: date("ended_at"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const courseTeacher = pgTable(
  "course_teacher",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.personId] })],
);

export const chapter = pgTable(
  "chapter",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("chapter_course_slug_idx").on(t.courseId, t.slug)],
);

export const LESSON_STATUSES = ["draft", "published"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const lesson = pgTable(
  "lesson",
  {
    id: id(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sort: integer("sort").notNull().default(0),
    status: text("status", { enum: LESSON_STATUSES }).notNull().default("draft"),
    estimatedMinutes: integer("estimated_minutes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("lesson_chapter_slug_idx").on(t.chapterId, t.slug)],
);

export const BLOCK_TYPES = [
  "text",
  "video",
  "audio",
  "file",
  "assignment",
  "quiz",
  "embed",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Discriminated payloads per block type; validated with Zod in src/server/services/blocks.ts. */
export type BlockPayload =
  | { type: "text"; md: string }
  | {
      type: "video";
      provider: string;
      external_id: string;
      title: string;
      duration_s: number | null;
      thumbnail_url?: string | null;
    }
  | { type: "audio"; file_key: string; title: string; duration_s: number | null }
  | { type: "file"; file_key: string; title: string; mime: string; size: number }
  | { type: "assignment"; assignment_id: string }
  | { type: "quiz"; quiz_id: string }
  | { type: "embed"; url: string; title?: string | null };

export const lessonBlock = pgTable(
  "lesson_block",
  {
    id: id(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    type: text("type", { enum: BLOCK_TYPES }).notNull(),
    payload: jsonb("payload").$type<Omit<BlockPayload, "type">>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lesson_block_lesson_idx").on(t.lessonId, t.sort)],
);

export const file = pgTable("file", {
  id: id(),
  key: text("key").notNull().unique(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => person.id, { onDelete: "set null" }),
  sha256: text("sha256"),
  createdAt: createdAt(),
});

// ---------- Assignments ----------

export const SUBMISSION_TYPES = ["text", "file", "both"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export const assignment = pgTable("assignment", {
  id: id(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => course.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instructionsMd: text("instructions_md").notNull().default(""),
  submissionType: text("submission_type", { enum: SUBMISSION_TYPES }).notNull().default("both"),
  allowResubmit: boolean("allow_resubmit").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const SUBMISSION_STATUSES = ["submitted", "reviewed", "returned"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const submission = pgTable(
  "submission",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignment.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    textMd: text("text_md"),
    fileKey: text("file_key"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status", { enum: SUBMISSION_STATUSES }).notNull().default("submitted"),
    teacherCommentMd: text("teacher_comment_md"),
    reviewedBy: uuid("reviewed_by").references(() => person.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Set on the older row when a student resubmits. */
    supersededBy: uuid("superseded_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("submission_assignment_person_idx").on(t.assignmentId, t.personId)],
);

// ---------- Quizzes / forms ----------

export const QUIZ_KINDS = ["quiz", "form"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const quiz = pgTable("quiz", {
  id: id(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => course.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  introMd: text("intro_md").notNull().default(""),
  kind: text("kind", { enum: QUIZ_KINDS }).notNull().default("quiz"),
  showAnswersAfterSubmit: boolean("show_answers_after_submit").notNull().default(true),
  /** Percentage 0–100; null means nothing to pass (a reflective form). */
  passThreshold: real("pass_threshold"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const QUESTION_TYPES = ["single_choice", "multi_choice", "short_text", "long_text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const question = pgTable(
  "question",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    type: text("type", { enum: QUESTION_TYPES }).notNull(),
    promptMd: text("prompt_md").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("question_quiz_idx").on(t.quizId, t.sort)],
);

export const questionOption = pgTable(
  "question_option",
  {
    id: id(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    label: text("label").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
  },
  (t) => [index("question_option_question_idx").on(t.questionId, t.sort)],
);

export const quizAttempt = pgTable(
  "quiz_attempt",
  {
    id: id(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Percentage over the auto-gradable questions; null when there are none. */
    score: real("score"),
    passed: boolean("passed"),
  },
  (t) => [index("quiz_attempt_quiz_person_idx").on(t.quizId, t.personId)],
);

export const quizAnswer = pgTable(
  "quiz_answer",
  {
    id: id(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempt.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    optionIds: uuid("option_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    text: text("text"),
  },
  (t) => [uniqueIndex("quiz_answer_attempt_question_idx").on(t.attemptId, t.questionId)],
);

// ---------- Cohorts and release ----------

export const COHORT_STATUSES = ["upcoming", "active", "closed"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

export const cohort = pgTable("cohort", {
  id: id(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => course.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  startsAt: date("starts_at"),
  endsAt: date("ends_at"),
  status: text("status", { enum: COHORT_STATUSES }).notNull().default("upcoming"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const COHORT_ROLES = ["student", "teacher"] as const;
export type CohortRole = (typeof COHORT_ROLES)[number];

export const cohortMember = pgTable(
  "cohort_member",
  {
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohort.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    role: text("role", { enum: COHORT_ROLES }).notNull().default("student"),
  },
  (t) => [primaryKey({ columns: [t.cohortId, t.personId] })],
);

/** Drip schedule: exactly one of chapter_id / lesson_id is set. */
export const cohortRelease = pgTable(
  "cohort_release",
  {
    id: id(),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohort.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapter.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => lesson.id, { onDelete: "cascade" }),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    /** Set once the "chapter released" notification went out. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("cohort_release_cohort_idx").on(t.cohortId),
    check(
      "cohort_release_one_target",
      sql`(${t.chapterId} is not null) <> (${t.lessonId} is not null)`,
    ),
  ],
);

// ---------- Progress ----------

export const PROGRESS_STATUSES = ["started", "completed"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    status: text("status", { enum: PROGRESS_STATUSES }).notNull().default("started"),
    lastBlockSort: integer("last_block_sort"),
    mediaPositionS: real("media_position_s"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.lessonId] })],
);

// ---------- Ops ----------

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: id(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("webhook_event_received_idx").on(t.receivedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorPersonId: uuid("actor_person_id").references(() => person.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
  ],
);

/** Queued notifications; feedback goes out at once, the rest in the daily digest. */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    immediate: boolean("immediate").notNull().default(false),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("notification_pending_idx").on(t.sentAt, t.personId)],
);
