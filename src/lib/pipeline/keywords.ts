export const DEFAULT_KOREAN_STOPWORDS = [
  "그",
  "저",
  "이",
  "그리고",
  "그래서",
  "근데",
  "진짜",
  "정말",
  "아",
  "어",
  "음",
  "네",
  "응",
  "것",
  "수",
  "더",
  "좀",
  "또",
  "그거",
  "이거",
  "저거",
  "하다",
];

type ExtractKeywordOptions = {
  stopwords?: string[];
};

export function extractKeywords(text: string, options: ExtractKeywordOptions = {}): string[] {
  const stopwordSet = new Set((options.stopwords ?? DEFAULT_KOREAN_STOPWORDS).map((word) => normalizeToken(word)));

  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter(Boolean)
    .filter((token) => !stopwordSet.has(token));

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    unique.push(token);
  }

  return unique;
}

export function normalizeToken(token: string): string {
  const trimmed = token.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  const mapped = normalizeCommonVerbEnding(trimmed);
  return mapped;
}

function normalizeCommonVerbEnding(token: string): string {
  const h = token;

  // Korean verb/adjective ending approximations for deterministic normalized search terms.
  const suffixToDa: Array<[RegExp, string]> = [
    [/([\p{Script=Hangul}]+)했다$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)한다$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)해요$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)했어$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)하는$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)하며$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)하면$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)하고$/u, "$1하다"],
    [/([\p{Script=Hangul}]+)돼요$/u, "$1되다"],
    [/([\p{Script=Hangul}]+)됐다$/u, "$1되다"],
    [/([\p{Script=Hangul}]+)돼$/u, "$1되다"],
    [/([\p{Script=Hangul}]+)였어$/u, "$1이다"],
    [/([\p{Script=Hangul}]+)였다$/u, "$1이다"],
  ];

  for (const [pattern, replacement] of suffixToDa) {
    if (pattern.test(h)) {
      return h.replace(pattern, replacement);
    }
  }

  if (/^[\p{Script=Hangul}]{2,}$|^[a-z0-9]{2,}$/u.test(h)) {
    return h;
  }

  return "";
}
