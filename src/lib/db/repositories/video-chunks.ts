import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalTranscriptSegment, ChunkWithTiming } from "@/lib/pipeline/types";
import type { TimedToken } from "@/types/search";
import { retryWithBackoff } from "@/lib/utils/retry";
import type { RetryOptions } from "@/lib/utils/retry";

export type SearchChunkRow = {
  chunk_id: string;
  video_id: string;
  start_time: number;
  end_time: number;
  full_text: string;
  keywords: string[];
  score: number;
};

export async function upsertTranscriptSegments(
  client: SupabaseClient,
  segments: CanonicalTranscriptSegment[],
  batchSize = 500,
  retryOptions: RetryOptions = {},
): Promise<void> {
  if (segments.length === 0) {
    return;
  }

  const rows = segments.map((segment) => ({
    video_id: segment.videoId,
    seq: segment.seq,
    start_time: segment.startTime,
    end_time: segment.endTime,
    text: segment.text,
  }));

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await retryWithBackoff(async () => {
      const { error } = await client.from("transcript_segments").upsert(batch, {
        onConflict: "video_id,seq",
      });

      if (error) {
        throw new Error(`Failed to upsert transcript segments: ${error.message}`);
      }
    }, retryOptions);
  }
}

export async function upsertVideoChunks(
  client: SupabaseClient,
  chunks: ChunkWithTiming[],
  batchSize = 200,
  retryOptions: RetryOptions = {},
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const rows = chunks.map((chunk) => ({
    video_id: chunk.videoId,
    start_time: chunk.startTime,
    end_time: chunk.endTime,
    segment_start_seq: chunk.segmentStartSeq,
    segment_end_seq: chunk.segmentEndSeq,
    keywords: chunk.keywords,
    full_text: chunk.fullText,
    timed_tokens: chunk.timedTokens.map((token) => ({
      token: token.token,
      start_time: token.startTime,
      end_time: token.endTime,
    })),
  }));

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await retryWithBackoff(async () => {
      const { error } = await client.from("video_chunks").upsert(batch, {
        onConflict: "video_id,start_time,end_time,segment_start_seq,segment_end_seq",
      });

      if (error) {
        throw new Error(`Failed to upsert video chunks: ${error.message}`);
      }
    }, retryOptions);
  }
}

export async function searchVideoChunks(
  client: SupabaseClient,
  query: string,
  keywords: string[],
  limit: number,
): Promise<SearchChunkRow[]> {
  const { data, error } = await client.rpc("search_video_chunks", {
    p_query: query,
    p_keywords: keywords,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`search_video_chunks rpc failed: ${error.message}`);
  }

  return (data ?? []) as SearchChunkRow[];
}

export async function getChunkTimedTokens(
  client: SupabaseClient,
  chunkId: string,
): Promise<TimedToken[] | null> {
  const { data, error } = await client.rpc("get_chunk_timed_tokens", {
    p_chunk_id: chunkId,
  });

  if (error) {
    throw new Error(`Failed to load timed tokens: ${error.message}`);
  }

  if (data === null || data === undefined) {
    return null;
  }

  return parseTimedTokens(data);
}

function parseTimedTokens(value: unknown): TimedToken[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => {
      if (typeof row !== "object" || row === null) {
        return null;
      }

      const token = (row as { token?: unknown }).token;
      const startTime = (row as { start_time?: unknown }).start_time;
      const endTime = (row as { end_time?: unknown }).end_time;

      if (typeof token !== "string" || typeof startTime !== "number" || typeof endTime !== "number") {
        return null;
      }

      return {
        token,
        startTime,
        endTime,
      } satisfies TimedToken;
    })
    .filter((row): row is TimedToken => row !== null);
}
