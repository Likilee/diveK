#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { runIngestionPipeline } from "@/lib/pipeline/ingest/run-ingestion";
import {
  TranscriptUnavailableError,
  fetchCanonicalTranscriptSegments,
} from "@/lib/pipeline/transcript/fetch-transcript";
import { DEFAULT_CHECKPOINT_PATH } from "@/lib/pipeline/ingest/checkpoint";
import { getSupabaseAdminClient } from "@/lib/db/supabase-admin";
import { computeIntervalIoU, tokenizeQuery } from "@/lib/search/ranking";
import { clampLimit, clampPreroll, searchChunks } from "@/lib/search/search-service";
import type { SearchResult } from "@/types/search";

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
  .option("--target <target>", "Database target: local or prod", "local")
  .action(
    async (options: {
      videoId?: string[];
      videoIdsFile?: string;
      target: "local" | "prod";
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
          target: options.target,
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

const metrics = program.command("metrics").description("Search quality metrics");

metrics
  .command("report")
  .option("--queries-file <path>", "Path to newline-delimited queries")
  .option("--sample-size <count>", "Number of queries to evaluate", parseInteger, 120)
  .option("--limit <count>", "Search result count", parseInteger, 10)
  .option("--preroll <seconds>", "Preroll in seconds (3~5 clamp)", parseFloatSafe, 4)
  .option("--out <path>", "Output report path", ".cache/search-metrics-report.json")
  .action(
    async (options: {
      queriesFile?: string;
      sampleSize: number;
      limit: number;
      preroll: number;
      out: string;
    }) => {
      try {
        const limit = clampLimit(options.limit);
        const preroll = clampPreroll(options.preroll);
        const queries = await loadEvaluationQueries(options.queriesFile, options.sampleSize);

        if (queries.length === 0) {
          throw new Error("No evaluation queries available.");
        }

        const report = await buildMetricsReport({
          queries,
          limit,
          preroll,
        });

        await writeJsonFile(options.out, report);

        console.log(`Saved metrics report to ${options.out}`);
        console.log(`- queries: ${report.summary.queryCount}`);
        console.log(`- TermHit@1: ${(report.summary.termHitAt1 * 100).toFixed(2)}%`);
        console.log(`- AnchorValid@1: ${(report.summary.anchorValidAt1 * 100).toFixed(2)}%`);
        console.log(`- PrerollPolicyPass@1: ${(report.summary.prerollPolicyPassAt1 * 100).toFixed(2)}%`);
        console.log(`- DupRate@10: ${(report.summary.dupRateAt10 * 100).toFixed(2)}%`);
        console.log(
          `- latency p50/p95/p99: ${report.summary.latencyMs.p50.toFixed(2)}/${report.summary.latencyMs.p95.toFixed(2)}/${report.summary.latencyMs.p99.toFixed(2)} ms`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown metrics error";
        console.error(`Metrics report failed: ${message}`);
        process.exitCode = 1;
      }
    },
  );

const benchmark = program.command("benchmark").description("Search performance benchmark");

benchmark
  .command("search")
  .option("--queries-file <path>", "Path to newline-delimited queries")
  .option("--sample-size <count>", "Number of benchmark queries", parseInteger, 80)
  .option("--runs-per-query <count>", "Runs per query per scale", parseInteger, 3)
  .option("--limit <count>", "Search result count", parseInteger, 10)
  .option("--preroll <seconds>", "Preroll in seconds (3~5 clamp)", parseFloatSafe, 4)
  .option("--scales <list>", "Scale factors, comma separated", "1,5,10")
  .option("--gate-p95-ms <ms>", "Fail when p95 exceeds this value", parseFloatSafe, 150)
  .option("--gate-error-rate <ratio>", "Fail when error rate exceeds this value", parseFloatSafe, 0.01)
  .option("--auto-scale", "Auto-expand dataset via scale_search_dataset rpc", false)
  .option("--out <path>", "Output report path", ".cache/search-benchmark-report.json")
  .action(
    async (options: {
      queriesFile?: string;
      sampleSize: number;
      runsPerQuery: number;
      limit: number;
      preroll: number;
      scales: string;
      gateP95Ms: number;
      gateErrorRate: number;
      autoScale: boolean;
      out: string;
    }) => {
      try {
        const limit = clampLimit(options.limit);
        const preroll = clampPreroll(options.preroll);
        const scales = parseScaleList(options.scales);
        const queries = await loadEvaluationQueries(options.queriesFile, options.sampleSize);

        if (queries.length === 0) {
          throw new Error("No benchmark queries available.");
        }

        const scenarios: BenchmarkScenarioReport[] = [];
        let currentScale = 1;

        for (const scale of scales) {
          if (options.autoScale && scale > currentScale) {
            await scaleDataset(currentScale, scale);
            currentScale = scale;
          }

          const scenario = await runBenchmarkScenario({
            scale,
            queries,
            runsPerQuery: options.runsPerQuery,
            limit,
            preroll,
            gateP95Ms: options.gateP95Ms,
            gateErrorRate: options.gateErrorRate,
          });

          scenarios.push(scenario);

          console.log(
            `[scale ${scale}x] p95=${scenario.latencyMs.p95.toFixed(2)}ms errorRate=${(scenario.errorRate * 100).toFixed(2)}% pass=${scenario.pass ? "yes" : "no"}`,
          );
        }

        const report = {
          generatedAt: new Date().toISOString(),
          options: {
            limit,
            preroll,
            runsPerQuery: options.runsPerQuery,
            scales,
            gateP95Ms: options.gateP95Ms,
            gateErrorRate: options.gateErrorRate,
            autoScale: options.autoScale,
          },
          scenarios,
        };

        await writeJsonFile(options.out, report);
        console.log(`Saved benchmark report to ${options.out}`);

        if (scenarios.some((scenario) => !scenario.pass)) {
          process.exitCode = 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown benchmark error";
        console.error(`Benchmark failed: ${message}`);
        process.exitCode = 1;
      }
    },
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  console.error(message);
  process.exitCode = 1;
});

type MetricsReport = {
  generatedAt: string;
  summary: {
    queryCount: number;
    successCount: number;
    errorCount: number;
    termHitAt1: number;
    anchorValidAt1: number;
    prerollPolicyPassAt1: number;
    dupRateAt10: number;
    latencyMs: {
      p50: number;
      p95: number;
      p99: number;
    };
  };
  samples: Array<{
    query: string;
    latencyMs: number;
    resultCount: number;
    topChunkId: string | null;
    topVideoId: string | null;
    termHitAt1: boolean;
    anchorValidAt1: boolean;
    prerollPolicyPassAt1: boolean;
    dupRateAt10: number;
    error?: string;
  }>;
};

type BenchmarkScenarioReport = {
  scale: number;
  runCount: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
  };
  gate: {
    p95MaxMs: number;
    errorRateMax: number;
  };
  pass: boolean;
};

async function buildMetricsReport(input: {
  queries: string[];
  limit: number;
  preroll: number;
}): Promise<MetricsReport> {
  const samples: MetricsReport["samples"] = [];
  const latencies: number[] = [];

  let successCount = 0;
  let errorCount = 0;
  let termHitCount = 0;
  let anchorValidCount = 0;
  let prerollPolicyCount = 0;
  let dupRateSum = 0;

  for (const query of input.queries) {
    const startedAt = performance.now();

    try {
      const results = await searchChunks(query, input.limit, input.preroll, { throwOnError: true });
      const latencyMs = performance.now() - startedAt;
      latencies.push(latencyMs);
      successCount += 1;

      const top = results[0] ?? null;
      const queryTerms = tokenizeQuery(query);
      const termHitAt1 = top ? isTermHit(queryTerms, top) : false;
      const anchorValidAt1 = top
        ? top.anchorSec >= top.chunkStartSec && top.anchorSec <= top.chunkEndSec
        : false;
      const expectedStartSec = top
        ? clamp(top.anchorSec - input.preroll, top.chunkStartSec, top.chunkEndSec)
        : 0;
      const prerollPolicyPassAt1 = top
        ? Math.abs(top.recommendedStartSec - expectedStartSec) <= 0.001
        : false;
      const dupRateAt10 = computeDupRateAt10(results);

      if (termHitAt1) {
        termHitCount += 1;
      }
      if (anchorValidAt1) {
        anchorValidCount += 1;
      }
      if (prerollPolicyPassAt1) {
        prerollPolicyCount += 1;
      }
      dupRateSum += dupRateAt10;

      samples.push({
        query,
        latencyMs,
        resultCount: results.length,
        topChunkId: top?.chunkId ?? null,
        topVideoId: top?.videoId ?? null,
        termHitAt1,
        anchorValidAt1,
        prerollPolicyPassAt1,
        dupRateAt10,
      });
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      errorCount += 1;
      samples.push({
        query,
        latencyMs,
        resultCount: 0,
        topChunkId: null,
        topVideoId: null,
        termHitAt1: false,
        anchorValidAt1: false,
        prerollPolicyPassAt1: false,
        dupRateAt10: 0,
        error: error instanceof Error ? error.message : "Unknown search error",
      });
    }
  }

  const queryCount = input.queries.length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      queryCount,
      successCount,
      errorCount,
      termHitAt1: ratio(termHitCount, successCount),
      anchorValidAt1: ratio(anchorValidCount, successCount),
      prerollPolicyPassAt1: ratio(prerollPolicyCount, successCount),
      dupRateAt10: ratio(dupRateSum, successCount),
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      },
    },
    samples,
  };
}

