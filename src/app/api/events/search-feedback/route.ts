import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/db/supabase-admin";
import {
  insertSearchFeedbackEvent,
  isSearchFeedbackEventType,
  type SearchFeedbackEventInput,
} from "@/lib/db/repositories/search-feedback";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parsePayload(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const client = getSupabaseAdminClient();
    await insertSearchFeedbackEvent(client, parsed.value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown insert error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parsePayload(value: unknown):
  | { ok: true; value: SearchFeedbackEventInput }
  | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Body must be an object" };
  }

  const eventTypeRaw = (value as { eventType?: unknown }).eventType;
  const queryRaw = (value as { query?: unknown }).query;

  if (typeof eventTypeRaw !== "string" || !isSearchFeedbackEventType(eventTypeRaw)) {
    return { ok: false, error: "eventType is invalid" };
  }

  if (typeof queryRaw !== "string" || !queryRaw.trim()) {
    return { ok: false, error: "query is required" };
  }

  const sessionIdRaw = (value as { sessionId?: unknown }).sessionId;
  const chunkIdRaw = (value as { chunkId?: unknown }).chunkId;
  const videoIdRaw = (value as { videoId?: unknown }).videoId;
  const resultIndexRaw = (value as { resultIndex?: unknown }).resultIndex;
  const metadataRaw = (value as { metadata?: unknown }).metadata;

  if (sessionIdRaw !== undefined && typeof sessionIdRaw !== "string") {
    return { ok: false, error: "sessionId must be a string" };
  }

  if (chunkIdRaw !== undefined && typeof chunkIdRaw !== "string") {
    return { ok: false, error: "chunkId must be a string" };
  }

  if (videoIdRaw !== undefined && typeof videoIdRaw !== "string") {
    return { ok: false, error: "videoId must be a string" };
  }

  if (resultIndexRaw !== undefined) {
    if (typeof resultIndexRaw !== "number" || !Number.isInteger(resultIndexRaw) || resultIndexRaw < 0) {
      return { ok: false, error: "resultIndex must be a non-negative integer" };
    }
  }

  if (metadataRaw !== undefined && (typeof metadataRaw !== "object" || metadataRaw === null || Array.isArray(metadataRaw))) {
    return { ok: false, error: "metadata must be an object" };
  }

  return {
    ok: true,
    value: {
      eventType: eventTypeRaw,
      query: queryRaw.trim(),
      sessionId: typeof sessionIdRaw === "string" ? sessionIdRaw : undefined,
      chunkId: typeof chunkIdRaw === "string" ? chunkIdRaw : undefined,
      videoId: typeof videoIdRaw === "string" ? videoIdRaw : undefined,
      resultIndex: typeof resultIndexRaw === "number" ? resultIndexRaw : undefined,
      metadata: typeof metadataRaw === "object" && metadataRaw !== null && !Array.isArray(metadataRaw)
        ? (metadataRaw as Record<string, unknown>)
        : undefined,
    },
  };
}
