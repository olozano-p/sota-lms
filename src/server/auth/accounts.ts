/**
 * Creates or updates a person with a local password outside the HTTP flows: `pnpm create-admin`
 * (the first administrator, or the break-glass account in OIDC mode). Plain-Node safe.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { person, type Role } from "../../db/schema.ts";
import { audit } from "../audit.ts";
import { getAuth, MIN_PASSWORD_LENGTH } from "./auth.ts";
import { hasCredential } from "./identity.ts";

export interface CredentialInput {
  email: string;
  name: string;
  password: string;
  roles: Role[];
}

export async function upsertCredentialPerson(
  input: CredentialInput,
): Promise<{ personId: string; created: boolean }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`the password must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const email = input.email.trim().toLowerCase();
  const auth = await getAuth();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);

  const [existing] = await db
    .select({ id: person.id, roles: person.roles })
    .from(person)
    .where(eq(person.email, email))
    .limit(1);
  let personId = existing?.id;
  if (personId) {
    const roles = [...new Set([...existing!.roles, ...input.roles])];
    await db.update(person).set({ roles, emailVerified: true }).where(eq(person.id, personId));
  } else {
    const [created] = await db
      .insert(person)
      .values({ email, name: input.name, roles: input.roles, emailVerified: true })
      .returning({ id: person.id });
    personId = created!.id;
  }
  if (await hasCredential(personId)) {
    await ctx.internalAdapter.updatePassword(personId, hash);
  } else {
    await ctx.internalAdapter.linkAccount({
      userId: personId,
      providerId: "credential",
      accountId: personId,
      password: hash,
    });
  }
  await audit(db, {
    actorId: null,
    action: existing ? "person.set_password" : "person.create",
    entity: "person",
    entityId: personId,
    after: { email, roles: input.roles, via: "create-admin" },
  });
  return { personId, created: !existing };
}
