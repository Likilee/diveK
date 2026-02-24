import { getSupabaseAdminClient } from "@/lib/db/supabase-admin";
import {
  upsertTranscriptSegments,
  upsertVideoChunks,
} from "@/lib/db/repositories/video-chunks";
import { buildSlidingWindowChunks } from "@/lib/pipeline/chunker";
import {
  DEFAULT_CHECKPOINT_PATH,
  markVideoCompleted,
  readCheckpoint,
  writeCheckpoint,
} from "@/lib/pipeline/ingest/checkpoint";
import { fetchCanonicalTranscriptSegments } from "@/lib/pipeline/transcript/fetch-transcript";

type IngestRunOptions = {
  videoIds: string[];
  target?: "local" | "prod";
  batchSize?: number;
  checkpointPath?: string;
  maxRetries?: number;
  retryBaseMs?: number;
  stopwords?: string[];
  logger?: (message: string) => void;
};

export type IngestRunResult = {
  processedVideoIds: string[];
  skippedVideoIds: string[];
  failed: Array<{ videoId: string; reason: string }>;
};

export async function runIngestionPipeline(options: IngestRunOptions): Promise<IngestRunResult> {
  const batchSize = options.batchSize ?? 200;
  const checkpointPath = options.checkpointPath ?? DEFAULT_CHECKPOINT_PATH;
  const logger = options.logger ?? (() => undefined);

  const checkpoint = await readCheckpoint(checkpointPath);
  const completed = new Set(checkpoint.completedVideoIds);
  const client = getSupabaseAdminClient(options.target ?? "local");

  const processedVideoIds: string[] = [];
  const skippedVideoIds: string[] = [];
  const failed: Array<{ videoId: string; reason: string }> = [];

  for (const videoId of options.videoIds) {
    if (completed.has(videoId)) {
      skippedVideoIds.push(videoId);
      logger(`[skip] ${videoId} already completed in checkpoint`);
      continue;
    }

    logger(`[start] ${videoId}`);

    try {
      const segments = await fetchCanonicalTranscriptSegments(videoId);

      await upsertTranscriptSegments(client, segments, batchSize, {
        maxRetries: options.maxRetries ?? 4,
        baseDelayMs: options.retryBaseMs ?? 250,
      });

      const chunks = buildSlidingWindowChunks(videoId, segments, {
        windowSeconds: 15,
        overlapSeconds: 5,
        stopwords: options.stopwords,
      });

      await upsertVideoChunks(client, chunks, batchSize, {
        maxRetries: options.maxRetries ?? 4,
        baseDelayMs: options.retryBaseMs ?? 250,
      });

      const lastSegmentSeq = segments.length > 0 ? segments[segments.length - 1].seq : null;
      const lastChunkStartTime = chunks.length > 0 ? chunks[chunks.length - 1].startTime : null;

      const nextCheckpoint = markVideoCompleted(checkpoint, {
        videoId,
        lastSegmentSeq,
        lastChunkStartTime,
      });

      await writeCheckpoint(nextCheckpoint, checkpointPath);
      checkpoint.completedVideoIds = nextCheckpoint.completedVideoIds;

      completed.add(videoId);
      processedVideoIds.push(videoId);
      logger(`[done] ${videoId} segments=${segments.length} chunks=${chunks.length}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown ingest error";
      failed.push({ videoId, reason });
      logger(`[error] ${videoId} ${reason}`);
    }
  }

  return {
    processedVideoIds,
    skippedVideoIds,
    failed,
  };
}
