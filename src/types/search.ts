export type VideoChunk = {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  fullText: string;
  keywords: string[];
};

export type SearchResult = {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  snippet: string;
  fullText: string;
  score: number;
  matchedTerms: string[];
};