async function runBenchmarkScenario(input: {
  scale: number;
  queries: string[];
  runsPerQuery: number;
  limit: number;
  preroll: number;
  gateP95Ms: number;
  gateErrorRate: number;
}): Promise<BenchmarkScenarioReport> {
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let runIndex = 0; runIndex < input.runsPerQuery; runIndex += 1) {
    for (const query of input.queries) {
      const startedAt = performance.now();

      try {
        await searchChunks(query, input.limit, input.preroll, { throwOnError: true });
        latencies.push(performance.now() - startedAt);
        successCount += 1;
      } catch {
        errorCount += 1;
      }
    }
  }

  const runCount = successCount + errorCount;
  const errorRate = ratio(errorCount, runCount);
  const p95 = percentile(latencies, 95);

  return {
    scale: input.scale,
    runCount,
    successCount,
    errorCount,
    errorRate,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95,
      p99: percentile(latencies, 99),
    },
    gate: {
      p95MaxMs: input.gateP95Ms,
      errorRateMax: input.gateErrorRate,
    },
    pass: p95 <= input.gateP95Ms && errorRate <= input.gateErrorRate,
  };
}

async function loadEvaluationQueries(filePath: string | undefined, sampleSize: number): Promise<string[]> {
  if (filePath) {
    const lines = await readVideoIdsFromFile(filePath);
    return lines.slice(0, sampleSize);
  }

  try {
    const client = getSupabaseAdminClient();
    const terms = new Set<string>();
    const pageSize = 1000;
    const maxRows = Math.max(sampleSize * 40, 20000);

    for (let offset = 0; offset < maxRows && terms.size < sampleSize * 4; offset += pageSize) {
      const { data, error } = await client
        .from("chunk_terms")
        .select("term")
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(error.message);
      }

      for (const row of data ?? []) {
        const term = typeof row.term === "string" ? row.term.trim() : "";
        if (term) {
          terms.add(term);
        }
      }

      if ((data ?? []).length < pageSize) {
        break;
      }
    }

    const orderedTerms = Array.from(terms);

    const queries: string[] = [];

    for (const term of orderedTerms) {
      if (queries.length >= sampleSize) {
        break;
      }
      queries.push(term);
    }

    for (let index = 0; index < orderedTerms.length - 1; index += 2) {
      if (queries.length >= sampleSize) {
        break;
      }

      const combined = `${orderedTerms[index]} ${orderedTerms[index + 1]}`.trim();
      if (combined) {
        queries.push(combined);
      }
    }

    return Array.from(new Set(queries)).slice(0, sampleSize);
  } catch {
    const fallback = [
      "진짜 웃기다",
      "레전드 밈",
      "다시 듣기",
      "댓글 반응",
      "그 말투",
      "반복 재생",
      "유행 대사",
      "원본 클립",
      "표정 타이밍",
      "빵 터졌다",
    ];

    return fallback.slice(0, sampleSize);
  }
}

