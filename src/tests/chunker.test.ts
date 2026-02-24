import { describe, expect, it } from "vitest";
import { buildSlidingWindowChunks } from "@/lib/pipeline/chunker";
import type { CanonicalTranscriptSegment } from "@/lib/pipeline/types";

function segment(seq: number, startTime: number, endTime: number, text: string): CanonicalTranscriptSegment {
  const normText = text.toLowerCase().replace(/[^0-9a-z가-힣\s]/g, " ").replace(/\s+/g, " ").trim();
  return {
    videoId: "video-a",
    seq,
    startTime,
    endTime,
    duration: endTime - startTime,
    text,
    normText,
    tokenCount: normText.split(/\s+/).filter(Boolean).length,
  };
}

describe("buildSlidingWindowChunks", () => {
  it("creates 15s windows with 5s overlap and includes final partial window", () => {
    const segments = [
      segment(0, 0, 3, "alpha line"),
      segment(1, 4, 8, "beta line"),
      segment(2, 10, 14, "gamma line"),
      segment(3, 16, 20, "delta line"),
    ];

    const chunks = buildSlidingWindowChunks("video-a", segments, {
      windowSeconds: 15,
      overlapSeconds: 5,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      segmentStartSeq: 0,
      segmentEndSeq: 2,
      startTime: 0,
      endTime: 14,
    });
    expect(chunks[1]).toMatchObject({
      segmentStartSeq: 2,
      segmentEndSeq: 3,
      startTime: 10,
      endTime: 20,
    });
    expect(chunks[1].tokens.length).toBeGreaterThan(0);
    expect(chunks[1].terms.length).toBeGreaterThan(0);
  });
});
