"use client";

import { useRouter } from "next/navigation";
import type { SearchResult } from "@/types/search";

type SearchResultCardProps = {
  result: SearchResult;
};

export function SearchResultCard({ result }: SearchResultCardProps) {
  const router = useRouter();

  const onNavigateToPlayer = () => {
    const query = (result.matchedTerms.join(" ").trim() || result.snippet.slice(0, 40).trim()).trim();
    if (!query) {
      return;
    }

    router.push(`/player/${encodeURIComponent(query)}`);
  };

  return (
    <button type="button" className="result-card" onClick={onNavigateToPlayer}>
      <div className="result-card-topline">
        <span className="chip">{result.videoId}</span>
        <span className="score">score {result.finalScore.toFixed(2)}</span>
      </div>
      <p className="snippet">{renderHighlightedSnippet(result.snippet, result.matchedTerms)}</p>
      <div className="result-meta">
        <span>
          {formatTime(result.chunkStartSec)} - {formatTime(result.chunkEndSec)}
        </span>
        <span className="jump-link">클립 열기</span>
      </div>
    </button>
  );
}

function renderHighlightedSnippet(snippet: string, matchedTerms: string[]) {
  if (matchedTerms.length === 0) {
    return snippet;
  }

  const escapedTerms = matchedTerms
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (escapedTerms.length === 0) {
    return snippet;
  }

  const expression = new RegExp(`(${escapedTerms.join("|")})`, "giu");
  const parts = snippet.split(expression);

  return parts.map((part, index) => {
    const isMatch = matchedTerms.some((term) => part.toLowerCase() === term.toLowerCase());
    if (!isMatch) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    return (
      <mark key={`${part}-${index}`} className="snippet-mark">
        {part}
      </mark>
    );
  });
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
