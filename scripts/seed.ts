/**
 * Demo data so a fresh checkout has something to click: a published course with every block type,
 * a cohort with a drip schedule, an assignment, a quiz and mirror rows for the mock IdP users.
 * Idempotent (keyed by slug / email) — safe to run on every boot of the dev stack.
 *
 *   pnpm db:seed
 *
 * Runs under plain Node: relative imports with .ts extensions, no alias. Fixtures use
 * `@example.invalid`; nothing here names a real organisation.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { putObject } from "../src/server/services/storage/index.ts";
import {
  assignment,
  chapter,
  cohort,
  cohortMember,
  cohortRelease,
  course,
  courseTeacher,
  enrollment,
  file,
  forumPost,
  forumReaction,
  forumThread,
  lesson,
  lessonBlock,
  person,
  question,
  questionOption,
  quiz,
  type BlockType,
} from "../src/db/schema.ts";
import { errorFields, logger } from "../src/lib/log.ts";

const PEOPLE = [
  {
    externalSub: "mock-student",
    email: "student@example.invalid",
    name: "Aina Estudiant",
    locale: "ca",
    roles: ["student"],
  },
  {
    externalSub: "mock-delayed",
    email: "delayed@example.invalid",
    name: "Pau Pacient",
    locale: "es",
    roles: ["student"],
  },
  {
    externalSub: "mock-teacher",
    email: "teacher@example.invalid",
    name: "Marta Mestra",
    locale: "ca",
    roles: ["teacher"],
  },
  {
    externalSub: "mock-admin",
    email: "admin@example.invalid",
    name: "Oriol Administrador",
    locale: "en",
    roles: ["admin"],
  },
];

const COURSE_SLUG = "introduccio-a-la-contemplacio";
const COHORT_SLUG = "tardor-2026";

async function upsertPeople() {
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const [row] = await db
      .insert(person)
      .values({ ...p, emailVerified: true })
      .onConflictDoUpdate({
        target: person.email,
        set: { name: p.name, locale: p.locale, roles: p.roles, externalSub: p.externalSub },
      })
      .returning({ id: person.id });
    ids[p.externalSub] = row!.id;
  }
  return ids;
}

async function upsertCourse() {
  const existing = await db
    .select({ id: course.id })
    .from(course)
    .where(eq(course.slug, COURSE_SLUG))
    .limit(1);
  if (existing[0]) {
    await db.update(course).set({ forumEnabled: true }).where(eq(course.id, existing[0].id));
    return existing[0].id;
  }
  const [c] = await db
    .insert(course)
    .values({
      slug: COURSE_SLUG,
      forumEnabled: true,
      title: "Introducció a la contemplació",
      subtitle: "Un curs de sis setmanes per asseure's i mirar",
      descriptionMd:
        "Un recorregut per les pràctiques bàsiques d'atenció i presència. Cada capítol combina una lliçó en vídeo, una lectura curta i una pràctica guiada en àudio.\n\nNo cal cap experiència prèvia.",
      language: "ca",
      status: "published",
      endedAt: "2026-07-31",
      sort: 1,
    })
    .returning({ id: course.id });
  return c!.id;
}

async function seedContent(courseId: string) {
  const hasChapters = await db
    .select({ id: chapter.id })
    .from(chapter)
    .where(eq(chapter.courseId, courseId))
    .limit(1);
  if (hasChapters[0]) return;

  const [asg] = await db
    .insert(assignment)
    .values({
      courseId,
      title: "Diari de pràctica",
      instructionsMd:
        "Durant una setmana, anota cada dia tres línies sobre la teva pràctica. Puja el diari com a text o com a PDF.",
      submissionType: "both",
      allowResubmit: true,
    })
    .returning({ id: assignment.id });

  const [qz] = await db
    .insert(quiz)
    .values({
      courseId,
      title: "Repàs del primer capítol",
      introMd: "Quatre preguntes curtes per fixar les idees. Es pot repetir.",
      kind: "self_check",
      showAnswersAfterSubmit: true,
      passThreshold: null,
    })
    .returning({ id: quiz.id });

  const [q1] = await db
    .insert(question)
    .values({
      quizId: qz!.id,
      sort: 1,
      type: "single_choice",
      promptMd: "Quina és la postura recomanada per començar?",
      required: true,
    })
    .returning({ id: question.id });
  await db.insert(questionOption).values([
    { questionId: q1!.id, sort: 1, label: "Estirat al terra", isCorrect: false },
    { questionId: q1!.id, sort: 2, label: "Assegut, esquena recta però relaxada", isCorrect: true },
    { questionId: q1!.id, sort: 3, label: "Dret, caminant", isCorrect: false },
  ]);
  const [q2] = await db
    .insert(question)
    .values({
      quizId: qz!.id,
      sort: 2,
      type: "multi_choice",
      promptMd: "Quins d'aquests són suports habituals de l'atenció?",
      required: true,
    })
    .returning({ id: question.id });
  await db.insert(questionOption).values([
    { questionId: q2!.id, sort: 1, label: "La respiració", isCorrect: true },
    { questionId: q2!.id, sort: 2, label: "Els sons", isCorrect: true },
    { questionId: q2!.id, sort: 3, label: "La llista de tasques", isCorrect: false },
  ]);
  await db.insert(question).values([
    {
      quizId: qz!.id,
      sort: 3,
      type: "short_text",
      promptMd: "En una paraula: què has notat avui?",
      required: false,
    },
    {
      quizId: qz!.id,
      sort: 4,
      type: "long_text",
      promptMd: "Descriu breument una dificultat que hagis trobat en asseure't.",
      required: false,
    },
  ]);

  interface SeedLesson {
    slug: string;
    title: string;
    summary: string;
    estimatedMinutes: number;
    status?: "draft" | "published";
    blocks: { type: BlockType; payload: Record<string, unknown> }[];
  }
  const chapters: { slug: string; title: string; descriptionMd: string; lessons: SeedLesson[] }[] =
    [
      {
        slug: "asseure-s",
        title: "Asseure's",
        descriptionMd: "Postura, respiració i les primeres instruccions.",
        lessons: [
          {
            slug: "benvinguda",
            title: "Benvinguda",
            summary: "Què farem i com aprofitar el curs.",
            estimatedMinutes: 8,
            blocks: [
              {
                type: "text",
                payload: {
                  md: "## Benvinguda\n\nAquest curs és una invitació a aturar-se. No cal creure res ni aconseguir res: només **asseure's i mirar**.\n\nCada lliçó té un vídeo curt, una lectura i, sovint, una pràctica guiada. Ves al teu ritme.",
                },
              },
              {
                type: "video",
                payload: {
                  provider: "vimeo",
                  external_id: "76979871",
                  title: "Benvinguda al curs",
                  duration_s: 180,
                  thumbnail_url: null,
                },
              },
            ],
          },
          {
            slug: "la-postura",
            title: "La postura",
            summary: "Set punts per asseure's amb estabilitat.",
            estimatedMinutes: 15,
            blocks: [
              {
                type: "text",
                payload: {
                  md: "## Els set punts\n\n1. Cames creuades o en una cadira, peus a terra.\n2. Esquena recta, sense rigidesa.\n3. Mans a la falda.\n4. Espatlles relaxades.\n5. Barbeta lleugerament enretirada.\n6. Boca tancada, mandíbula solta.\n7. Mirada baixa o ulls tancats.",
                },
              },
              {
                type: "audio",
                payload: {
                  file_key: "seed/practica-postura.mp3",
                  title: "Pràctica guiada: la postura (10 min)",
                  duration_s: 600,
                },
              },
              {
                type: "file",
                payload: {
                  file_key: "seed/postura.pdf",
                  title: "Full de la postura (PDF)",
                  mime: "application/pdf",
                  size: 240_000,
                },
              },
            ],
          },
          {
            slug: "repas",
            title: "Repàs",
            summary: "Un qüestionari breu.",
            estimatedMinutes: 5,
            blocks: [{ type: "quiz", payload: { quiz_id: qz!.id } }],
          },
        ],
      },
      {
        slug: "l-atencio",
        title: "L'atenció",
        descriptionMd: "Suports de l'atenció i com tornar quan la ment marxa.",
        lessons: [
          {
            slug: "la-respiracio",
            title: "La respiració com a suport",
            summary: "Tornar a la respiració, una vegada i una altra.",
            estimatedMinutes: 20,
            blocks: [
              {
                type: "video",
                payload: {
                  provider: "vimeo",
                  external_id: "76979871",
                  title: "La respiració",
                  duration_s: 540,
                  thumbnail_url: null,
                },
              },
              {
                type: "text",
                payload: {
                  md: "La respiració és un suport perquè sempre hi és. Quan notis que la ment ha marxat, **ja has tornat**: aquell instant de notar-ho és la pràctica.",
                },
              },
              {
                type: "embed",
                payload: {
                  url: "https://docs.google.com/document/d/e/2PACX-1vT_example/pub?embedded=true",
                  title: "Lectura complementària",
                },
              },
            ],
          },
          {
            slug: "diari",
            title: "El diari de pràctica",
            summary: "Una setmana d'anotacions.",
            estimatedMinutes: 10,
            blocks: [
              {
                type: "text",
                payload: {
                  md: "Escriure tres línies cada dia ajuda a veure el que se'ns escapa quan només practiquem.",
                },
              },
              { type: "assignment", payload: { assignment_id: asg!.id } },
            ],
          },
        ],
      },
      {
        slug: "obrir-se",
        title: "Obrir-se",
        descriptionMd: "Escoltar, sentir, deixar estar.",
        lessons: [
          {
            slug: "els-sons",
            title: "Els sons",
            summary: "Escoltar sense triar.",
            estimatedMinutes: 12,
            blocks: [
              {
                type: "text",
                payload: {
                  md: "Els sons arriben i marxen sols. La pràctica és **no anar-los a buscar** ni apartar-los.",
                },
              },
              {
                type: "video",
                payload: {
                  provider: "vimeo",
                  external_id: "76979871",
                  title: "Els sons",
                  duration_s: 420,
                  thumbnail_url: null,
                },
              },
            ],
          },
          {
            slug: "les-sensacions",
            title: "Les sensacions",
            summary: "Encara en preparació.",
            estimatedMinutes: 10,
            status: "draft",
            blocks: [{ type: "text", payload: { md: "Esborrany." } }],
          },
        ],
      },
    ];

  const releases: { chapterId: string; days: number }[] = [];
  let ci = 0;
  for (const ch of chapters) {
    ci++;
    const [c] = await db
      .insert(chapter)
      .values({
        courseId,
        slug: ch.slug,
        title: ch.title,
        descriptionMd: ch.descriptionMd,
        sort: ci,
      })
      .returning({ id: chapter.id });
    releases.push({ chapterId: c!.id, days: (ci - 1) * 7 });
    let li = 0;
    for (const ls of ch.lessons) {
      li++;
      const [l] = await db
        .insert(lesson)
        .values({
          chapterId: c!.id,
          slug: ls.slug,
          title: ls.title,
          summary: ls.summary,
          sort: li,
          status: ls.status ?? "published",
          estimatedMinutes: ls.estimatedMinutes,
        })
        .returning({ id: lesson.id });
      let bi = 0;
      for (const b of ls.blocks) {
        bi++;
        await db
          .insert(lessonBlock)
          .values({ lessonId: l!.id, sort: bi, type: b.type, payload: b.payload });
      }
    }
  }
  return releases;
}

async function seedCohort(
  courseId: string,
  ids: Record<string, string>,
  releases: { chapterId: string; days: number }[] | undefined,
) {
  const existing = await db
    .select({ id: cohort.id })
    .from(cohort)
    .where(eq(cohort.slug, COHORT_SLUG))
    .limit(1);
  if (existing[0]) return;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const startsAt = start.toISOString().slice(0, 10);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 42);
  const [co] = await db
    .insert(cohort)
    .values({
      courseId,
      slug: COHORT_SLUG,
      title: "Grup de tardor 2026",
      startsAt,
      endsAt: end.toISOString().slice(0, 10),
      status: "active",
    })
    .returning({ id: cohort.id });
  await db.insert(cohortMember).values([
    { cohortId: co!.id, personId: ids["mock-student"]!, role: "student" },
    { cohortId: co!.id, personId: ids["mock-teacher"]!, role: "teacher" },
  ]);
  for (const r of releases ?? []) {
    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() + r.days);
    await db
      .insert(cohortRelease)
      .values({ cohortId: co!.id, chapterId: r.chapterId, releaseAt: at });
  }
}

/**
 * Placeholder objects for the demo audio and PDF blocks so downloads resolve. Best effort: when
 * storage is not writable the rows still exist and the player says the file is missing.
 */
