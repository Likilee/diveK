import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<unknown> }) {
  const params = (await context.params) as { videoId?: string };
  const videoId = params.videoId?.trim() ?? "";

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error: "Deprecated endpoint. Use /api/chunks/[chunkId]/context for single-shot subtitle sync.",
      videoId,
      path: request.nextUrl.pathname,
    },
    { status: 410 },
  );
}
