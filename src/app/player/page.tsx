import { PlayerClient } from "@/app/player/player-client";
import { searchChunks } from "@/lib/search/search-service";

type PlayerPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    i?: string | string[];
  }>;
};

export default async function PlayerPage({ searchParams }: PlayerPageProps) {
  const params = await searchParams;
  const query = readFirst(params.q)?.trim() ?? "";
  const requestedIndex = sanitizeIndex(readFirst(params.i));
  const results = await searchChunks(query, 50);

  return <PlayerClient query={query} requestedIndex={requestedIndex} results={results} />;
}

function readFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function sanitizeIndex(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "0", 10);

  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}
