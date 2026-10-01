/**
 * Creates an administrator with a local password, or sets the password of an existing person and
 * grants them the admin role. Use it to bootstrap a `local` deployment without opening signup, or
 * to create the break-glass account in `oidc` mode (BREAK_GLASS_ADMIN_EMAIL).
 *
 *   pnpm create-admin --email you@example.org --name "Your Name"
 *
 * The password is read from ADMIN_PASSWORD or prompted for (not echoed); it is never taken from an
 * argument, which would land in the shell history. Plain Node: relative imports, no alias.
 */
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { EnvError, validateEnv } from "../src/config/env.ts";

function ask(question: string, hidden: boolean): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      out._writeToOutput = (s) => {
        if (s.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});

try {
  const env = validateEnv();
  const email = values.email ?? (await ask("Email: ", false));
  if (!email.includes("@")) throw new Error("a valid email is required");
  if (env.authMode === "oidc" && email.toLowerCase() !== env.breakGlassAdminEmail) {
    console.warn(
      `Note: in oidc mode only BREAK_GLASS_ADMIN_EMAIL (${env.breakGlassAdminEmail ?? "not set"}) can sign in with a password.`,
    );
  }
  const name = values.name ?? (await ask("Name: ", false));
  const password = process.env.ADMIN_PASSWORD || (await ask("Password: ", true));

  // Imported after validation so a bad environment is reported before anything touches the database.
  const { upsertCredentialPerson } = await import("../src/server/auth/accounts.ts");
  const { personId, created } = await upsertCredentialPerson({
    email,
    name: name || email,
    password,
    roles: ["admin"],
  });
  console.log(`${created ? "Created" : "Updated"} administrator ${email} (${personId}).`);
  process.exit(0);
} catch (e) {
  console.error(e instanceof EnvError ? e.message : `create-admin failed: ${(e as Error).message}`);
  process.exit(1);
}
