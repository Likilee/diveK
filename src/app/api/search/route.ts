import { NextRequest, NextResponse } from "next/server";
import { searchChunks } from "@/lib/search/search-service";
import type { SearchResult } from "@/types/search";

export const dynamic = "force-dynamic";

type SearchResponse = {
  query: string;
  count: number;
  results: SearchResult[];
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = clampLimit(limitParam);

  if (!query) {
    return NextResponse.json<SearchResponse>({
      query,
      count: 0,
      results: [],
    });
  }

  const ranked = searchChunks(query, limit);

  return NextResponse.json<SearchResponse>({
    query,
    count: ranked.length,
    results: ranked,
  });
}

function clampLimit(value: string | null): number {
  if (!value) {
    return 20;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(parsed, 1), 50);
}
