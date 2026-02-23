import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IngestionCheckpoint } from "@/lib/pipeline/types";

export const DEFAULT_CHECKPOINT_PATH = ".cache/ingestion-checkpoint.json";

export async function readCheckpoint(path = DEFAULT_CHECKPOINT_PATH): Promise<IngestionCheckpoint> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as IngestionCheckpoint;

    return normalizeCheckpoint(parsed);
  } catch {
    return createInitialCheckpoint();
  }
}

export async function writeCheckpoint(
  checkpoint: IngestionCheckpoint,
  path = DEFAULT_CHECKPOINT_PATH,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const normalized = normalizeCheckpoint({
    ...checkpoint,
    updatedAt: new Date().toISOString(),
  });

  await writeFile(path, JSON.stringify(normalized, null, 2), "utf8");
}

export function markVideoCompleted(
  checkpoint: IngestionCheckpoint,
  nextState: {
    videoId: string;
    lastSegmentSeq: number | null;
    lastChunkStartTime: number | null;
  },
): IngestionCheckpoint {
  const completed = new Set(checkpoint.completedVideoIds);
  completed.add(nextState.videoId);

  return {
    completedVideoIds: Array.from(completed),
    lastVideoId: nextState.videoId,
    lastSegmentSeq: nextState.lastSegmentSeq,
    lastChunkStartTime: nextState.lastChunkStartTime,
    updatedAt: new Date().toISOString(),
  };
}

export function createInitialCheckpoint(): IngestionCheckpoint {
  return {
    completedVideoIds: [],
    lastVideoId: null,
    lastSegmentSeq: null,
    lastChunkStartTime: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeCheckpoint(input: IngestionCheckpoint): IngestionCheckpoint {
  return {
    completedVideoIds: Array.isArray(input.completedVideoIds)
      ? input.completedVideoIds.filter((value): value is string => typeof value === "string")
      : [],
    lastVideoId: typeof input.lastVideoId === "string" ? input.lastVideoId : null,
    lastSegmentSeq: typeof input.lastSegmentSeq === "number" ? input.lastSegmentSeq : null,
    lastChunkStartTime: typeof input.lastChunkStartTime === "number" ? input.lastChunkStartTime : null,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date(0).toISOString(),
  };
}
