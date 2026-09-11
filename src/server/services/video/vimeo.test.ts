import { describe, expect, it } from "vitest";
import { parseVimeoInput, vimeoProvider } from "./vimeo";

describe("parseVimeoInput", () => {
  it("accepts ids and the usual URL shapes", () => {
    expect(parseVimeoInput("76979871")).toEqual({ id: "76979871", hash: null });
    expect(parseVimeoInput("https://vimeo.com/76979871")).toEqual({ id: "76979871", hash: null });
    expect(parseVimeoInput("https://vimeo.com/76979871/9a1b2c3d4e")).toEqual({
      id: "76979871",
      hash: "9a1b2c3d4e",
    });
    expect(parseVimeoInput("https://player.vimeo.com/video/76979871?h=abcdef12")).toEqual({
      id: "76979871",
      hash: "abcdef12",
    });
  });
  it("rejects other hosts", () => {
    expect(parseVimeoInput("https://youtube.com/watch?v=x")).toBeNull();
    expect(parseVimeoInput("hello")).toBeNull();
  });
});

describe("embed", () => {
  it("builds a privacy-friendly player URL, with the unlisted hash when present", () => {
    expect(vimeoProvider.embed("76979871").iframeSrc).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&title=0&byline=0&portrait=0&pip=1",
    );
    expect(vimeoProvider.embed("76979871:abcdef12").iframeSrc).toContain("h=abcdef12");
  });
});
