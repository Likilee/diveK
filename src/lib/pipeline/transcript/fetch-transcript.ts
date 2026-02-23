import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptResponse,
} from "youtube-transcript";
import type { CanonicalTranscriptSegment, RawTranscriptSegment } from "@/lib/pipeline/types";

export class TranscriptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

export async function fetchCanonicalTranscriptSegments(
  videoId: string,
): Promise<CanonicalTranscriptSegment[]> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const normalized = normalizeTranscriptSegments(videoId, transcript);

    if (normalized.length === 0) {
      throw new TranscriptUnavailableError(`No usable transcript rows for video ${videoId}`);
    }

    return normalized;
  } catch (error) {
    if (
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableError ||
      error instanceof YoutubeTranscriptVideoUnavailableError
    ) {
      throw new TranscriptUnavailableError(error.message);
    }

    if (error instanceof TranscriptUnavailableError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown transcript fetch error";
    throw new TranscriptUnavailableError(message);
  }
}

export function normalizeTranscriptSegments(
  videoId: string,
  rawSegments: RawTranscriptSegment[] | TranscriptResponse[],
): CanonicalTranscriptSegment[] {
  const ordered = [...rawSegments]
    .map((row) => ({
      offset: sanitizeNumber(row.offset),
      duration: sanitizeNumber(row.duration),
      text: typeof row.text === "string" ? row.text.trim() : "",
    }))
    .sort((left, right) => left.offset - right.offset);

  const normalized: CanonicalTranscriptSegment[] = [];

  for (const row of ordered) {
    if (!row.text) {
      continue;
    }

    if (row.duration <= 0) {
      continue;
    }

    const startTime = row.offset;
    const endTime = row.offset + row.duration;

    if (endTime <= startTime) {
      continue;
    }

    normalized.push({
      videoId,
      seq: normalized.length,
      startTime,
      endTime,
      duration: row.duration,
      text: row.text,
    });
  }

  return normalized;
}

function sanitizeNumber(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  return value;
}
