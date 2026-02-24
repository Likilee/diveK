import type { ChunkContext, TimedToken } from "@/types/search";
import { normalizeForSearch } from "@/lib/search/ranking";

type MockChunk = {
  chunkId: string;
  videoId: string;
  chunkStartSec: number;
  chunkEndSec: number;
  fullText: string;
};

const seed: MockChunk[] = [
  {
    chunkId: "mud-001",
    videoId: "dQw4w9WgXcQ",
    chunkStartSec: 84,
    chunkEndSec: 99,
    fullText: "야 이 장면 진짜 웃기다. 아까 그 멘트 다시 생각나서 빵 터졌다.",
  },
  {
    chunkId: "mud-002",
    videoId: "5NV6Rdv1a3I",
    chunkStartSec: 412,
    chunkEndSec: 427,
    fullText: "그거 레전드 밈 맞지? 다들 댓글에 그 대사만 적더라.",
  },
  {
    chunkId: "mud-003",
    videoId: "fJ9rUzIMcZQ",
    chunkStartSec: 125,
    chunkEndSec: 140,
    fullText: "이 부분에서 갑자기 텐션 올라가면서 분위기가 완전 뒤집혔다.",
  },
  {
    chunkId: "mud-004",
    videoId: "9bZkp7q19f0",
    chunkStartSec: 233,
    chunkEndSec: 248,
    fullText: "진짜 웃긴 포인트는 표정이랑 타이밍이 동시에 맞아떨어지는 순간이야.",
  },
  {
    chunkId: "mud-005",
    videoId: "YQHsXMglC9A",
    chunkStartSec: 57,
    chunkEndSec: 72,
    fullText: "그 대사 한마디 때문에 밈이 퍼졌고 쇼츠에서도 계속 재사용됐다.",
  },
  {
    chunkId: "mud-006",
    videoId: "3JZ_D3ELwOQ",
    chunkStartSec: 301,
    chunkEndSec: 316,
    fullText: "이 클립 찾으려고 하루 종일 검색했는데 드디어 원본을 찾았다.",
  },
  {
    chunkId: "mud-007",
    videoId: "kJQP7kiw5Fk",
    chunkStartSec: 188,
    chunkEndSec: 203,
    fullText: "댓글에서 다들 이 장면이 무한 반복 재생되는 구간이라고 하더라.",
  },
  {
    chunkId: "mud-008",
    videoId: "L_jWHffIx5E",
    chunkStartSec: 509,
    chunkEndSec: 524,
    fullText: "너가 찾던 바로 그 말투야. 톤이랑 억양까지 완전히 똑같다.",
  },
];

export const MOCK_SEARCH_CORPUS = seed.map((row) => {
  const tokens = buildMockTimedTokens(row.fullText, row.chunkStartSec, row.chunkEndSec);

  return {
    ...row,
    normText: normalizeForSearch(row.fullText),
    tokenCount: tokens.length,
    tokens,
  };
});

export const MOCK_CHUNK_CONTEXTS = new Map<string, ChunkContext>(
  MOCK_SEARCH_CORPUS.map((chunk) => [
    chunk.chunkId,
    {
      chunkId: chunk.chunkId,
      videoId: chunk.videoId,
      chunkStartSec: chunk.chunkStartSec,
      chunkEndSec: chunk.chunkEndSec,
      tokenCount: chunk.tokenCount,
      tokens: chunk.tokens,
    } satisfies ChunkContext,
  ]),
);

function buildMockTimedTokens(text: string, startSec: number, endSec: number): TimedToken[] {
  const tokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const duration = Math.max(endSec - startSec, 0.2);
  const step = duration / tokens.length;

  return tokens.map((token, index) => {
    const tokenStartSec = startSec + step * index;
    const tokenEndSec = index === tokens.length - 1 ? endSec : tokenStartSec + step;

    return {
      idx: index,
      token,
      tokenNorm: normalizeForSearch(token),
      startSec: tokenStartSec,
      endSec: tokenEndSec,
    } satisfies TimedToken;
  });
}
