import { NextResponse } from "next/server";
import { getChunkContext } from "@/lib/search/search-service";

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

  const chunkContext = await getChunkContext(chunkId);

  if (!chunkContext) {
    return NextResponse.json({ error: "Chunk context not found" }, { status: 404 });
  }

  return NextResponse.json(chunkContext);
}
