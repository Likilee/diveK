import { getSupabaseAdminClient } from "@/lib/db/supabase-admin";
import {
  getVideoChunkTimedTokensAtTime,
  getChunkTimedTokens,
  searchVideoChunks,
  type TimedChunkWindow,
  type SearchChunkRow,
} from "@/lib/db/repositories/video-chunks";
import { MOCK_VIDEO_CHUNKS } from "@/lib/mock/video-chunks";
import { rankChunk, tokenizeQuery } from "@/lib/search/ranking";
import { buildSnippet } from "@/lib/search/snippet";
import type { SearchResult, TimedToken } from "@/types/search";

export async function searchChunks(query: string, limit = 20): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const safeLimit = clampLimit(limit);

  try {
    const client = getSupabaseAdminClient();
    const queryKeywords = tokenizeQuery(trimmedQuery);
    const rows = await searchVideoChunks(client, trimmedQuery, queryKeywords, safeLimit);

    return rows.map((row) => mapDbRowToSearchResult(row, trimmedQuery));
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : "Unknown DB search error";
      console.info(`[search-service] fallback to mock: ${message}`);
    }

    return searchChunksFromMock(trimmedQuery, safeLimit);
  }
}

export async function getTimedTokensForChunk(chunkId: string): Promise<TimedToken[] | null> {
  try {
    const client = getSupabaseAdminClient();
    return await getChunkTimedTokens(client, chunkId);
  } catch {
    const fallback = MOCK_VIDEO_CHUNKS.find((chunk) => chunk.id === chunkId);
    return fallback?.timedTokens ?? null;
  }
}

export async function getTimedTokensForVideoAtTime(
  videoId: string,
  time: number,
): Promise<TimedChunkWindow | null> {
  if (!videoId || !Number.isFinite(time) || time < 0) {
    return null;
  }

  try {
    const client = getSupabaseAdminClient();
    return await getVideoChunkTimedTokensAtTime(client, videoId, time);
  } catch {
    const sameVideo = MOCK_VIDEO_CHUNKS.filter((chunk) => chunk.videoId === videoId);
    if (sameVideo.length === 0) {
      return null;
    }

    const within = sameVideo.find((chunk) => chunk.startTime <= time && chunk.endTime >= time);
    const nearest = within ?? sameVideo.sort((a, b) => distanceToChunk(time, a.startTime, a.endTime) - distanceToChunk(time, b.startTime, b.endTime))[0];

    return {
      chunkId: nearest.id,
      videoId: nearest.videoId,
      startTime: nearest.startTime,
      endTime: nearest.endTime,
      timedTokens: nearest.timedTokens,
    };
  }
}

function searchChunksFromMock(query: string, limit: number): SearchResult[] {
  return MOCK_VIDEO_CHUNKS.map((chunk) => {
    const ranking = rankChunk(chunk, query);

    return {
      id: chunk.id,
      chunkId: chunk.id,
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
    .slice(0, limit);
}

function mapDbRowToSearchResult(row: SearchChunkRow, query: string): SearchResult {
  const queryTerms = tokenizeQuery(query);
  const normalizedKeywords = row.keywords.map((keyword) => keyword.toLowerCase());
  const normalizedText = row.full_text.toLowerCase();

  const matchedTerms = queryTerms.filter(
    (term) => normalizedKeywords.includes(term.toLowerCase()) || normalizedText.includes(term.toLowerCase()),
  );

  return {
    id: row.chunk_id,
    chunkId: row.chunk_id,
    videoId: row.video_id,
    startTime: row.start_time,
    endTime: row.end_time,
    snippet: buildSnippet(row.full_text, matchedTerms),
    fullText: row.full_text,
    score: row.score,
    matchedTerms,
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.min(Math.max(Math.floor(value), 1), 50);
}

function distanceToChunk(time: number, start: number, end: number): number {
  if (time < start) {
    return start - time;
  }

  if (time > end) {
    return time - end;
  }

  return 0;
}
