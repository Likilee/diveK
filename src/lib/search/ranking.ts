export const RELEVANCE_WEIGHTS = {
  keyword: 0.55,
  text: 0.3,
  coverage: 0.15,
} as const;

export type RelevanceScoreBreakdown = {
  keywordScore: number;
  textScore: number;
  coverageScore: number;
  finalScore: number;
};

export function tokenizeQuery(query: string): string[] {
  return Array.from(new Set(normalizeForSearch(query).split(" ").filter(Boolean)));
}

export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeCoverageScore(input: {
  termMatchCount: number;
  termHitCount: number;
  queryTermCount: number;
  tokenCount: number;
}): number {
  const queryCoverage = ratio(input.termMatchCount, input.queryTermCount);
  const localDensity = Math.min(ratio(input.termHitCount, input.tokenCount), 1);

  return clamp01(queryCoverage * 0.65 + localDensity * 0.35);
}

export function combineRelevanceScores(input: {
  keywordScore: number;
  textScore: number;
  coverageScore: number;
}): RelevanceScoreBreakdown {
  const keywordScore = clamp01(input.keywordScore);
  const textScore = clamp01(input.textScore);
  const coverageScore = clamp01(input.coverageScore);

  const finalScore =
    keywordScore * RELEVANCE_WEIGHTS.keyword +
    textScore * RELEVANCE_WEIGHTS.text +
    coverageScore * RELEVANCE_WEIGHTS.coverage;

  return {
    keywordScore,
    textScore,
    coverageScore,
    finalScore,
  };
}

export function computeIntervalIoU(left: { startSec: number; endSec: number }, right: { startSec: number; endSec: number }): number {
  const intersectionStart = Math.max(left.startSec, right.startSec);
  const intersectionEnd = Math.min(left.endSec, right.endSec);
  const intersection = Math.max(0, intersectionEnd - intersectionStart);

  if (intersection <= 0) {
    return 0;
  }

  const leftLength = Math.max(0, left.endSec - left.startSec);
  const rightLength = Math.max(0, right.endSec - right.startSec);
  const union = leftLength + rightLength - intersection;

  if (union <= 0) {
    return 0;
  }

  return intersection / union;
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}
