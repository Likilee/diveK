import { PlayerClient } from "@/app/player/player-client";
import { searchChunks } from "@/lib/search/search-service";

type PlayerQueryPageProps = {
  params: Promise<{
    query: string;
  }>;
};

export default async function PlayerQueryPage({ params }: PlayerQueryPageProps) {
  const resolved = await params;
  const query = normalizeQuerySegment(resolved.query);
  const results = await searchChunks(query, 50);

  return <PlayerClient key={`${query}:${results.length}`} query={query} initialIndex={0} results={results} />;
}

function normalizeQuerySegment(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("%")) {
    return trimmed;
  }

  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    return trimmed;
  }
}
