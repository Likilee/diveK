#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { runIngestionPipeline } from "@/lib/pipeline/ingest/run-ingestion";
import {
  TranscriptUnavailableError,
  fetchCanonicalTranscriptSegments,
} from "@/lib/pipeline/transcript/fetch-transcript";
import { DEFAULT_CHECKPOINT_PATH } from "@/lib/pipeline/ingest/checkpoint";

const program = new Command();

program
  .name("kcontext")
  .description("K-Context data pipeline CLI")
  .version("0.1.0");

const transcript = program.command("transcript").description("Transcript operations");

transcript
  .command("fetch")
  .requiredOption("--video-id <videoId>", "YouTube video id")
  .option("--out <path>", "Output file path (JSON)")
  .action(async (options: { videoId: string; out?: string }) => {
    try {
      const segments = await fetchCanonicalTranscriptSegments(options.videoId);
      const payload = JSON.stringify(segments, null, 2);

      if (options.out) {
        await writeFile(options.out, payload, "utf8");
        console.log(`Saved ${segments.length} transcript rows to ${options.out}`);
        return;
      }

      console.log(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown transcript error";

      if (error instanceof TranscriptUnavailableError) {
        console.error(`Transcript unavailable: ${message}`);
      } else {
        console.error(`Transcript fetch failed: ${message}`);
      }

      process.exitCode = 1;
    }
  });

const ingest = program.command("ingest").description("Ingestion operations");

ingest
  .command("run")
  .option("--video-id <videoId...>", "Video IDs to ingest")
  .option("--video-ids-file <path>", "Path to newline-delimited video IDs")
  .option("--batch-size <size>", "Batch size for Supabase upserts", parseInteger, 200)
  .option("--checkpoint <path>", "Checkpoint path", DEFAULT_CHECKPOINT_PATH)
  .option("--max-retries <count>", "Max retries per batch", parseInteger, 4)
  .option("--retry-base-ms <ms>", "Retry base delay in ms", parseInteger, 250)
  .action(
    async (options: {
      videoId?: string[];
      videoIdsFile?: string;
      batchSize: number;
      checkpoint: string;
      maxRetries: number;
      retryBaseMs: number;
    }) => {
      try {
        const fromFlag = options.videoId ?? [];
        const fromFile = options.videoIdsFile ? await readVideoIdsFromFile(options.videoIdsFile) : [];
        const videoIds = Array.from(new Set([...fromFlag, ...fromFile].map((value) => value.trim()).filter(Boolean)));

        if (videoIds.length === 0) {
          console.error("No video IDs provided. Use --video-id or --video-ids-file.");
          process.exitCode = 1;
          return;
        }

        const result = await runIngestionPipeline({
          videoIds,
          batchSize: options.batchSize,
          checkpointPath: options.checkpoint,
          maxRetries: options.maxRetries,
          retryBaseMs: options.retryBaseMs,
          logger: (line) => console.log(line),
        });

        console.log(
          `Ingestion complete. processed=${result.processedVideoIds.length} skipped=${result.skippedVideoIds.length} failed=${result.failed.length}`,
        );

        if (result.failed.length > 0) {
          for (const failed of result.failed) {
            console.error(`- ${failed.videoId}: ${failed.reason}`);
          }

          process.exitCode = 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown ingestion error";
        console.error(`Ingestion failed: ${message}`);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  console.error(message);
  process.exitCode = 1;
});

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

async function readVideoIdsFromFile(path: string): Promise<string[]> {
  const content = await readFile(path, "utf8");

  return content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
