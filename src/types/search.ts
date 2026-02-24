export type TimedToken = {
  idx: number;
  token: string;
  tokenNorm: string;
  startSec: number;
  endSec: number;
};

export type SearchResult = {
  id: string;
  chunkId: string;
  videoId: string;
  chunkStartSec: number;
  chunkEndSec: number;
  anchorSec: number;
  recommendedStartSec: number;
  snippet: string;
  fullText: string;
  normText: string;
  tokenCount: number;
  termMatchCount: number;
  termHitCount: number;
  matchedTerms: string[];
  keywordScore: number;
  textScore: number;
  coverageScore: number;
  finalScore: number;
  rankReason: string;
};

export type ChunkContext = {
  chunkId: string;
  videoId: string;
  chunkStartSec: number;
  chunkEndSec: number;
  tokenCount: number;
  tokens: TimedToken[];
};

export type VideoSegment = {
  seq: number;
  startSec: number;
  endSec: number;
  text: string;
  normText: string;
};
