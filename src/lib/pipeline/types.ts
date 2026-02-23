import type { TimedToken } from "@/types/search";

export type RawTranscriptSegment = {
  offset: number;
  duration: number;
  text: string;
};

export type CanonicalTranscriptSegment = {
  videoId: string;
  seq: number;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
};

export type ChunkWithTiming = {
  videoId: string;
  startTime: number;
  endTime: number;
  segmentStartSeq: number;
  segmentEndSeq: number;
  fullText: string;
  timedTokens: TimedToken[];
  keywords: string[];
};

export type IngestionCheckpoint = {
  completedVideoIds: string[];
  lastVideoId: string | null;
  lastSegmentSeq: number | null;
  lastChunkStartTime: number | null;
  updatedAt: string;
};
