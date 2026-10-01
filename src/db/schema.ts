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

// ---------- Identity ----------

/** Names are the stored vocabulary; the brief's learner/instructor are accepted from the IdP and mapped (ADR-016). */
export const ROLES = ["student", "teacher", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The profile row every other table references, and also the user model of better-auth (ADR-016):
 * the library writes it on signup/login, SOTA's own code writes it only through the identity
 * paths listed in CLAUDE.md. `external_sub` + `external_iss` identify the person at the IdP or the
 * enrollment source and are null for people who only exist locally.
 */
export const person = pgTable(
  "person",
  {
    id: id(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    locale: text("locale"),
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    externalSub: text("external_sub"),
    externalIss: text("external_iss"),
    emailOptOut: boolean("email_opt_out").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** Last successful pull, push or claims sync from the enrollment source; drives the 15-minute TTL. */
    entitlementsSyncedAt: timestamp("entitlements_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("person_external_identity_idx")
      .on(sql`coalesce(${t.externalIss}, '')`, t.externalSub)
      .where(sql`${t.externalSub} is not null`),
  ],
);

/** better-auth session. Absolute lifetime is enforced in `currentUser()`; the library handles idle expiry. */
export const authSession = pgTable(
  "auth_session",
  {
    id: id(),
    userId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_session_person_idx").on(t.userId)],
);

/** better-auth account: a credential (`providerId = 'credential'`, hashed password) or the OIDC link. */
export const authAccount = pgTable(
  "auth_account",
  {
    id: id(),
    userId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("auth_account_provider_idx").on(t.providerId, t.accountId),
    index("auth_account_person_idx").on(t.userId),
  ],
);

/** better-auth one-time values: magic-link tokens, password-reset tokens. */
export const authVerification = pgTable(
  "auth_verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/** Admin invitation: a one-time link (only its hash is stored) that lets the invitee set a password. */
export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => person.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("invitation_person_idx").on(t.personId)],
);

// ---------- Catalogue ----------

export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const course = pgTable("course", {
  id: id(),
  slug: text("slug").notNull().unique(),
  /** The external system's id for this course, matched by claims/webhook sync alongside the slug. */
  externalRef: text("external_ref").unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  descriptionMd: text("description_md").notNull().default(""),
  /** Content language of the course (one per course in v1). */
  language: text("language").notNull(),
  coverImageKey: text("cover_image_key"),
  status: text("status", { enum: COURSE_STATUSES }).notNull().default("draft"),
  /** Date live delivery ended. Informational: it no longer opens or closes access. */
  endedAt: date("ended_at"),
  sort: integer("sort").notNull().default(0),
  /** Teachers switch the course forum on; off, the forum routes 404 for everyone. */
  forumEnabled: boolean("forum_enabled").notNull().default(false),
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

/**
 * `form` collects answers and nothing more. `self_check` gives the learner feedback on choice
 * questions; it never grades anyone for the teacher or gates progress.
 */
export const QUIZ_KINDS = ["form", "self_check"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const quiz = pgTable(
  "quiz",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    introMd: text("intro_md").notNull().default(""),
    kind: text("kind", { enum: QUIZ_KINDS }).notNull().default("self_check"),
    showAnswersAfterSubmit: boolean("show_answers_after_submit").notNull().default(true),
    /** Percentage 0–100; null means nothing to pass (a reflective form). */
    passThreshold: real("pass_threshold"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("quiz_kind_chk", sql`${t.kind} in ('form', 'self_check')`)],
);

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
  /** The external system's id for this cohort, matched by claims/webhook sync alongside the slug. */
  externalRef: text("external_ref").unique(),
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

// ---------- Enrollment ----------

export const ENROLLMENT_SOURCES = ["manual", "claims", "webhook"] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];
export const ENROLLMENT_STATUSES = ["active", "expired", "revoked"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/**
 * Access to one course, optionally through one cohort (ADR-014). `manual` rows belong to admins;
 * `claims` and `webhook` rows are written by the sync processes and reconciled by `external_id`,
 * never touching `manual`.
 */
export const enrollment = pgTable(
  "enrollment",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").references(() => cohort.id, { onDelete: "cascade" }),
    source: text("source", { enum: ENROLLMENT_SOURCES }).notNull(),
    /** The external system's id for this enrollment; unique per source. */
    externalId: text("external_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    /** Exclusive end of access; null is open-ended. */
    validUntil: timestamp("valid_until", { withTimezone: true }),
    status: text("status", { enum: ENROLLMENT_STATUSES }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("enrollment_person_course_cohort_source_idx").on(
      t.personId,
      t.courseId,
      sql`coalesce(${t.cohortId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.source,
    ),
    uniqueIndex("enrollment_source_external_id_idx")
      .on(t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("enrollment_person_idx").on(t.personId),
    index("enrollment_course_idx").on(t.courseId),
  ],
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

/**
 * Queued notifications; feedback goes out at once, the rest in the daily digest. Account mail
 * (magic link, invitation, reset) is addressed by `to_email` because its recipient may not have a
 * person row yet; its payload is cleared once sent since it carries a one-time link.
 */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    toEmail: text("to_email"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    immediate: boolean("immediate").notNull().default(false),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("notification_pending_idx").on(t.sentAt, t.personId),
    /** The per-address throttle on account mail counts recent rows by address. */
    index("notification_to_email_idx").on(t.toEmail, t.createdAt),
    check("notification_recipient_chk", sql`${t.personId} is not null or ${t.toEmail} is not null`),
  ],
);

// ---------- Forum ----------

/**
 * A discussion thread, either inside a course (`course_id` set) or in the general forum (null).
 * The opening message is the thread's earliest `forum_post`; ordering (pinned first, then latest
 * reply) is computed from the posts, never stored.
 */
export const forumThread = pgTable(
  "forum_thread",
  {
    id: id(),
    courseId: uuid("course_id").references(() => course.id, { onDelete: "cascade" }),
    authorPersonId: uuid("author_person_id").references(() => person.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("forum_thread_course_created_idx").on(t.courseId, t.createdAt),
    index("forum_thread_course_pinned_idx").on(t.courseId, t.pinnedAt),
  ],
);

/** A message in a thread. Soft-deleted posts keep their slot so replies that cite them still read. */
export const forumPost = pgTable(
  "forum_post",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => forumThread.id, { onDelete: "cascade" }),
    authorPersonId: uuid("author_person_id").references(() => person.id, { onDelete: "set null" }),
    bodyMd: text("body_md").notNull(),
    /** The post this one cites; same thread. Self-reference, so no FK (see `submission.supersededBy`). */
    replyToPostId: uuid("reply_to_post_id"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("forum_post_thread_created_idx").on(t.threadId, t.createdAt)],
);

export const FORUM_REACTIONS = ["like", "dislike"] as const;
export type ForumReaction = (typeof FORUM_REACTIONS)[number];

/** One reaction per person per post; sending the same value again removes it. */
export const forumReaction = pgTable(
  "forum_reaction",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => forumPost.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    value: text("value", { enum: FORUM_REACTIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.personId] }),
    check("forum_reaction_value", sql`${t.value} in ('like', 'dislike')`),
  ],
);
