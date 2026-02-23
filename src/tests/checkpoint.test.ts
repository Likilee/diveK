import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createInitialCheckpoint,
  markVideoCompleted,
  readCheckpoint,
  writeCheckpoint,
} from "@/lib/pipeline/ingest/checkpoint";

describe("checkpoint", () => {
  it("writes and reads checkpoint state for resume", async () => {
    const base = await mkdtemp(join(tmpdir(), "kcontext-checkpoint-"));
    const checkpointPath = join(base, "checkpoint.json");

    const first = createInitialCheckpoint();
    const next = markVideoCompleted(first, {
      videoId: "video-1",
      lastSegmentSeq: 12,
      lastChunkStartTime: 60,
    });

    await writeCheckpoint(next, checkpointPath);
    const loaded = await readCheckpoint(checkpointPath);

    expect(loaded.completedVideoIds).toEqual(["video-1"]);
    expect(loaded.lastVideoId).toBe("video-1");
    expect(loaded.lastSegmentSeq).toBe(12);
    expect(loaded.lastChunkStartTime).toBe(60);

    const raw = JSON.parse(await readFile(checkpointPath, "utf8")) as { updatedAt: string };
    expect(typeof raw.updatedAt).toBe("string");
  });
});
