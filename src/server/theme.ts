import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCALE_CODES } from "~/config/schema";
import { publicTheme, type PublicTheme } from "~/theme/load";
import { getTheme } from "~/theme/runtime";

/** The theme as the browser needs it for one locale (name, logo, links, CSS URL, messages). */
export const getPublicTheme = createServerFn({ method: "GET" })
  .validator(z.object({ locale: z.enum(LOCALE_CODES) }))
  .handler(async ({ data }): Promise<PublicTheme> => publicTheme(getTheme(), data.locale));
