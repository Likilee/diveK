import { NextResponse } from "next/server";
import { getVideoSegments } from "@/lib/search/search-service";

type RouteContext = {
  params: Promise<{
    videoId: string;
  }>;
};

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: RouteContext) {
  const { videoId } = await context.params;

  if (!videoId) {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  const segments = await getVideoSegments(videoId);

  return NextResponse.json({ videoId, segments });
}
