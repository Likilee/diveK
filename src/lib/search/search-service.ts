import { getSupabaseAdminClient } from "@/lib/db/supabase-admin";
import {
  getChunkContext as getChunkContextFromDb,
  searchChunksV1,
  type SearchChunkCandidateRow,
} from "@/lib/db/repositories/video-chunks";
import {
  combineRelevanceScores,
  computeCoverageScore,
  computeIntervalIoU,
  normalizeForSearch,
  tokenizeQuery,
} from "@/lib/search/ranking";
import { buildSnippet } from "@/lib/search/snippet";
import type { ChunkContext, SearchResult } from "@/types/search";

const MAX_LIMIT = 50;
const MIN_LIMIT = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_PREROLL = 4;
const MIN_PREROLL = 3;
const MAX_PREROLL = 5;
const SEARCH_CANDIDATE_CAP = 300;
const BEHAVIOR_SCORING_ENABLED = false;
const BEHAVIOR_SCORE_ALPHA = 0.15;
const SYNTHETIC_SCALE_VIDEO_SUFFIX_PATTERN = /__s\d+$/;
const SAME_VIDEO_MAX_RESULTS = 2;
const SAME_VIDEO_NEAR_DUPLICATE_IOU_THRESHOLD = 0.35;
const SAME_VIDEO_NEAR_DUPLICATE_START_GAP_SEC = 14;
const QUERY_TERM_LOOKUP_ALIASES = new Map<string, string[]>([
  ["왜냐하면", ["왜냐면"]],
]);

type SearchChunkOptions = {
  throwOnError?: boolean;
};

export async function searchChunks(
  query: string,
  limit = DEFAULT_LIMIT,
  preroll = DEFAULT_PREROLL,
  options: SearchChunkOptions = {},
): Promise<SearchResult[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const safeLimit = clampLimit(limit);
  const safePreroll = clampPreroll(preroll);
  const queryTerms = tokenizeQuery(trimmedQuery);
  const lookupQueryText = buildLookupQueryText(trimmedQuery, queryTerms);
  const candidateLimit = Math.min(Math.max(safeLimit * 6, 60), SEARCH_CANDIDATE_CAP);

  if (!lookupQueryText) {
    return [];
  }

  try {
    const client = getSupabaseAdminClient();
    const candidates = await searchChunksV1(client, lookupQueryText, candidateLimit, safePreroll);
    const filteredCandidates = candidates.filter((candidate) => !isSyntheticScaleCandidate(candidate.video_id));
    return rerankAndFilterCandidates(filteredCandidates, queryTerms, safeLimit, safePreroll);
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }

    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : "Unknown DB search error";
      console.info(`[search-service] returning empty result after DB search failure: ${message}`);
    }

    return [];
  }
}

export async function getChunkContext(chunkId: string): Promise<ChunkContext | null> {
  if (!chunkId) {
    return null;
  }

  try {
    const client = getSupabaseAdminClient();
    return await getChunkContextFromDb(client, chunkId);
  } catch {
    return null;
  }
}

function rerankAndFilterCandidates(
  rows: SearchChunkCandidateRow[],
  queryTerms: string[],
  limit: number,
  preroll: number,
): SearchResult[] {
  const queryTermCount = Math.max(queryTerms.length, 1);
  const scored = rows
    .map((row) => mapCandidateRowToSearchResult(row, queryTerms, preroll))
    .sort((left, right) => {
      const leftHasFullCoverage = left.termMatchCount >= queryTermCount;
      const rightHasFullCoverage = right.termMatchCount >= queryTermCount;

      if (leftHasFullCoverage !== rightHasFullCoverage) {
        return leftHasFullCoverage ? -1 : 1;
      }

      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }

      if (right.termMatchCount !== left.termMatchCount) {
        return right.termMatchCount - left.termMatchCount;
      }

      if (left.anchorSec !== right.anchorSec) {
        return left.anchorSec - right.anchorSec;
      }

      return left.chunkStartSec - right.chunkStartSec;
    });

  return applyDiversityFilter(scored, limit);
}

