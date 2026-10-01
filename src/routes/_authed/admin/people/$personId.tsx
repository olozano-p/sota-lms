import { useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { useI18n } from "~/i18n";
import { getPerson } from "~/server/queries/admin";
import { grantEnrollment, resyncPerson, revokeEnrollment } from "~/server/mutations/enrollments";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ConfirmDialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { Eyebrow } from "~/components/ui/eyebrow";
import { RoleBadges } from "~/components/admin/RoleBadges";

export const Route = createFileRoute("/_authed/admin/people/$personId")({
  loader: async ({ params }) => {
    const data = await getPerson({ data: { personId: params.personId } });
    if (!data) throw notFound();
    return data;
  },
  component: PersonPage,
});

function PersonPage() {
  const { t, fmtDateTime, fmtRelative } = useI18n();
  const { person, enrollments } = Route.useLoaderData();
  const router = useRouter();
  const grant = useServerFn(grantEnrollment);
  const revoke = useServerFn(revokeEnrollment);
  const resync = useServerFn(resyncPerson);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "success" | "warning" | "destructive";
    text: string;
  } | null>(null);
  const [form, setForm] = useState({ course: "", cohort: "", from: "", until: "" });

  const submitGrant = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await grant({
        data: {
          personId: person.id,
          courseSlug: form.course.trim(),
          cohortSlug: form.cohort.trim() || null,
          validFrom: form.from || null,
          validUntil: form.until || null,
        },
      });
      setForm({ course: "", cohort: "", from: "", until: "" });
      await router.invalidate();
    } catch (err) {
      setNotice({ kind: "destructive", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const doResync = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await resync({ data: { personId: person.id } });
      setNotice(
        r.found
          ? { kind: "success", text: t("admin.person.resynced") }
          : { kind: "warning", text: t("admin.person.resyncNotFound") },
      );
      await router.invalidate();
    } catch (err) {
      setNotice({ kind: "destructive", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link to="/admin" className="text-sm">
            ← {t("admin.tabs.people")}
          </Link>
          <h2 className="font-serif text-2xl font-medium tracking-normal">{person.name}</h2>
          <p className="text-sm text-muted-foreground">{person.email}</p>
        </div>
        <Button variant="outline" onClick={doResync} loading={busy}>
          <RefreshCw aria-hidden="true" />
          {t("admin.person.resync")}
        </Button>
      </div>

      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Eyebrow>{t("admin.person.sub")}</Eyebrow>
          <dd className="mt-1 font-mono text-xs">{person.idpSub}</dd>
        </div>
        <div>
          <Eyebrow>{t("admin.people.roles")}</Eyebrow>
          <dd className="mt-1">
            <RoleBadges roles={person.roles} />
          </dd>
        </div>
        <div>
          <Eyebrow>{t("admin.people.lastSeen")}</Eyebrow>
          <dd className="mt-1">
            {person.lastSeenAt ? fmtDateTime(person.lastSeenAt) : t("admin.people.never")}
          </dd>
        </div>
        <div>
          <Eyebrow>{t("admin.people.synced")}</Eyebrow>
          <dd className="mt-1">
            {person.entitlementsSyncedAt
              ? fmtRelative(person.entitlementsSyncedAt)
              : t("admin.people.never")}
          </dd>
        </div>
      </dl>

      {notice ? <Alert variant={notice.kind}>{notice.text}</Alert> : null}

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg">{t("admin.person.enrollments")}</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("admin.person.enrollments.lead")}
          </p>
        </div>
        {enrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.person.noEnrollments")}</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("admin.person.course")}</Th>
                <Th>{t("admin.person.cohort")}</Th>
                <Th>{t("admin.person.from")}</Th>
                <Th>{t("admin.person.until")}</Th>
                <Th>{t("admin.person.status")}</Th>
                <Th>{t("admin.person.source")}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {enrollments.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.courseTitle}</Td>
                  <Td className="font-mono text-xs">{e.cohortSlug ?? "—"}</Td>
                  <Td>{fmtDateTime(e.validFrom)}</Td>
                  <Td>{e.validUntil ? fmtDateTime(e.validUntil) : "—"}</Td>
                  <Td>
                    <Badge variant={e.status === "active" ? "success" : "outline"}>
                      {t(`enrollment.status.${e.status}`)}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <Badge variant={e.source === "manual" ? "info" : "outline"}>
                        {t(`source.${e.source}`)}
                      </Badge>
                      {e.externalId ? (
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          title={t("admin.person.externalId")}
                        >
                          {e.externalId}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {e.source === "manual" && e.status !== "revoked" ? (
                      <Button variant="outline" size="sm" onClick={() => setRevoking(e.id)}>
                        {t("admin.person.revoke")}
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("admin.person.grant")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitGrant} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label={t("admin.person.course")} hint={t("admin.person.grant.course.hint")}>
              {(c) => (
                <Input
                  {...c}
                  value={form.course}
                  onChange={(e) => setForm({ ...form, course: e.target.value })}
                  required
                />
              )}
            </Field>
            <Field label={t("admin.person.cohort")} hint={t("admin.person.grant.cohort.hint")}>
              {(c) => (
                <Input
                  {...c}
                  value={form.cohort}
                  onChange={(e) => setForm({ ...form, cohort: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("admin.person.from")} hint={t("common.optional")}>
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  value={form.from}
                  onChange={(e) => setForm({ ...form, from: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("admin.person.until")} hint={t("common.optional")}>
              {(c) => (
                <Input
                  {...c}
                  type="date"
                  value={form.until}
                  onChange={(e) => setForm({ ...form, until: e.target.value })}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy}>
                {t("admin.person.grant.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        title={t("admin.person.revoke")}
        description={t("admin.person.revoke.confirm")}
        confirmLabel={t("admin.person.revoke")}
        destructive
        loading={busy}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          setBusy(true);
          try {
            await revoke({ data: { enrollmentId: revoking } });
            setRevoking(null);
            await router.invalidate();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
