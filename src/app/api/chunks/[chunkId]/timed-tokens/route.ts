import { NextResponse } from "next/server";
import { getTimedTokensForChunk } from "@/lib/search/search-service";

type RouteContext = {
  params: Promise<{
    chunkId: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: RouteContext) {
  const { chunkId } = await context.params;

  if (!chunkId) {
    return NextResponse.json({ error: "chunkId is required" }, { status: 400 });
  }

  const timedTokens = await getTimedTokensForChunk(chunkId);

  if (!timedTokens) {
    return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
  }

  return NextResponse.json({
    chunkId,
    timedTokens: timedTokens.map((token) => ({
      token: token.token,
      start_time: token.startTime,
      end_time: token.endTime,
    })),
  });
}
