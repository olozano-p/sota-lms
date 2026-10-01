import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Phase 4 exit against the dev stack (compose.dev.yml: oidc mode, dev/mock-idp): an enrollment
 * pushed through the service API for a person who has never signed in opens the course at first
 * sign-in, and deleting it through the API closes it again.
 */
const TOKEN = process.env.E2E_API_TOKEN ?? "sota-dev-service-token-0123456789abcdef";
const SECRET = process.env.E2E_HMAC_SECRET ?? "sota-dev-webhook-secret";
const SUB = "mock-service-learner";
const COURSE = "introduccio-a-la-contemplacio";
const ENROLLMENT = `e2e-${SUB}-1`;

function signed(method: string, path: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${method}.${path}.${raw}`).digest("hex");
  return {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sig,
    },
    ...(body === undefined ? {} : { data: raw }),
  };
}

test("an enrollment pushed through the API opens the course at first sign-in and DELETE closes it", async ({
  page,
  request,
}) => {
  const path = `/api/v1/enrollments/${ENROLLMENT}`;

  expect((await request.get("/api/v1/health")).status()).toBe(200);
  expect((await request.get("/api/v1/courses")).status()).toBe(401);
  const doc = await (await request.get("/api/v1/openapi.json")).json();
  expect(Object.keys(doc.paths)).toContain("/enrollments/{external_id}");

  // Start clean, then push the enrollment for a sub that has not signed in (twice: idempotent).
  await request.delete(path, signed("DELETE", path));
  const body = { user: { sub: SUB }, course: COURSE };
  const put = await request.put(path, signed("PUT", path, body));
  expect([200, 201]).toContain(put.status());
  const again = await request.put(path, signed("PUT", path, body));
  expect(again.status()).toBe(200);
  expect((await again.json()).changed).toBe(false);

  // First sign-in: the course opens.
  await loginAs(page, SUB, `/courses/${COURSE}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Introducció a la contemplació",
  );

  // Revoked through the API: the course closes.
  const gone = await request.delete(path, signed("DELETE", path));
  expect((await gone.json()).changed).toBe(true);
  const closed = await page.goto(`/courses/${COURSE}`);
  expect(closed?.status()).toBe(404);
});
