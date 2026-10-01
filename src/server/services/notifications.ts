/**
 * Notification queue (docs/spec.md §7): feedback goes out at once, everything else in a daily
 * digest at `notifications.digestHour`. Plain-Node safe: the tick runs from `scripts/notify.ts`
 * (cron or the production server's interval) as well as inline after a mutation.
 */
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/index.ts";
import {
  chapter,
  cohort,
  cohortMember,
  cohortRelease,
  course,
  lesson,
  notification,
  person,
} from "../../db/schema.ts";
import { lmsConfig } from "../../config/index.ts";
import { env } from "../../config/env.ts";
import { getTheme } from "../../theme/runtime.ts";
import { isLocale } from "../../i18n/locale.ts";
import { dateInZone } from "../../lib/dates.ts";
import { sendMail } from "./email/mailer.ts";
import {
  ACCOUNT_MAIL_KINDS,
  isAccountMailKind,
  renderDigest,
  renderNotification,
  type AccountMailKind,
  type NotificationKind,
  type NotificationPayload,
} from "./email/templates.ts";
import { logger } from "../../lib/log.ts";
import { defaultLocale } from "../../config/default-locale.ts";

export async function enqueue(
  tx: DbOrTx,
  personId: string,
  kind: NotificationKind,
  payload: NotificationPayload,
  immediate = false,
): Promise<void> {
  if (!lmsConfig.notifications.enabled) return;
  await tx.insert(notification).values({ personId, kind, payload, immediate });
}

/** Account mail one address may be sent per window, whoever asks (a throttle on mail flooding). */
export const ACCOUNT_MAIL_LIMIT = 5;
export const ACCOUNT_MAIL_WINDOW_MS = 60 * 60 * 1000;

/**
 * Queues account mail (magic link, verification, reset, invitation) for an address that may not
 * have a person row yet. Not subject to `notifications.enabled` or to a person's opt-out: the
 * recipient asked for it. The caller kicks `sendImmediate()` so the link arrives in seconds.
 *
 * An address that already has `ACCOUNT_MAIL_LIMIT` of these in the last hour gets nothing more and
 * the function returns false: neither a script hammering the magic-link endpoint nor an admin
 * re-inviting in a loop can make SOTA flood a mailbox. The caller decides what to tell its user
 * (the magic-link endpoint says nothing, so that it reveals nothing about the address).
 */
export async function enqueueAccountMail(
  tx: DbOrTx,
  toEmail: string,
  kind: AccountMailKind,
  payload: NotificationPayload,
  now = new Date(),
): Promise<boolean> {
  const to = toEmail.toLowerCase();
  const [recent] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(notification)
    .where(
      and(
        eq(notification.toEmail, to),
        inArray(notification.kind, [...ACCOUNT_MAIL_KINDS]),
        gt(notification.createdAt, new Date(now.getTime() - ACCOUNT_MAIL_WINDOW_MS)),
      ),
    );
  if ((recent?.n ?? 0) >= ACCOUNT_MAIL_LIMIT) {
    logger.warn("account mail throttled", { kind, limit: ACCOUNT_MAIL_LIMIT });
    return false;
  }
  await tx.insert(notification).values({ toEmail: to, kind, payload, immediate: true });
  return true;
}

async function recipient(personId: string) {
  const [p] = await db
    .select({ email: person.email, locale: person.locale, optOut: person.emailOptOut })
    .from(person)
    .where(eq(person.id, personId))
    .limit(1);
  return p ?? null;
}

const localeOf = (v: string | null | undefined) => (isLocale(v) ? v : defaultLocale());

/** Sends every immediate notification that is still pending. Safe to call often. */
export async function sendImmediate(): Promise<number> {
  const pending = await db
    .select()
    .from(notification)
    .where(and(isNull(notification.sentAt), eq(notification.immediate, true)))
    .limit(100);
  let sent = 0;
  for (const n of pending) {
    try {
      if (isAccountMailKind(n.kind)) {
        const payload = n.payload as NotificationPayload;
        const known = n.personId ? await recipient(n.personId) : null;
        const email = n.toEmail ?? known?.email;
        if (email) {
          const mail = renderNotification(
            n.kind,
            payload,
            localeOf(known?.locale ?? payload.locale),
            getTheme().config.name,
          );
          await sendMail({ to: email, ...mail });
        }
        // The payload holds a live one-time link; once sent there is no reason to keep it.
        await db
          .update(notification)
          .set({ sentAt: new Date(), payload: { courseTitle: "", url: "" } })
          .where(eq(notification.id, n.id));
        sent++;
        continue;
      }
      const to = n.personId ? await recipient(n.personId) : null;
      if (to && !to.optOut) {
        const mail = renderNotification(
          n.kind as NotificationKind,
          n.payload as NotificationPayload,
          localeOf(to.locale),
          getTheme().config.name,
        );
        await sendMail({ to: to.email, ...mail });
      }
      await db.update(notification).set({ sentAt: new Date() }).where(eq(notification.id, n.id));
      sent++;
    } catch (e) {
      await db
        .update(notification)
        .set({ error: (e as Error).message })
        .where(eq(notification.id, n.id));
    }
  }
  return sent;
}