async function seedFiles(uploadedBy: string) {
  const objects = [
    {
      key: "seed/practica-postura.mp3",
      filename: "practica-postura.mp3",
      mime: "audio/mpeg",
      body: silentMp3(),
    },
    {
      key: "seed/postura.pdf",
      filename: "postura.pdf",
      mime: "application/pdf",
      body: minimalPdf("Full de la postura"),
    },
  ];
  for (const o of objects) {
    await db
      .insert(file)
      .values({
        key: o.key,
        filename: o.filename,
        mime: o.mime,
        size: o.body.byteLength,
        uploadedBy,
      })
      .onConflictDoNothing({ target: file.key });
  }
  try {
    for (const o of objects) await putObject(o.key, o.body, o.mime);
  } catch (e) {
    logger.warn("seed: could not upload placeholder files", errorFields(e));
  }
}

/** A one-page PDF with a line of text — enough for a viewer to open. */
function minimalPdf(text: string): Uint8Array {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

/** A few silent MPEG-1 Layer III frames (≈ 1 s) so `<audio>` has something to play. */
function silentMp3(): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x64]);
  const frames = 38;
  const out = new Uint8Array(frame.length * frames);
  for (let i = 0; i < frames; i++) out.set(frame, i * frame.length);
  return out;
}

/** One pinned course thread with a cited reply and likes, and one general thread. Keyed by title. */
async function seedForum(courseId: string, ids: Record<string, string>) {
  const threads: {
    courseId: string | null;
    title: string;
    author: string;
    pinned: boolean;
    posts: { author: string; bodyMd: string; citesPrevious?: boolean; likedBy?: string[] }[];
  }[] = [
    {
      courseId,
      title: "Benvinguda al fòrum del curs",
      author: "mock-teacher",
      pinned: true,
      posts: [
        {
          author: "mock-teacher",
          bodyMd:
            "Aquest és l'espai per compartir dubtes i descobertes de la pràctica. Presenteu-vos, si voleu, i pregunteu **qualsevol cosa**: no hi ha preguntes petites.\n\nUn vídeo curt per començar:\n\nhttps://vimeo.com/76979871",
        },
        {
          author: "mock-student",
          bodyMd:
            "Hola! Sóc l'Aina. Fa poc que medito i em costa mantenir l'esquena recta més de deu minuts.",
          likedBy: ["mock-teacher"],
        },
        {
          author: "mock-teacher",
          bodyMd:
            "> **Aina Estudiant:**\n>\n> em costa mantenir l'esquena recta més de deu minuts.\n\nProva d'asseure't sobre la vora del coixí: la pelvis bascula endavant i l'esquena troba la seva corba sola.",
          citesPrevious: true,
          likedBy: ["mock-student"],
        },
      ],
    },
    {
      courseId: null,
      title: "Presentacions",
      author: "mock-admin",
      pinned: false,
      posts: [
        {
          author: "mock-admin",
          bodyMd: "Un fil per dir qui sou i què us porta aquí. Benvingudes i benvinguts!",
        },
      ],
    },
  ];
  for (const t of threads) {
    const exists = await db
      .select({ id: forumThread.id })
      .from(forumThread)
      .where(
        and(
          eq(forumThread.title, t.title),
          t.courseId ? eq(forumThread.courseId, t.courseId) : isNull(forumThread.courseId),
        ),
      )
      .limit(1);
    if (exists[0]) continue;
    const [thread] = await db
      .insert(forumThread)
      .values({
        courseId: t.courseId,
        authorPersonId: ids[t.author]!,
        title: t.title,
        pinnedAt: t.pinned ? new Date() : null,
      })
      .returning({ id: forumThread.id });
    let previous: string | null = null;
    for (const [i, p] of t.posts.entries()) {
      const inserted: { id: string }[] = await db
        .insert(forumPost)
        .values({
          threadId: thread!.id,
          authorPersonId: ids[p.author]!,
          bodyMd: p.bodyMd,
          replyToPostId: p.citesPrevious ? previous : null,
          // Spread the posts over the past days so the listing has real timestamps.
          createdAt: new Date(Date.now() - (t.posts.length - i) * 86_400_000),
        })
        .returning({ id: forumPost.id });
      const post = inserted[0];
      for (const who of p.likedBy ?? []) {
        await db
          .insert(forumReaction)
          .values({ postId: post!.id, personId: ids[who]!, value: "like" })
          .onConflictDoNothing();
      }
      previous = post!.id;
    }
  }
}

