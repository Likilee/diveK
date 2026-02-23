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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'video_chunks_identity_key'
  ) then
    alter table public.video_chunks
      add constraint video_chunks_identity_key
      unique (video_id, start_time, end_time, segment_start_seq, segment_end_seq);
  end if;
end $$;

create index if not exists video_chunks_video_start_time_idx
  on public.video_chunks (video_id, start_time);

create index if not exists video_chunks_keywords_gin_idx
  on public.video_chunks using gin (keywords);

create index if not exists video_chunks_full_text_trgm_idx
  on public.video_chunks using gin (full_text gin_trgm_ops);

create index if not exists video_chunks_timed_tokens_gin_idx
  on public.video_chunks using gin (timed_tokens jsonb_path_ops);

create or replace function public.search_video_chunks(
  p_query text,
  p_keywords text[],
  p_limit integer default 20
)
returns table (
  chunk_id uuid,
  video_id text,
  start_time double precision,
  end_time double precision,
  full_text text,
  keywords text[],
  score double precision
)
language sql
stable
as $$
  with normalized as (
    select
      coalesce(nullif(trim(lower(p_query)), ''), '') as query_text,
      coalesce(p_keywords, '{}'::text[]) as query_keywords,
      greatest(coalesce(array_length(p_keywords, 1), 0), 1) as keyword_count,
      least(greatest(coalesce(p_limit, 20), 1), 50) as limit_count
  ),
  scored as (
    select
      vc.id as chunk_id,
      vc.video_id,
      vc.start_time,
      vc.end_time,
      vc.full_text,
      vc.keywords,
      (
        select count(*)::double precision
        from unnest(vc.keywords) as kw
        where kw = any(normalized.query_keywords)
      ) / normalized.keyword_count as keyword_overlap,
      similarity(vc.full_text, normalized.query_text) as trigram_score,
      normalized.limit_count
    from public.video_chunks vc
    cross join normalized
  )
  select
    scored.chunk_id,
    scored.video_id,
    scored.start_time,
    scored.end_time,
    scored.full_text,
    scored.keywords,
    (scored.keyword_overlap * 0.7) + (scored.trigram_score * 0.3) as score
  from scored
  where scored.keyword_overlap > 0
     or scored.trigram_score > 0.05
  order by score desc, scored.start_time asc
  limit (select normalized.limit_count from normalized);
$$;

create or replace function public.get_chunk_timed_tokens(
  p_chunk_id uuid
)
returns jsonb
language sql
stable
as $$
  select vc.timed_tokens
  from public.video_chunks vc
  where vc.id = p_chunk_id;
$$;

grant execute on function public.search_video_chunks(text, text[], integer) to anon, authenticated, service_role;
grant execute on function public.get_chunk_timed_tokens(uuid) to anon, authenticated, service_role;
