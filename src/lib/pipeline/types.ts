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
  normText: string;
  tokenCount: number;
};

export type ChunkTerm = {
  term: string;
  firstHitSec: number;
  hitCount: number;
  positions: number[];
};

export type ChunkWithSearchIndex = {
  videoId: string;
  chunkIndex: number;
  startTime: number;
  endTime: number;
  segmentStartSeq: number;
  segmentEndSeq: number;
  fullText: string;
  normText: string;
  tokenCount: number;
  tokens: TimedToken[];
  terms: ChunkTerm[];
};

export type IngestionCheckpoint = {
  completedVideoIds: string[];
  lastVideoId: string | null;
  lastSegmentSeq: number | null;
  lastChunkStartTime: number | null;
  updatedAt: string;
};