/** One digest per person with pending non-immediate notifications. */
export async function sendDigests(): Promise<number> {
  const pending = await db
    .select()
    .from(notification)
    .where(and(isNull(notification.sentAt), eq(notification.immediate, false)))
    .limit(2000);
  const byPerson = new Map<string, typeof pending>();
  for (const n of pending) {
    if (n.personId) byPerson.set(n.personId, [...(byPerson.get(n.personId) ?? []), n]);
  }
  let sent = 0;
  for (const [personId, items] of byPerson) {
    const to = await recipient(personId);
    try {
      if (to && !to.optOut) {
        const mail = renderDigest(
          items.map((i) => ({
            kind: i.kind as NotificationKind,
            payload: i.payload as NotificationPayload,
          })),
          localeOf(to.locale),
          getTheme().config.name,
          `${env.appUrl}/courses`,
        );
        await sendMail({ to: to.email, ...mail });
      }
      await db
        .update(notification)
        .set({ sentAt: new Date() })
        .where(
          inArray(
            notification.id,
            items.map((i) => i.id),
          ),
        );
      sent++;
    } catch (e) {
      await db
        .update(notification)
        .set({ error: (e as Error).message })
        .where(
          inArray(
            notification.id,
            items.map((i) => i.id),
          ),
        );
    }
  }
  return sent;
}

/** Releases whose time has come and that were never announced → one digest item per member. */
export async function enqueueReleased(now = new Date()): Promise<number> {
  const due = await db
    .select({
      id: cohortRelease.id,
      cohortId: cohortRelease.cohortId,
      chapterTitle: chapter.title,
      lessonTitle: lesson.title,
      lessonSlug: lesson.slug,
      courseTitle: course.title,
      courseSlug: course.slug,
    })
    .from(cohortRelease)
    .innerJoin(cohort, eq(cohort.id, cohortRelease.cohortId))
    .innerJoin(course, eq(course.id, cohort.courseId))
    .leftJoin(chapter, eq(chapter.id, cohortRelease.chapterId))
    .leftJoin(lesson, eq(lesson.id, cohortRelease.lessonId))
    .where(and(lte(cohortRelease.releaseAt, now), isNull(cohortRelease.notifiedAt)));
  let count = 0;
  for (const r of due) {
    const members = await db
      .select({ personId: cohortMember.personId })
      .from(cohortMember)
      .where(and(eq(cohortMember.cohortId, r.cohortId), eq(cohortMember.role, "student")));
    await db.transaction(async (tx) => {
      for (const m of members) {
        await enqueue(tx, m.personId, "chapter_released", {
          courseTitle: r.courseTitle,
          subject: r.chapterTitle ?? r.lessonTitle ?? "",
          url: r.lessonSlug
            ? `${env.appUrl}/courses/${r.courseSlug}/${r.lessonSlug}`
            : `${env.appUrl}/courses/${r.courseSlug}`,
        });
      }
      await tx.update(cohortRelease).set({ notifiedAt: now }).where(eq(cohortRelease.id, r.id));
    });
    count += members.length;
  }
  return count;
}

/**
 * The periodic tick: announce due releases, send immediate mail, and once a day (at the
 * configured hour in the deployment's zone) the digests. Idempotent within the hour.
 */
export async function tick(
  now = new Date(),
): Promise<{ released: number; immediate: number; digests: number }> {
  const released = await enqueueReleased(now);
  const immediate = await sendImmediate();
  let digests = 0;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: lmsConfig.timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (hour === lmsConfig.notifications.digestHour || process.env.FORCE_DIGEST === "true") {
    const today = dateInZone(now, lmsConfig.timeZone);
    const [already] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(notification)
      .where(
        and(
          eq(notification.immediate, false),
          sql`${notification.sentAt} is not null`,
          sql`(${notification.sentAt} at time zone ${lmsConfig.timeZone})::date = ${today}::date`,
        ),
      );
    if (!already?.n || process.env.FORCE_DIGEST === "true") digests = await sendDigests();
  }
  return { released, immediate, digests };
}
