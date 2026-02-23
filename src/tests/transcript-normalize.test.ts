import { describe, expect, it } from "vitest";
import { normalizeTranscriptSegments } from "@/lib/pipeline/transcript/fetch-transcript";

describe("normalizeTranscriptSegments", () => {
  it("normalizes rows and removes invalid transcript rows", () => {
    const normalized = normalizeTranscriptSegments("video-a", [
      { offset: 1, duration: 2, text: " first " },
      { offset: 3, duration: 0, text: "invalid-duration" },
      { offset: -5, duration: 2, text: "negative-offset" },
      { offset: 4, duration: 2, text: "second" },
      { offset: 7, duration: 1, text: "   " },
    ]);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      videoId: "video-a",
      seq: 0,
      startTime: 0,
      endTime: 2,
      text: "negative-offset",
    });
    expect(normalized[1]).toMatchObject({ seq: 1, startTime: 1, endTime: 3, text: "first" });
    expect(normalized[2]).toMatchObject({ seq: 2, startTime: 4, endTime: 6, text: "second" });
  });
});
