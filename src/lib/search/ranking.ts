import type { VideoChunk } from "@/types/search";

const KEYWORD_WEIGHT = 0.7;
const TRIGRAM_WEIGHT = 0.3;

export function tokenizeQuery(query: string): string[] {
  return Array.from(new Set(normalizeForSearch(query).split(" ").filter(Boolean)));
}

export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rankChunk(chunk: VideoChunk, query: string): {
  score: number;
  keywordScore: number;
  trigramScore: number;
  matchedTerms: string[];
} {
  const queryTerms = tokenizeQuery(query);

  if (queryTerms.length === 0) {
    return { score: 0, keywordScore: 0, trigramScore: 0, matchedTerms: [] };
  }

  const normalizedKeywordSet = new Set(chunk.keywords.map(normalizeForSearch));
  const normalizedText = normalizeForSearch(chunk.fullText);

  const matchedTerms = queryTerms.filter(
    (term) => normalizedKeywordSet.has(term) || normalizedText.includes(term),
  );

  const keywordScore = matchedTerms.length / queryTerms.length;
  const trigramScore = trigramSimilarity(normalizedText, normalizeForSearch(query));
  const score = keywordScore * KEYWORD_WEIGHT + trigramScore * TRIGRAM_WEIGHT;

  return {
    score,
    keywordScore,
    trigramScore,
    matchedTerms,
  };
}

function trigramSimilarity(a: string, b: string): number {
  const setA = toTrigrams(a);
  const setB = toTrigrams(b);

  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const gram of setA) {
    if (setB.has(gram)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function toTrigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length < 3) {
    return compact ? new Set([compact]) : new Set();
  }

  const grams = new Set<string>();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    grams.add(compact.slice(index, index + 3));
  }

  return grams;
}
