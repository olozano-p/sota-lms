import { Badge } from "~/components/ui/badge";
import { useI18n, type MessageKey } from "~/i18n";

export function RoleBadges({ roles }: { roles: string[] }) {
  const { t } = useI18n();
  if (roles.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} variant={r === "admin" ? "info" : r === "teacher" ? "success" : "outline"}>
          {isKnown(r) ? t(`role.${r}`) : r}
        </Badge>
      ))}
    </span>
  );
}

const isKnown = (r: string): r is "student" | "teacher" | "admin" =>
  ["student", "teacher", "admin"].includes(r);
export type RoleKey = Extract<MessageKey, `role.${string}`>;
