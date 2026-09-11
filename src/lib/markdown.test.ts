import { describe, expect, it } from "vitest";
import { markdownExcerpt, renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    expect(renderMarkdown("Hello **world**")).toBe("<p>Hello <strong>world</strong></p>\n");
  });
  it("strips scripts and event handlers", () => {
    const out = renderMarkdown('<script>alert(1)</script><a href="x" onclick="evil()">l</a>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
  });
  it("drops javascript: links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
  });
  it("demotes h1 to h2", () => {
    expect(renderMarkdown("# Title")).toContain("<h2>Title</h2>");
  });
});

describe("markdownExcerpt", () => {
  it("flattens and truncates", () => {
    expect(markdownExcerpt("# Hi\n\nSome *text* here", 12)).toBe("Hi Some tex…");
  });
});
