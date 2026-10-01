/**
 * The validated deployment config. Imported by server code and by the shell (brand, locales);
 * contains no secrets. Plain-Node safe (used by migrate/seed).
 */
import config from "../../lms.config.ts";
import type { LmsConfig } from "./schema.ts";

export const lmsConfig: LmsConfig = config;
export type { LmsConfig, LocaleCode } from "./schema.ts";
