/**
 * Role vocabulary. SOTA stores `student | teacher | admin` (ADR-016); an IdP or enrollment source
 * may also send the brief's `learner | instructor`, which map onto them. Anything else is dropped,
 * so a claim can never grant a role SOTA does not define. Pure; plain-Node safe.
 */
import { ROLES, type Role } from "../../db/schema.ts";

const ALIASES: Record<string, Role> = {
  student: "student",
  learner: "student",
  teacher: "teacher",
  instructor: "teacher",
  admin: "admin",
};

export function mapRoles(values: unknown): Role[] {
  const list = Array.isArray(values) ? values : typeof values === "string" ? [values] : [];
  const out = new Set<Role>();
  for (const v of list) {
    const role = typeof v === "string" ? ALIASES[v.trim().toLowerCase()] : undefined;
    if (role) out.add(role);
  }
  return ROLES.filter((r) => out.has(r));
}