function mapCandidateRowToSearchResult(
  row: SearchChunkCandidateRow,
  queryTerms: string[],
  preroll: number,
): SearchResult {
  const exactMatchedTerms = normalizeMatchedTerms(row.matched_terms, queryTerms);
  const fuzzySummary = resolveQueryTermCoverage(queryTerms, row.norm_text, exactMatchedTerms);
  const matchedTerms = fuzzySummary.matchedChunkTerms;
  const termMatchCount = Math.max(row.term_match_count, fuzzySummary.matchedQueryTermCount);
  const termHitCount = Math.max(row.term_hit_count, row.term_hit_count + fuzzySummary.fuzzyHitCount);
  const keywordScore = queryTerms.length === 0 ? 0 : termMatchCount / queryTerms.length;
  const coverageScore = computeCoverageScore({
    termMatchCount,
    termHitCount,
    queryTermCount: Math.max(queryTerms.length, 1),
    tokenCount: Math.max(row.token_count, 1),
  });
  const relevance = combineRelevanceScores({
    keywordScore,
    textScore: row.text_score,
    coverageScore,
  });
  const anchorSec = clamp(row.anchor_sec, row.chunk_start_sec, row.chunk_end_sec);
  const recommendedStartSec = clamp(
    Number.isFinite(row.recommended_start_sec) ? row.recommended_start_sec : anchorSec - preroll,
    row.chunk_start_sec,
    row.chunk_end_sec,
  );

  return {
    id: row.chunk_id,
    chunkId: row.chunk_id,
    videoId: row.video_id,
    chunkStartSec: row.chunk_start_sec,
    chunkEndSec: row.chunk_end_sec,
    anchorSec,
    recommendedStartSec,
    snippet: buildSnippet(row.full_text, matchedTerms),
    fullText: row.full_text,
    normText: row.norm_text,
    tokenCount: Math.max(row.token_count, 0),
    termMatchCount,
    termHitCount: Math.max(termHitCount, 0),
    matchedTerms,
    keywordScore: relevance.keywordScore,
    textScore: relevance.textScore,
    coverageScore: relevance.coverageScore,
    finalScore: applyBehaviorScore(relevance.finalScore, 0),
    rankReason: buildRankReason({
      matchedTerms,
      keywordScore: relevance.keywordScore,
      textScore: relevance.textScore,
      coverageScore: relevance.coverageScore,
    }),
  };
}

function applyDiversityFilter(results: SearchResult[], limit: number): SearchResult[] {
  if (results.length === 0 || limit <= 0) {
    return [];
  }

  const selected: SearchResult[] = [];
  const byVideo = new Map<string, SearchResult[]>();
  const selectedChunkIds = new Set<string>();

  // Pass 1: maximize video diversity first (one result per video).
  for (const candidate of results) {
    const sameVideoSelected = byVideo.get(candidate.videoId);
    if (sameVideoSelected && sameVideoSelected.length > 0) {
      continue;
    }

    selected.push(candidate);
    selectedChunkIds.add(candidate.chunkId);
    byVideo.set(candidate.videoId, [candidate]);

    if (selected.length >= limit) {
      break;
    }
  }

  // Pass 2: backfill with a second result per video when limit is not met.
  if (selected.length < limit) {
    for (const candidate of results) {
      if (selectedChunkIds.has(candidate.chunkId)) {
        continue;
      }

      const sameVideoSelected = byVideo.get(candidate.videoId) ?? [];
      if (sameVideoSelected.length === 0 || sameVideoSelected.length >= SAME_VIDEO_MAX_RESULTS) {
        continue;
      }

      if (isNearDuplicateWithinVideo(sameVideoSelected, candidate)) {
        continue;
      }

      selected.push(candidate);
      selectedChunkIds.add(candidate.chunkId);
      byVideo.set(candidate.videoId, [...sameVideoSelected, candidate]);

      if (selected.length >= limit) {
        break;
      }
    }
  }

  return selected;
}

function isNearDuplicateWithinVideo(existing: SearchResult[], candidate: SearchResult): boolean {
  return existing.some((row) => {
    const iou = computeIntervalIoU(
      { startSec: row.chunkStartSec, endSec: row.chunkEndSec },
      { startSec: candidate.chunkStartSec, endSec: candidate.chunkEndSec },
    );

    if (iou >= SAME_VIDEO_NEAR_DUPLICATE_IOU_THRESHOLD) {
      return true;
    }

    return Math.abs(row.chunkStartSec - candidate.chunkStartSec) < SAME_VIDEO_NEAR_DUPLICATE_START_GAP_SEC;
  });
}

function normalizeMatchedTerms(value: unknown, queryTerms: string[]): string[] {
  const querySet = new Set(queryTerms);

  if (!Array.isArray(value)) {
    return queryTerms;
  }

  const matched = value
    .map((term) => (typeof term === "string" ? normalizeForSearch(term) : ""))
    .filter((term) => term.length > 0 && querySet.has(term));

  return Array.from(new Set(matched));
}

function buildLookupQueryText(rawQuery: string, queryTerms: string[]): string {
  const expandedTerms = buildLookupQueryTerms(queryTerms);
  if (expandedTerms.length > 0) {
    return expandedTerms.join(" ");
  }

  return normalizeForSearch(rawQuery);
}