async function main() {
  const ids = await upsertPeople();
  await seedFiles(ids["mock-teacher"]!);
  const courseId = await upsertCourse();
  await db
    .insert(courseTeacher)
    .values({ courseId, personId: ids["mock-teacher"]! })
    .onConflictDoNothing();
  const releases = await seedContent(courseId);
  await seedCohort(courseId, ids, releases);
  await seedForum(courseId, ids);
  // Mirror of what the mock enrollment source returns, so the catalogue is populated before the
  // first login refreshes it. Teacher and admin need none: they see the course through their role.
  const [courseRow] = await db
    .select({ id: course.id })
    .from(course)
    .where(eq(course.slug, COURSE_SLUG));
  const [cohortRow] = await db
    .select({ id: cohort.id })
    .from(cohort)
    .where(eq(cohort.slug, COHORT_SLUG));
  const DAY_MS = 86_400_000;
  const grants = [
    {
      sub: "mock-student",
      externalId: "mock-student-1",
      cohortId: cohortRow!.id,
      validFrom: new Date(),
    },
    {
      // Starts in the future, so the course shows as locked until then.
      sub: "mock-delayed",
      externalId: "mock-delayed-1",
      cohortId: null,
      validFrom: new Date(Date.now() + 30 * DAY_MS),
    },
  ];
  // Same shape the sync uses: replace the webhook rows for a person in one go.
  for (const sub of new Set(grants.map((g) => g.sub))) {
    await db.transaction(async (tx) => {
      await tx
        .delete(enrollment)
        .where(and(eq(enrollment.personId, ids[sub]!), eq(enrollment.source, "webhook")));
      await tx.insert(enrollment).values(
        grants
          .filter((g) => g.sub === sub)
          .map((g) => ({
            personId: ids[sub]!,
            courseId: courseRow!.id,
            cohortId: g.cohortId,
            source: "webhook" as const,
            externalId: g.externalId,
            validFrom: g.validFrom,
          })),
      );
    });
  }
  logger.info("seeded", { course: COURSE_SLUG, cohort: COHORT_SLUG, people: PEOPLE.length });
}

await main();
process.exit(0);
