/**
 * Notification tick: announce due cohort releases, send immediate mail, send the daily digest
 * at the configured hour. Run every 10–15 minutes from cron, or let scripts/serve.mjs do it.
 *
 *   node scripts/notify.ts            FORCE_DIGEST=true node scripts/notify.ts
 */
import { tick } from "../src/server/services/notifications.ts";

const result = await tick();
console.log(
  `notify: released=${result.released} immediate=${result.immediate} digests=${result.digests}`,
);
process.exit(0);
