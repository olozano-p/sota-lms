import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "~/i18n";
import { setPersonRoles } from "~/server/mutations/people";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";

const ROLE_OPTIONS = ["student", "teacher", "admin"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

/** Local mode only: roles are edited here; with an IdP they come from the IdP and stay read-only. */
export function RoleEditor({ personId, roles }: { personId: string; roles: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const save = useServerFn(setPersonRoles);
  const [selected, setSelected] = useState<RoleOption[]>(
    ROLE_OPTIONS.filter((r) => roles.includes(r)),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "destructive"; text: string } | null>(
    null,
  );

  const toggle = (r: RoleOption, on: boolean) =>
    setSelected(on ? [...selected, r] : selected.filter((x) => x !== r));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await save({ data: { personId, roles: selected } });
      setNotice({ kind: "success", text: t("admin.person.rolesSaved") });
      await router.invalidate();
    } catch {
      setNotice({ kind: "destructive", text: t("admin.person.rolesError") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-2">
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-medium">{t("admin.person.rolesEdit")}</legend>
        {ROLE_OPTIONS.map((r) => (
          <Checkbox
            key={r}
            label={t(`role.${r}`)}
            checked={selected.includes(r)}
            onChange={(e) => toggle(r, e.target.checked)}
          />
        ))}
      </fieldset>
      {notice ? <Alert variant={notice.kind} title={notice.text} /> : null}
      <Button
        type="submit"
        variant="outline"
        loading={busy}
        disabled={selected.length === 0}
        className="self-start"
      >
        {t("common.save")}
      </Button>
    </form>
  );
}
