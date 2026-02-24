import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalTranscriptSegment, ChunkWithSearchIndex } from "@/lib/pipeline/types";
import type { ChunkContext, TimedToken, VideoSegment } from "@/types/search";
import { retryWithBackoff } from "@/lib/utils/retry";
import type { RetryOptions } from "@/lib/utils/retry";

export type SearchChunkCandidateRow = {
  chunk_id: string;
  video_id: string;
  chunk_start_sec: number;
  chunk_end_sec: number;
  anchor_sec: number;
  recommended_start_sec: number;
  full_text: string;
  norm_text: string;
  token_count: number;
  matched_terms: string[];
  term_match_count: number;
  term_hit_count: number;
  keyword_score: number;
  text_score: number;
  candidate_score: number;
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

  await upsertVideos(client, Array.from(new Set(segments.map((segment) => segment.videoId))), retryOptions);

  const rows = segments.map((segment) => ({
    video_id: segment.videoId,
    seq: segment.seq,
    start_sec: segment.startTime,
    end_sec: segment.endTime,
    text: segment.text,
    norm_text: segment.normText,
    token_count: segment.tokenCount,
  }));

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await retryWithBackoff(async () => {
      const { error } = await client.from("segments").upsert(batch, {
        onConflict: "video_id,seq",
      });

      if (error) {
        throw new Error(`Failed to upsert segments: ${error.message}`);
      }
    }, retryOptions);
  }
}

export async function upsertVideoChunks(
  client: SupabaseClient,
  chunks: ChunkWithSearchIndex[],
  batchSize = 120,
  retryOptions: RetryOptions = {},
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  await upsertVideos(client, Array.from(new Set(chunks.map((chunk) => chunk.videoId))), retryOptions);

  for (let index = 0; index < chunks.length; index += batchSize) {
    const batchChunks = chunks.slice(index, index + batchSize);

    const chunkRows = batchChunks.map((chunk) => ({
      video_id: chunk.videoId,
      chunk_index: chunk.chunkIndex,
      segment_start_seq: chunk.segmentStartSeq,
      segment_end_seq: chunk.segmentEndSeq,
      chunk_start_sec: chunk.startTime,
      chunk_end_sec: chunk.endTime,
      full_text: chunk.fullText,
      norm_text: chunk.normText,
      token_count: chunk.tokenCount,
    }));

    const insertedRows = await retryWithBackoff(async () => {
      const { data, error } = await client
        .from("chunks")
        .upsert(chunkRows, {
          onConflict: "video_id,segment_start_seq,segment_end_seq",
        })
        .select("id, video_id, segment_start_seq, segment_end_seq");

      if (error) {
        throw new Error(`Failed to upsert chunks: ${error.message}`);
      }

      return (data ?? []) as Array<{
        id: string;
        video_id: string;
        segment_start_seq: number;
        segment_end_seq: number;
      }>;
    }, retryOptions);

    const chunkIdByIdentity = new Map<string, string>();
    for (const row of insertedRows) {
      chunkIdByIdentity.set(toChunkIdentityKey(row.video_id, row.segment_start_seq, row.segment_end_seq), row.id);
    }

    const chunkIds: string[] = [];
    const termRows: Array<{
      chunk_id: string;
      term: string;
      first_hit_sec: number;
      hit_count: number;
      positions: number[];
    }> = [];
    const tokenRows: Array<{
      chunk_id: string;
      idx: number;
      token: string;
      token_norm: string;
      start_sec: number;
      end_sec: number;
    }> = [];

    for (const chunk of batchChunks) {
      const key = toChunkIdentityKey(chunk.videoId, chunk.segmentStartSeq, chunk.segmentEndSeq);
      const chunkId = chunkIdByIdentity.get(key);

      if (!chunkId) {
        throw new Error(`Unable to resolve upserted chunk id for ${key}`);
      }

      chunkIds.push(chunkId);

      for (const term of chunk.terms) {
        termRows.push({
          chunk_id: chunkId,
          term: term.term,
          first_hit_sec: term.firstHitSec,
          hit_count: term.hitCount,
          positions: term.positions,
        });
      }

      for (const token of chunk.tokens) {
        tokenRows.push({
          chunk_id: chunkId,
          idx: token.idx,
          token: token.token,
          token_norm: token.tokenNorm,
          start_sec: token.startSec,
          end_sec: token.endSec,
        });
      }
    }

    await replaceChunkTerms(client, chunkIds, termRows, batchSize, retryOptions);
    await replaceChunkTokens(client, chunkIds, tokenRows, batchSize, retryOptions);
  }
}

export async function searchChunksV1(
  client: SupabaseClient,
  query: string,
  limit: number,
  preroll: number,
): Promise<SearchChunkCandidateRow[]> {
  const { data, error } = await client.rpc("search_chunks_v1", {
    p_query: query,
    p_limit: limit,
    p_preroll: preroll,
  });

  if (error) {
    throw new Error(`search_chunks_v1 rpc failed: ${error.message}`);
  }

  return (data ?? []) as SearchChunkCandidateRow[];
}

