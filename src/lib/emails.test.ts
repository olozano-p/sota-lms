import { describe, expect, it } from "vitest";
import { parseEmailList } from "./emails.ts";

describe("parseEmailList", () => {
  it("accepts newlines, commas, semicolons and angle brackets, lower-cases and dedupes", () => {
    const r = parseEmailList("A@x.org\nb@x.org, c@x.org;<D@x.org>  a@x.org");
    expect(r.emails).toEqual(["a@x.org", "b@x.org", "c@x.org", "d@x.org"]);
    expect(r.invalid).toEqual([]);
  });
  it("reports tokens that look like addresses but are not", () => {
    const r = parseEmailList("ok@x.org nope@ @x.org plain");
    expect(r.emails).toEqual(["ok@x.org"]);
    expect(r.invalid).toEqual(["nope@", "@x.org", "plain"]);
  });
});
