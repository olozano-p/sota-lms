import { describe, expect, it } from "vitest";
import { translate } from "./translate.ts";
import type { MessageKey } from "./ca.ts";

const LOCALES = ["ca", "es", "en"] as const;
const COUNTED: MessageKey[] = ["teach.cohorts.drip.done", "teach.cohorts.enrollAll.done"];

describe("count messages stay grammatical for 1 and many", () => {
  it.each(COUNTED)("%s puts the number after a label, never before a plural noun", (key) => {
    for (const l of LOCALES) {
      const one = translate(l, key, { n: 1 });
      expect(one).not.toMatch(/^\d|\b1 \p{L}+s\b/u);
      expect(one).toContain("1");
    }
  });
});

describe("enroll outcome labels", () => {
  it("do not address the people with a gendered plural participle", () => {
    const old = ["Matriculades", "Ja matriculades", "Convidades", "Matriculadas", "Invitadas"];
    for (const l of LOCALES)
      for (const o of ["enrolled", "already", "invited", "placeholder"] as const)
        expect(old).not.toContain(translate(l, `enroll.outcome.${o}` as MessageKey));
  });
});