async function scaleDataset(currentScale: number, targetScale: number): Promise<void> {
  if (targetScale <= currentScale) {
    return;
  }

  const client = getSupabaseAdminClient();
  const startScale = Math.max(currentScale + 1, 2);

  for (let scale = startScale; scale <= targetScale; scale += 1) {
    const { error } = await client.rpc("scale_search_dataset", {
      p_target_scale: scale,
    });

    if (error) {
      throw new Error(`scale_search_dataset rpc failed at scale ${scale}: ${error.message}`);
    }
  }
}

function computeDupRateAt10(results: SearchResult[]): number {
  const top10 = results.slice(0, 10);

  if (top10.length === 0) {
    return 0;
  }

  let duplicateCount = 0;

  for (let index = 0; index < top10.length; index += 1) {
    const candidate = top10[index];

    const duplicate = top10.slice(0, index).some((selected) => {
      if (selected.videoId !== candidate.videoId) {
        return false;
      }

      const iou = computeIntervalIoU(
        { startSec: selected.chunkStartSec, endSec: selected.chunkEndSec },
        { startSec: candidate.chunkStartSec, endSec: candidate.chunkEndSec },
      );

      return iou > 0.6;
    });

    if (duplicate) {
      duplicateCount += 1;
    }
  }

  return duplicateCount / top10.length;
}

function isTermHit(queryTerms: string[], top: SearchResult): boolean {
  if (queryTerms.length === 0) {
    return false;
  }

  const matched = new Set(top.matchedTerms);
  return queryTerms.some((term) => matched.has(term) || top.normText.includes(term));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function parseScaleList(raw: string): number[] {
  const parsed = Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 1),
    ),
  );

  if (parsed.length === 0) {
    throw new Error("At least one valid scale is required");
  }

  return parsed.sort((left, right) => left - right);
}

async function writeJsonFile(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

function parseFloatSafe(value: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number value: ${value}`);
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

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
