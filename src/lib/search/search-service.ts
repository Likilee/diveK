import { MOCK_VIDEO_CHUNKS } from "@/lib/mock/video-chunks";
import { rankChunk } from "@/lib/search/ranking";
import { buildSnippet } from "@/lib/search/snippet";
import type { SearchResult } from "@/types/search";

export function searchChunks(query: string, limit = 20): SearchResult[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  return MOCK_VIDEO_CHUNKS.map((chunk) => {
    const ranking = rankChunk(chunk, trimmedQuery);

    return {
      id: chunk.id,
      videoId: chunk.videoId,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
      snippet: buildSnippet(chunk.fullText, ranking.matchedTerms),
      fullText: chunk.fullText,
      score: ranking.score,
      matchedTerms: ranking.matchedTerms,
    } satisfies SearchResult;
  })
    .filter((result) => result.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, clampLimit(limit));
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.min(Math.max(Math.floor(value), 1), 50);
}
