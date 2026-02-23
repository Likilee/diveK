import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptResponse,
} from "youtube-transcript";
import type { CanonicalTranscriptSegment, RawTranscriptSegment } from "@/lib/pipeline/types";

const execFile = promisify(execFileCallback);
const YT_DLP_LANG_PRIORITY = ["ko-orig", "ko", "en"] as const;

type YtDlpTrack = {
  ext?: string;
  url?: string;
};

type YtDlpMetadata = {
  subtitles?: Record<string, YtDlpTrack[]>;
  automatic_captions?: Record<string, YtDlpTrack[]>;
};

type YtJson3Event = {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
};

type YtJson3Payload = {
  events?: YtJson3Event[];
};

export class TranscriptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

export async function fetchCanonicalTranscriptSegments(
  videoId: string,
): Promise<CanonicalTranscriptSegment[]> {
  let primaryError: TranscriptUnavailableError | null = null;

  try {
    const primary = await fetchTranscriptWithYoutubeTranscript(videoId);
    if (primary.length > 0) {
      return primary;
    }

    primaryError = new TranscriptUnavailableError(`No usable transcript rows for video ${videoId}`);
  } catch (error) {
    primaryError = toTranscriptUnavailableError(error);
  }

  const fallback = await fetchTranscriptWithYtDlp(videoId);
  if (fallback.length > 0) {
    return fallback;
  }

  if (primaryError) {
    throw primaryError;
  }

  throw new TranscriptUnavailableError(`No usable transcript rows for video ${videoId}`);
}

async function fetchTranscriptWithYoutubeTranscript(
  videoId: string,
): Promise<CanonicalTranscriptSegment[]> {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId);
  return normalizeTranscriptSegments(videoId, transcript);
}

function toTranscriptUnavailableError(error: unknown): TranscriptUnavailableError {
  if (
    error instanceof YoutubeTranscriptDisabledError ||
    error instanceof YoutubeTranscriptNotAvailableError ||
    error instanceof YoutubeTranscriptVideoUnavailableError
  ) {
    return new TranscriptUnavailableError(error.message);
  }

  if (error instanceof TranscriptUnavailableError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown transcript fetch error";
  return new TranscriptUnavailableError(message);
}

async function fetchTranscriptWithYtDlp(videoId: string): Promise<CanonicalTranscriptSegment[]> {
  try {
    const metadata = await loadYtDlpMetadata(videoId);
    const json3Url = pickJson3TrackUrl(metadata);

    if (!json3Url) {
      return [];
    }

    const response = await fetch(json3Url, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as YtJson3Payload;
    const rawSegments = parseYtJson3Segments(payload);
    return normalizeTranscriptSegments(videoId, rawSegments);
  } catch {
    return [];
  }
}

async function loadYtDlpMetadata(videoId: string): Promise<YtDlpMetadata> {
  const { stdout } = await execFile(
    "yt-dlp",
    ["--skip-download", "--dump-single-json", `https://www.youtube.com/watch?v=${videoId}`],
    {
      maxBuffer: 25 * 1024 * 1024,
    },
  );

  const parsed = JSON.parse(stdout) as YtDlpMetadata;
  return parsed;
}

function pickJson3TrackUrl(metadata: YtDlpMetadata): string | null {
  const pools = [metadata.subtitles, metadata.automatic_captions].filter(Boolean) as Array<
    Record<string, YtDlpTrack[]>
  >;

  for (const pool of pools) {
    for (const lang of YT_DLP_LANG_PRIORITY) {
      const tracks = pool[lang];
      if (!tracks) {
        continue;
      }

      const match = tracks.find((track) => track.ext === "json3" && typeof track.url === "string");
      if (match?.url) {
        return match.url;
      }
    }
  }

  for (const pool of pools) {
    for (const tracks of Object.values(pool)) {
      const match = tracks.find((track) => track.ext === "json3" && typeof track.url === "string");
      if (match?.url) {
        return match.url;
      }
    }
  }

  return null;
}

function parseYtJson3Segments(payload: YtJson3Payload): RawTranscriptSegment[] {
  if (!Array.isArray(payload.events)) {
    return [];
  }

  const rows: RawTranscriptSegment[] = [];

  for (const event of payload.events) {
    if (!Array.isArray(event.segs)) {
      continue;
    }

    const offsetMs = sanitizeNumber(event.tStartMs);
    const durationMs = sanitizeNumber(event.dDurationMs);

    if (durationMs <= 0) {
      continue;
    }

    const text = event.segs
      .map((segment) => (typeof segment.utf8 === "string" ? segment.utf8 : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      continue;
    }

    rows.push({
      offset: offsetMs / 1000,
      duration: durationMs / 1000,
      text,
    });
  }

  return rows;
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
