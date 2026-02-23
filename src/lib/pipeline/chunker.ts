import { extractKeywords } from "@/lib/pipeline/keywords";
import type { CanonicalTranscriptSegment, ChunkWithTiming } from "@/lib/pipeline/types";
import type { TimedToken } from "@/types/search";

export type ChunkingOptions = {
  windowSeconds?: number;
  overlapSeconds?: number;
  stopwords?: string[];
};

export function buildSlidingWindowChunks(
  videoId: string,
  segments: CanonicalTranscriptSegment[],
  options: ChunkingOptions = {},
): ChunkWithTiming[] {
  if (segments.length === 0) {
    return [];
  }

  const windowSeconds = options.windowSeconds ?? 15;
  const overlapSeconds = options.overlapSeconds ?? 5;
  const stepSeconds = windowSeconds - overlapSeconds;

  if (windowSeconds <= 0 || stepSeconds <= 0) {
    throw new Error("Invalid chunking window/overlap settings");
  }

  const ordered = [...segments].sort((left, right) => left.startTime - right.startTime || left.seq - right.seq);
  const minStart = ordered[0].startTime;
  const maxEnd = ordered[ordered.length - 1].endTime;

  const chunks: ChunkWithTiming[] = [];
  const seen = new Set<string>();

  for (let windowStart = minStart; windowStart <= maxEnd; windowStart += stepSeconds) {
    const windowEnd = windowStart + windowSeconds;
    const inWindow = ordered.filter(
      (segment) => segment.endTime > windowStart && segment.startTime < windowEnd,
    );

    if (inWindow.length === 0) {
      continue;
    }

    const segmentStartSeq = inWindow[0].seq;
    const segmentEndSeq = inWindow[inWindow.length - 1].seq;
    const key = `${videoId}:${segmentStartSeq}:${segmentEndSeq}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const fullText = inWindow.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
    const timedTokens = buildTimedTokensFromSegments(inWindow);
    const keywords = extractKeywords(fullText, { stopwords: options.stopwords });

    chunks.push({
      videoId,
      startTime: inWindow[0].startTime,
      endTime: inWindow[inWindow.length - 1].endTime,
      segmentStartSeq,
      segmentEndSeq,
      fullText,
      timedTokens,
      keywords,
    });
  }

  return chunks;
}

export function buildTimedTokensFromSegments(segments: CanonicalTranscriptSegment[]): TimedToken[] {
  const tokens: TimedToken[] = [];

  for (const segment of segments) {
    const words = tokenizeWords(segment.text);

    if (words.length === 0) {
      continue;
    }

    const weights = words.map((word) => Math.max(word.length, 1));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const segmentDuration = Math.max(segment.endTime - segment.startTime, 0.05);

    let cursor = segment.startTime;

    for (let index = 0; index < words.length; index += 1) {
      const weight = weights[index];
      const span = (segmentDuration * weight) / totalWeight;
      const startTime = cursor;
      const isLast = index === words.length - 1;
      const endTime = isLast ? segment.endTime : Math.min(segment.endTime, startTime + span);

      tokens.push({
        token: words[index],
        startTime,
        endTime,
      });

      cursor = endTime;
    }
  }

  return tokens;
}

function tokenizeWords(text: string): string[] {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);

  if (!tokens) {
    return [];
  }

  return tokens.map((token) => token.trim()).filter(Boolean);
}
