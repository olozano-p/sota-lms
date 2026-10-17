import { useI18n } from "~/i18n";
import { Alert } from "~/components/ui/alert";
import { PageHeader } from "~/components/ui/page-header";
import type { LessonLayoutProps } from "~/theme/slots";

/**
 * The lesson column of the course frame: breadcrumb and title, the opening video, the meta labels
 * and summary, then the blocks and the actions.
 */
export default function LessonLayout({
  course,
  chapter,
  lesson,
  meta,
  draftPreview,
  media,
  children,
  footer,
}: LessonLayoutProps) {
  const { t } = useI18n();
  return (
    <article className="flex flex-col gap-10">
      <PageHeader
        crumbs={[
          { label: t("nav.courses"), link: { to: "/courses" } },
          {
            label: course.title,
            link: { to: "/courses/$courseSlug", params: { courseSlug: course.slug } },
          },
          { label: chapter.title },
        ]}
        title={lesson.title}
        className="pb-2"
      />
      {draftPreview ? <Alert variant="warning">{t("lesson.preview")}</Alert> : null}
      <div className="flex flex-col gap-6">
        {media}
        <div className="flex flex-col gap-4">
          {meta.length ? (
            <p className="label flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          ) : null}
          {lesson.summary ? (
            <p className="max-w-measure font-serif text-[0.9375rem] leading-[1.4] text-foreground/80">
              {lesson.summary}
            </p>
          ) : null}
        </div>
      </div>
      {children}
      {footer}
    </article>
  );
}
