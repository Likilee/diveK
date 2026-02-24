import { NextRequest, NextResponse } from "next/server";
import { clampLimit, clampPreroll, searchChunks } from "@/lib/search/search-service";
import type { SearchResult } from "@/types/search";

export const dynamic = "force-dynamic";

type SearchSuccessResponse = {
  query: string;
  limit: number;
  preroll: number;
  count: number;
  results: SearchResult[];
};

type SearchErrorResponse = {
  error: string;
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json<SearchErrorResponse>(
      { error: "q is required and must be non-empty" },
      { status: 400 },
    );
  }

  const parsedLimit = parseOptionalNumber(request.nextUrl.searchParams.get("limit"));
  if (parsedLimit.invalid) {
    return NextResponse.json<SearchErrorResponse>(
      { error: "limit must be a valid number" },
      { status: 400 },
    );
  }

  const parsedPreroll = parseOptionalNumber(request.nextUrl.searchParams.get("preroll"));
  if (parsedPreroll.invalid) {
    return NextResponse.json<SearchErrorResponse>(
      { error: "preroll must be a valid number" },
      { status: 400 },
    );
  }

  const limit = clampLimit(parsedLimit.value ?? 20);
  const preroll = clampPreroll(parsedPreroll.value ?? 4);
  const ranked = await searchChunks(query, limit, preroll);

  return NextResponse.json<SearchSuccessResponse>({
    query,
    limit,
    preroll,
    count: ranked.length,
    results: ranked,
  });
}

function parseOptionalNumber(value: string | null): { value: number | null; invalid: boolean } {
  if (value === null) {
    return { value: null, invalid: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, invalid: true };
  }

  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return { value: null, invalid: true };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return { value: null, invalid: true };
  }

  return { value: parsed, invalid: false };
}