export async function getVideoSegments(
  client: SupabaseClient,
  videoId: string,
): Promise<VideoSegment[]> {
  const { data, error } = await client
    .from("segments")
    .select("seq, start_sec, end_sec, text, norm_text")
    .eq("video_id", videoId)
    .order("seq", { ascending: true });

  if (error) {
    throw new Error(`Failed to load video segments: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    seq: row.seq as number,
    startSec: row.start_sec as number,
    endSec: row.end_sec as number,
    text: row.text as string,
    normText: row.norm_text as string,
  }));
}

export async function getChunkContext(
  client: SupabaseClient,
  chunkId: string,
): Promise<ChunkContext | null> {
  const { data, error } = await client.rpc("get_chunk_context_v1", {
    p_chunk_id: chunkId,
  });

  if (error) {
    throw new Error(`Failed to load chunk context: ${error.message}`);
  }

  const row = ((data ?? [])[0] ?? null) as
    | {
        chunk_id: string;
        video_id: string;
        chunk_start_sec: number;
        chunk_end_sec: number;
        token_count: number;
        tokens: unknown;
      }
    | null;

  if (!row) {
    return null;
  }

  return {
    chunkId: row.chunk_id,
    videoId: row.video_id,
    chunkStartSec: row.chunk_start_sec,
    chunkEndSec: row.chunk_end_sec,
    tokenCount: row.token_count,
    tokens: parseTimedTokens(row.tokens),
  };
}

async function upsertVideos(
  client: SupabaseClient,
  videoIds: string[],
  retryOptions: RetryOptions,
): Promise<void> {
  if (videoIds.length === 0) {
    return;
  }

  const rows = videoIds.map((videoId) => ({
    id: videoId,
    title: videoId,
  }));

  await retryWithBackoff(async () => {
    const { error } = await client.from("videos").upsert(rows, { onConflict: "id" });

    if (error) {
      throw new Error(`Failed to upsert videos: ${error.message}`);
    }
  }, retryOptions);
}

async function replaceChunkTerms(
  client: SupabaseClient,
  chunkIds: string[],
  rows: Array<{
    chunk_id: string;
    term: string;
    first_hit_sec: number;
    hit_count: number;
    positions: number[];
  }>,
  batchSize: number,
  retryOptions: RetryOptions,
): Promise<void> {
  if (chunkIds.length === 0) {
    return;
  }

  await retryWithBackoff(async () => {
    const { error } = await client.from("chunk_terms").delete().in("chunk_id", chunkIds);

    if (error) {
      throw new Error(`Failed to clear chunk_terms rows: ${error.message}`);
    }
  }, retryOptions);

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await retryWithBackoff(async () => {
      const { error } = await client.from("chunk_terms").insert(batch);

      if (error) {
        throw new Error(`Failed to insert chunk_terms rows: ${error.message}`);
      }
    }, retryOptions);
  }
}

async function replaceChunkTokens(
  client: SupabaseClient,
  chunkIds: string[],
  rows: Array<{
    chunk_id: string;
    idx: number;
    token: string;
    token_norm: string;
    start_sec: number;
    end_sec: number;
  }>,
  batchSize: number,
  retryOptions: RetryOptions,
): Promise<void> {
  if (chunkIds.length === 0) {
    return;
  }

  await retryWithBackoff(async () => {
    const { error } = await client.from("chunk_tokens").delete().in("chunk_id", chunkIds);

    if (error) {
      throw new Error(`Failed to clear chunk_tokens rows: ${error.message}`);
    }
  }, retryOptions);

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await retryWithBackoff(async () => {
      const { error } = await client.from("chunk_tokens").insert(batch);

      if (error) {
        throw new Error(`Failed to insert chunk_tokens rows: ${error.message}`);
      }
    }, retryOptions);
  }
}

function toChunkIdentityKey(videoId: string, segmentStartSeq: number, segmentEndSeq: number): string {
  return `${videoId}:${segmentStartSeq}:${segmentEndSeq}`;
}

function parseTimedTokens(value: unknown): TimedToken[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tokens: TimedToken[] = [];

  for (const row of value) {
    if (typeof row !== "object" || row === null) {
      continue;
    }

    const idx = (row as { idx?: unknown }).idx;
    const token = (row as { token?: unknown }).token;
    const tokenNorm = (row as { token_norm?: unknown }).token_norm;
    const startSec = (row as { start_sec?: unknown }).start_sec;
    const endSec = (row as { end_sec?: unknown }).end_sec;

    if (
      typeof idx !== "number" ||
      typeof token !== "string" ||
      typeof tokenNorm !== "string" ||
      typeof startSec !== "number" ||
      typeof endSec !== "number"
    ) {
      continue;
    }

    tokens.push({
      idx,
      token,
      tokenNorm,
      startSec,
      endSec,
    });
  }

  return tokens.sort((left, right) => left.idx - right.idx);
}
