import { NextRequest, NextResponse } from "next/server";
import { getTimedTokensForVideoAtTime } from "@/lib/search/search-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<unknown> }) {
  const params = (await context.params) as { videoId?: string };
  const videoId = params.videoId?.trim() ?? "";
  const rawTime = request.nextUrl.searchParams.get("time");
  const parsedTime = rawTime ? Number.parseFloat(rawTime) : Number.NaN;

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  if (!Number.isFinite(parsedTime) || parsedTime < 0) {
    return NextResponse.json({ error: "Valid time query is required" }, { status: 400 });
  }

  const chunk = await getTimedTokensForVideoAtTime(videoId, parsedTime);

  if (!chunk) {
    return NextResponse.json({ error: "Timed chunk not found" }, { status: 404 });
  }

  return NextResponse.json({
    chunkId: chunk.chunkId,
    videoId: chunk.videoId,
    start_time: chunk.startTime,
    end_time: chunk.endTime,
    timedTokens: chunk.timedTokens.map((token) => ({
      token: token.token,
      start_time: token.startTime,
      end_time: token.endTime,
    })),
  });
}
