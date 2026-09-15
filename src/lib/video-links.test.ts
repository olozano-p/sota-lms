import { describe, expect, it } from "vitest";
import { isVideoLine, parseVideoUrl } from "./video-links";

describe("parseVideoUrl", () => {
  it("recognises the YouTube URL shapes", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      const v = parseVideoUrl(u);
      expect(v?.provider, u).toBe("youtube");
      expect(v?.id).toBe("dQw4w9WgXcQ");
      expect(v?.embedSrc).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
      expect(v?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  it("recognises Vimeo, including unlisted hashes", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toMatchObject({
      provider: "vimeo",
      id: "123456789",
      hash: null,
      embedSrc: "https://player.vimeo.com/video/123456789?dnt=1&title=0&byline=0&portrait=0",
    });
    expect(parseVideoUrl("https://vimeo.com/123456789/abcdef12")).toMatchObject({
      hash: "abcdef12",
      url: "https://vimeo.com/123456789/abcdef12",
    });
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef12")?.embedSrc).toBe(
      "https://player.vimeo.com/video/123456789?dnt=1&title=0&byline=0&portrait=0&h=abcdef12",
    );
  });

  it("rejects everything else", () => {
    for (const u of [
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UC123",
      "https://vimeo.com/about",
      "javascript:alert(1)",
      "not a url",
      "https://youtu.be/",
      "https://player.vimeo.com/video/abc",
    ]) {
      expect(parseVideoUrl(u), u).toBeNull();
    }
  });
});

describe("isVideoLine", () => {
  it("accepts a lone URL and nothing more", () => {
    expect(isVideoLine("  https://youtu.be/dQw4w9WgXcQ ")).toBe(true);
    expect(isVideoLine("See https://youtu.be/dQw4w9WgXcQ")).toBe(false);
    expect(isVideoLine("")).toBe(false);
  });
});
