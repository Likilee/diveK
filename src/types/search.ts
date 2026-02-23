export type TimedToken = {
  token: string;
  startTime: number;
  endTime: number;
};

export type VideoChunk = {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  fullText: string;
  keywords: string[];
  timedTokens: TimedToken[];
};

export type SearchResult = {
  id: string;
  chunkId: string;
  videoId: string;
  startTime: number;
  endTime: number;
  snippet: string;
  fullText: string;
  score: number;
  matchedTerms: string[];
};
