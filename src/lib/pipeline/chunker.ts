import { normalizeToken } from "@/lib/pipeline/keywords";
import type { CanonicalTranscriptSegment, ChunkTerm, ChunkWithSearchIndex } from "@/lib/pipeline/types";
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
): ChunkWithSearchIndex[] {
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

  const chunks: ChunkWithSearchIndex[] = [];
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
    const dedupeKey = `${videoId}:${segmentStartSeq}:${segmentEndSeq}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    const fullText = inWindow.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
    const normText = normalizeSearchText(fullText);

    if (!normText) {
      continue;
    }

    const tokens = buildTimedTokensFromSegments(inWindow);
    if (tokens.length === 0) {
      continue;
    }

    const terms = buildChunkTerms(tokens);

    chunks.push({
      videoId,
      chunkIndex: chunks.length,
      startTime: inWindow[0].startTime,
      endTime: inWindow[inWindow.length - 1].endTime,
      segmentStartSeq,
      segmentEndSeq,
      fullText,
      normText,
      tokenCount: tokens.length,
      tokens,
      terms,
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

    const normalizedWords = words
      .map((word) => ({
        raw: word,
        norm: normalizeToken(word),
      }))
      .filter((row) => row.norm.length > 0);

    if (normalizedWords.length === 0) {
      continue;
    }

    const weights = normalizedWords.map((row) => Math.max(row.norm.length, 1));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const segmentDuration = Math.max(segment.endTime - segment.startTime, 0.05);

    let cursor = segment.startTime;

    for (let index = 0; index < normalizedWords.length; index += 1) {
      const word = normalizedWords[index];
      const weight = weights[index];
      const span = (segmentDuration * weight) / totalWeight;
      const startSec = cursor;
      const isLast = index === normalizedWords.length - 1;
      const endSec = isLast ? segment.endTime : Math.min(segment.endTime, startSec + span);

      tokens.push({
        idx: tokens.length,
        token: word.raw,
        tokenNorm: word.norm,
        startSec,
        endSec,
      });

      cursor = endSec;
    }
  }

  return tokens;
}

function buildChunkTerms(tokens: TimedToken[]): ChunkTerm[] {
  const termMap = new Map<string, { firstHitSec: number; positions: number[] }>();

  for (const token of tokens) {
    const current = termMap.get(token.tokenNorm);
    if (!current) {
      termMap.set(token.tokenNorm, {
        firstHitSec: token.startSec,
        positions: [token.idx],
      });
      continue;
    }

    current.firstHitSec = Math.min(current.firstHitSec, token.startSec);
    current.positions.push(token.idx);
  }

  return Array.from(termMap.entries())
    .map(([term, value]) => ({
      term,
      firstHitSec: value.firstHitSec,
      hitCount: value.positions.length,
      positions: value.positions,
    }))
    .sort((left, right) => left.term.localeCompare(right.term, "ko"));
}

function tokenizeWords(text: string): string[] {
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu);

  if (!tokens) {
    return [];
  }

  return tokens.map((token) => token.trim()).filter(Boolean);
}

function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
