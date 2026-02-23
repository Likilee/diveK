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

export type TimedChunkWindow = {
  chunkId: string;
  videoId: string;
  startTime: number;
  endTime: number;
  timedTokens: TimedToken[];
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

export async function getVideoChunkTimedTokensAtTime(
  client: SupabaseClient,
  videoId: string,
  time: number,
): Promise<TimedChunkWindow | null> {
  const { data: withinRows, error: withinError } = await client
    .from("video_chunks")
    .select("id, video_id, start_time, end_time, timed_tokens")
    .eq("video_id", videoId)
    .lte("start_time", time)
    .gte("end_time", time)
    .order("start_time", { ascending: false })
    .limit(1);

  if (withinError) {
    throw new Error(`Failed to load timed chunk row: ${withinError.message}`);
  }

  const within = ((withinRows ?? [])[0] ?? null) as TimedChunkRow | null;

  if (within) {
    return mapTimedChunkRow(within);
  }

  const { data: beforeRows, error: beforeError } = await client
    .from("video_chunks")
    .select("id, video_id, start_time, end_time, timed_tokens")
    .eq("video_id", videoId)
    .lte("start_time", time)
    .order("start_time", { ascending: false })
    .limit(1);

  if (beforeError) {
    throw new Error(`Failed to load timed chunk row: ${beforeError.message}`);
  }

  const before = ((beforeRows ?? [])[0] ?? null) as TimedChunkRow | null;

  const { data: afterRows, error: afterError } = await client
    .from("video_chunks")
    .select("id, video_id, start_time, end_time, timed_tokens")
    .eq("video_id", videoId)
    .gte("start_time", time)
    .order("start_time", { ascending: true })
    .limit(1);

  if (afterError) {
    throw new Error(`Failed to load timed chunk row: ${afterError.message}`);
  }

  const after = ((afterRows ?? [])[0] ?? null) as TimedChunkRow | null;

  const candidates = [before, after].filter((row): row is TimedChunkRow => row !== null);
  if (candidates.length === 0) {
    return null;
  }

  const nearest = candidates.sort(
    (left, right) =>
      distanceToChunk(time, left.start_time, left.end_time) - distanceToChunk(time, right.start_time, right.end_time),
  )[0];

  return mapTimedChunkRow(nearest);
}

type TimedChunkRow = {
  id: string;
  video_id: string;
  start_time: number;
  end_time: number;
  timed_tokens: unknown;
};

function mapTimedChunkRow(row: TimedChunkRow): TimedChunkWindow {
  return {
    chunkId: row.id,
    videoId: row.video_id,
    startTime: row.start_time,
    endTime: row.end_time,
    timedTokens: parseTimedTokens(row.timed_tokens),
  };
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
