import type { MessageKey } from "~/i18n/ca";

/** Forum mutations throw i18n keys (`forum.error.*`) for the cases a person can run into. */
export function forumError(t: (key: MessageKey) => string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.startsWith("forum.error.") ? t(message as MessageKey) : message;
}