function buildLookupQueryTerms(queryTerms: string[]): string[] {
  const expanded = new Set<string>();

  for (const term of queryTerms) {
    if (!term) {
      continue;
    }

    expanded.add(term);
    const aliases = QUERY_TERM_LOOKUP_ALIASES.get(term) ?? [];
    for (const alias of aliases) {
      if (alias) {
        expanded.add(alias);
      }
    }
  }

  return Array.from(expanded);
}

function resolveQueryTermCoverage(
  queryTerms: string[],
  normText: string,
  exactMatchedTerms: string[],
): {
  matchedQueryTermCount: number;
  matchedChunkTerms: string[];
  fuzzyHitCount: number;
} {
  if (queryTerms.length === 0) {
    return {
      matchedQueryTermCount: 0,
      matchedChunkTerms: [],
      fuzzyHitCount: 0,
    };
  }

  const chunkTokens = tokenizeNormText(normText);
  const uniqueChunkTokens = Array.from(new Set(chunkTokens));
  const exactSet = new Set(exactMatchedTerms);
  const matchedChunkTermSet = new Set(exactMatchedTerms);

  let matchedQueryTermCount = exactSet.size;
  let fuzzyHitCount = 0;

  for (const queryTerm of queryTerms) {
    if (exactSet.has(queryTerm)) {
      continue;
    }

    const fuzzyToken = findFuzzyChunkTokenMatch(queryTerm, uniqueChunkTokens);
    if (!fuzzyToken) {
      continue;
    }

    matchedQueryTermCount += 1;
    matchedChunkTermSet.add(fuzzyToken);
    fuzzyHitCount += countTokenOccurrence(chunkTokens, fuzzyToken);
  }

  return {
    matchedQueryTermCount,
    matchedChunkTerms: Array.from(matchedChunkTermSet),
    fuzzyHitCount,
  };
}

function tokenizeNormText(normText: string): string[] {
  if (!normText) {
    return [];
  }

  return normText.split(/\s+/).filter(Boolean);
}

function countTokenOccurrence(tokens: string[], target: string): number {
  if (!target) {
    return 0;
  }

  let count = 0;
  for (const token of tokens) {
    if (token === target) {
      count += 1;
    }
  }

  return count;
}

function findFuzzyChunkTokenMatch(queryTerm: string, chunkTokens: string[]): string | null {
  if (queryTerm.length < 4 || chunkTokens.length === 0) {
    return null;
  }

  let best: { token: string; similarity: number; distance: number } | null = null;

  for (const token of chunkTokens) {
    if (!token || token.length < 3 || token === queryTerm) {
      continue;
    }

    if (commonPrefixLength(queryTerm, token) < 2) {
      continue;
    }

    const distance = levenshteinDistance(queryTerm, token);
    const maxLength = Math.max(queryTerm.length, token.length);
    const similarity = 1 - distance / maxLength;
    const isNearMatch =
      (distance <= 1 && similarity >= 0.72) ||
      (distance <= 2 && similarity >= 0.86);

    if (!isNearMatch) {
      continue;
    }

    if (
      best === null ||
      similarity > best.similarity ||
      (similarity === best.similarity && distance < best.distance)
    ) {
      best = {
        token,
        similarity,
        distance,
      };
    }
  }

  return best?.token ?? null;
}

function commonPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      const deletion = previous[column] + 1;
      const insertion = current[column - 1] + 1;
      const substitution = previous[column - 1] + substitutionCost;

      current[column] = Math.min(deletion, insertion, substitution);
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

function buildRankReason(input: {
  matchedTerms: string[];
  keywordScore: number;
  textScore: number;
  coverageScore: number;
}): string {
  const termText = input.matchedTerms.length > 0 ? input.matchedTerms.join(",") : "none";

  return `terms=${termText};kw=${input.keywordScore.toFixed(3)};txt=${input.textScore.toFixed(3)};cov=${input.coverageScore.toFixed(3)}`;
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(value), MIN_LIMIT), MAX_LIMIT);
}

export function clampPreroll(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PREROLL;
  }

  return clamp(value, MIN_PREROLL, MAX_PREROLL);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function applyBehaviorScore(relevanceScore: number, feedbackScore: number): number {
  if (!BEHAVIOR_SCORING_ENABLED) {
    return relevanceScore;
  }

  return relevanceScore + BEHAVIOR_SCORE_ALPHA * feedbackScore;
}

function isSyntheticScaleCandidate(videoId: string): boolean {
  return SYNTHETIC_SCALE_VIDEO_SUFFIX_PATTERN.test(videoId);
}
