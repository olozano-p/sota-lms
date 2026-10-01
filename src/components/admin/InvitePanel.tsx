import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lmsConfig } from "~/config";
import { LOCALE_NAMES, useI18n } from "~/i18n";
import { invitePerson, revokeInvitation } from "~/server/mutations/people";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "~/components/ui/table";
import { RoleBadges } from "~/components/admin/RoleBadges";

export interface PendingInvitation {
  id: string;
  email: string;
  name: string;
  roles: string[];
  expiresAt: Date | string;
}

const ROLE_OPTIONS = ["student", "teacher", "admin"] as const;

/** Local mode only: invite someone by email and manage the invitations still waiting. */
export function InvitePanel({ invitations }: { invitations: PendingInvitation[] }) {
  const { t, fmtDateTime } = useI18n();
  const router = useRouter();
  const invite = useServerFn(invitePerson);
  const revoke = useServerFn(revokeInvitation);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "destructive"; text: string } | null>(
    null,
  );

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setNotice(null);
    try {
      const locale = String(form.get("locale") ?? "");
      await invite({
        data: {
          email: String(form.get("email") ?? ""),
          name: String(form.get("name") ?? ""),
          roles: [String(form.get("role")) as (typeof ROLE_OPTIONS)[number]],
          locale: locale || null,
        },
      });
      formEl.reset();
      setNotice({ kind: "success", text: t("admin.invite.sent") });
      await router.invalidate();
    } catch {
      setNotice({ kind: "destructive", text: t("admin.invite.error") });
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (invitationId: string) => {
    setBusy(true);
    try {
      await revoke({ data: { invitationId } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="invite-title">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle id="invite-title">{t("admin.invite.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {notice ? <Alert variant={notice.kind} title={notice.text} /> : null}
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.email")}>
              {(c) => <Input {...c} name="email" type="email" autoComplete="off" required />}
            </Field>
            <Field label={t("common.name")}>
              {(c) => <Input {...c} name="name" autoComplete="off" required />}
            </Field>
            <Field label={t("admin.invite.role")}>
              {(c) => (
                <Select {...c} name="role" defaultValue="student">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("admin.person.locale")} hint={t("common.optional")}>
              {(c) => (
                <Select {...c} name="locale" defaultValue="">
                  <option value="">{t("admin.invite.localeDefault")}</option>
                  {lmsConfig.locales.enabled.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_NAMES[l]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy}>
                {t("admin.invite.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg">{t("admin.invite.pending")}</h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.invite.none")}</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("admin.people.roles")}</Th>
                <Th>{t("admin.invite.expires")}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {invitations.map((i) => (
                <Tr key={i.id}>
                  <Td>
                    <span className="font-medium">{i.name}</span>
                    <div className="text-xs text-muted-foreground">{i.email}</div>
                  </Td>
                  <Td>
                    <RoleBadges roles={i.roles} />
                  </Td>
                  <Td className="text-muted-foreground">{fmtDateTime(i.expiresAt)}</Td>
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => doRevoke(i.id)}
                    >
                      {t("admin.invite.revoke")}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </section>
  );
}
