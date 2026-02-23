import { NextRequest, NextResponse } from "next/server";
import { searchChunks } from "@/lib/search/search-service";
import type { SearchResult } from "@/types/search";

export const dynamic = "force-dynamic";

type SearchResponse = {
  query: string;
  count: number;
  results: Array<
    SearchResult & {
      chunk_id: string;
      video_id: string;
      start_time: number;
      end_time: number;
    }
  >;
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

  const ranked = await searchChunks(query, limit);

  return NextResponse.json<SearchResponse>({
    query,
    count: ranked.length,
    results: ranked.map((row) => ({
      ...row,
      chunk_id: row.chunkId,
      video_id: row.videoId,
      start_time: row.startTime,
      end_time: row.endTime,
    })),
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
