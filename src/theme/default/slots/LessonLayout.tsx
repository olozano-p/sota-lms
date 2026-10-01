import { Link } from "@tanstack/react-router";
import { useI18n } from "~/i18n";
import { Alert } from "~/components/ui/alert";
import { Eyebrow } from "~/components/ui/eyebrow";
import type { LessonLayoutProps } from "~/theme/slots";

/** The lesson article: back link, eyebrow, title and summary, then the content and the controls. */
export default function LessonLayout({
  course,
  chapter,
  lesson,
  position,
  draftPreview,
  children,
  footer,
}: LessonLayoutProps) {
  const { t } = useI18n();
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 pb-24">
      <header className="flex flex-col gap-3">
        <Link to="/courses/$courseSlug" params={{ courseSlug: course.slug }} className="text-sm">
          ← {course.title}
        </Link>
        <Eyebrow>
          {chapter.title} · {t("lesson.position", { index: position.index, total: position.total })}
        </Eyebrow>
        <h1 className="text-4xl leading-tight">{lesson.title}</h1>
        {lesson.summary ? <p className="text-lg text-muted-foreground">{lesson.summary}</p> : null}
        {draftPreview ? <Alert variant="warning">{t("lesson.preview")}</Alert> : null}
      </header>
      {children}
      {footer}
    </article>
  );
}
