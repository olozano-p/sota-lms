import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus } from "lucide-react";
import { useI18n } from "~/i18n";
import { enrollByEmails } from "~/server/mutations/enrollments";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";

type Result = Awaited<ReturnType<typeof enrollByEmails>>;
const OUTCOMES = ["enrolled", "already", "invited", "placeholder"] as const;

interface Props {
  courseId: string;
  /** Fixed cohort (cohort page); ignored when `cohorts` is given. */
  cohortSlug?: string | null;
  /** Offers a cohort select (course page). */
  cohorts?: { slug: string; title: string }[];
  /** Also asks for a start date. */
  showFrom?: boolean;
  onDone?: () => void;
}

/** Paste one address or a list, enroll it in the course (optionally through a cohort), list the outcome per address. */
export function EmailEnrollForm({ courseId, cohortSlug, cohorts, showFrom, onDone }: Props) {
  const { t } = useI18n();
  const enroll = useServerFn(enrollByEmails);
  const [text, setText] = useState("");
  const [cohort, setCohort] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await enroll({
        data: {
          courseId,
          cohortSlug: cohorts ? cohort || null : (cohortSlug ?? null),
          text,
          validFrom: from || null,
          validUntil: until || null,
        },
      });
      setResult(r);
      setText("");
      onDone?.();
    } catch (err) {
      setResult(null);
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Field label={t("enroll.emails")} description={t("enroll.emails.hint")}>
          {(c) => (
            <Textarea
              {...c}
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono"
            />
          )}
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          {cohorts ? (
            <Field label={t("enroll.cohort")}>
              {(c) => (
                <Select
                  {...c}
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value)}
                  className="w-56"
                >
                  <option value="">{t("enroll.cohort.none")}</option>
                  {cohorts.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {showFrom ? (
            <Field label={t("enroll.from")}>
              {(c) => (
                <Input {...c} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              )}
            </Field>
          ) : null}
          <Field label={t("enroll.until")}>
            {(c) => (
              <Input {...c} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="outline" loading={busy}>
            <UserPlus aria-hidden="true" />
            {t("enroll.submit")}
          </Button>
        </div>
      </form>
      {error ? <Alert variant="destructive" title={error} /> : null}
      {result ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          {OUTCOMES.map((o) => {
            const rows = result.results.filter((r) => r.outcome === o);
            if (!rows.length) return null;
            return (
              <div key={o} className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">
                  {t(`enroll.outcome.${o}`)}{" "}
                  <span className="font-normal tabular-nums text-muted-foreground">
                    ({rows.length})
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground">{t(`enroll.outcome.${o}.hint`)}</p>
                <ul className="text-sm">
                  {rows.map((r) => (
                    <li key={r.email}>{r.email}</li>
                  ))}
                </ul>
              </div>
            );
          })}
          {result.invalid.length ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-destructive-foreground">
                {t("enroll.invalid")}{" "}
                <span className="font-normal tabular-nums">({result.invalid.length})</span>
              </h3>
              <ul className="text-sm">
                {result.invalid.map((x, i) => (
                  <li key={`${x}-${i}`}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.results.length === 0 && result.invalid.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("enroll.nothing")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
