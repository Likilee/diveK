-- Timed Subtitle v2 schema for K-Context
-- Preserves canonical subtitle segments and chunk-level search/playback data.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.transcript_segments (
  id bigserial primary key,
  video_id text not null,
  seq integer not null check (seq >= 0),
  start_time double precision not null check (start_time >= 0),
  end_time double precision not null,
  duration double precision generated always as (end_time - start_time) stored,
  text text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint transcript_segments_end_after_start check (end_time > start_time),
  constraint transcript_segments_video_id_seq_key unique (video_id, seq),
  constraint transcript_segments_text_nonempty check (length(trim(text)) > 0)
);

create index if not exists transcript_segments_video_start_time_idx
  on public.transcript_segments (video_id, start_time);

create table if not exists public.video_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  start_time double precision not null check (start_time >= 0),
  end_time double precision not null,
  segment_start_seq integer not null check (segment_start_seq >= 0),
  segment_end_seq integer not null,
  keywords text[] not null default '{}'::text[],
  full_text text not null,
  timed_tokens jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint video_chunks_end_after_start check (end_time > start_time),
  constraint video_chunks_segment_seq_range check (segment_end_seq >= segment_start_seq),
  constraint video_chunks_full_text_nonempty check (length(trim(full_text)) > 0),
  constraint video_chunks_keywords_no_null check (array_position(keywords, null) is null),
  constraint video_chunks_timed_tokens_is_array check (jsonb_typeof(timed_tokens) = 'array')
);

create index if not exists video_chunks_video_start_time_idx
  on public.video_chunks (video_id, start_time);

create index if not exists video_chunks_keywords_gin_idx
  on public.video_chunks using gin (keywords);

create index if not exists video_chunks_full_text_trgm_idx
  on public.video_chunks using gin (full_text gin_trgm_ops);

create index if not exists video_chunks_timed_tokens_gin_idx
  on public.video_chunks using gin (timed_tokens jsonb_path_ops);
