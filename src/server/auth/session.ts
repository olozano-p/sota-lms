import { createServerFn } from "@tanstack/react-start";
import type { Role } from "~/db/schema";
import type { Locale } from "~/i18n/locale";

/** Client-safe shape of the signed-in user. */
export interface SessionUser {
  id: string;
  sub: string;
  name: string;
  email: string;
  roles: Role[];
  locale: Locale | null;
  sessionId: string;
}

export interface SessionData {
  user: SessionUser | null;
}

/** Called from the root route's `beforeLoad` (which also runs on the client, hence a server fn). */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    const { currentUser } = await import("./authz");
    return { user: await currentUser() };
  },
);
