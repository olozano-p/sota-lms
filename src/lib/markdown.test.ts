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
  it("turns a video link alone on its line into a player", () => {
    const out = renderMarkdown("Watch this:\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nThen read on.");
    expect(out.match(/<iframe/g)).toHaveLength(1);
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
    expect(out).toContain("<p>Then read on.</p>");
    expect(out).not.toContain("sota-embed");
  });
  it("leaves a video link inside a sentence as a link", () => {
    const out = renderMarkdown("See https://vimeo.com/123456789 for more.");
    expect(out).not.toContain("<iframe");
    expect(out).toContain('href="https://vimeo.com/123456789"');
  });
  it("still strips iframes written by hand", () => {
    const out = renderMarkdown('<iframe src="https://evil.example/"></iframe>\n\nhi');
    expect(out).not.toContain("<iframe");
  });
});

describe("markdownExcerpt", () => {
  it("flattens and truncates", () => {
    expect(markdownExcerpt("# Hi\n\nSome *text* here", 12)).toBe("Hi Some tex…");
  });
  it("drops video lines and images", () => {
    expect(
      markdownExcerpt("Intro\n\nhttps://youtu.be/dQw4w9WgXcQ\n\n![a](/api/files/x)\n\nEnd"),
    ).toBe("Intro End");
  });
});
