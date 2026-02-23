export function buildSnippet(fullText: string, matchedTerms: string[], maxLength = 120): string {
  if (!fullText) {
    return "";
  }

  if (fullText.length <= maxLength) {
    return fullText;
  }

  const firstTerm = matchedTerms[0]?.trim();

  if (!firstTerm) {
    return `${fullText.slice(0, maxLength - 1)}…`;
  }

  const lowerText = fullText.toLowerCase();
  const matchIndex = lowerText.indexOf(firstTerm.toLowerCase());

  if (matchIndex < 0) {
    return `${fullText.slice(0, maxLength - 1)}…`;
  }

  const contextPadding = Math.floor((maxLength - firstTerm.length) / 2);
  const start = Math.max(0, matchIndex - contextPadding);
  const end = Math.min(fullText.length, start + maxLength);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < fullText.length ? "…" : "";

  return `${prefix}${fullText.slice(start, end)}${suffix}`;
}
