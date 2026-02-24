import type { SupabaseClient } from "@supabase/supabase-js";

export const SEARCH_FEEDBACK_EVENT_TYPES = [
  "search_impression",
  "result_click",
  "play_5s",
  "play_15s",
  "replay_click",
  "next_within_5s",
] as const;

export type SearchFeedbackEventType = (typeof SEARCH_FEEDBACK_EVENT_TYPES)[number];

export type SearchFeedbackEventInput = {
  eventType: SearchFeedbackEventType;
  query: string;
  sessionId?: string;
  chunkId?: string;
  videoId?: string;
  resultIndex?: number;
  metadata?: Record<string, unknown>;
};

export async function insertSearchFeedbackEvent(
  client: SupabaseClient,
  input: SearchFeedbackEventInput,
): Promise<void> {
  const { error } = await client.from("search_feedback_events").insert({
    event_type: input.eventType,
    session_id: input.sessionId ?? null,
    query: input.query,
    chunk_id: input.chunkId ?? null,
    video_id: input.videoId ?? null,
    result_index: typeof input.resultIndex === "number" ? input.resultIndex : null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(`Failed to insert search feedback event: ${error.message}`);
  }
}

export function isSearchFeedbackEventType(value: string): value is SearchFeedbackEventType {
  return SEARCH_FEEDBACK_EVENT_TYPES.includes(value as SearchFeedbackEventType);
}
