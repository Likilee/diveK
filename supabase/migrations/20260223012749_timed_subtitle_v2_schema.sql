-- Search-performance-first schema (Phase 1 + Phase 2 readiness)
-- Breaking change by design: previous compatibility tables/functions are removed.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Drop legacy compatibility surface.
drop function if exists public.search_video_chunks(text, text[], integer);
drop function if exists public.get_chunk_timed_tokens(uuid);
drop function if exists public.get_chunk_context_v1(uuid);
drop function if exists public.search_chunks_v1(text, integer, double precision);
drop function if exists public.explain_search_chunks_v1(text, integer, double precision);
drop function if exists public.normalize_search_text(text);
drop function if exists public.scale_search_dataset(integer);

drop table if exists public.chunk_tokens cascade;
drop table if exists public.chunk_terms cascade;
drop table if exists public.chunks cascade;
drop table if exists public.segments cascade;
drop table if exists public.videos cascade;
drop table if exists public.search_feedback_events cascade;
drop table if exists public.ranking_config cascade;
drop table if exists public.video_chunks cascade;
drop table if exists public.transcript_segments cascade;

create table if not exists public.videos (
  id text primary key,
  title text not null default 'unknown',
  duration_sec double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint videos_id_not_empty check (length(trim(id)) > 0),
  constraint videos_title_not_empty check (length(trim(title)) > 0),
  constraint videos_duration_nonnegative check (duration_sec is null or duration_sec >= 0),
  constraint videos_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.segments (
  id bigserial primary key,
  video_id text not null references public.videos(id) on delete cascade,
  seq integer not null check (seq >= 0),
  start_sec double precision not null check (start_sec >= 0),
  end_sec double precision not null,
  duration_sec double precision generated always as (end_sec - start_sec) stored,
  text text not null,
  norm_text text not null,
  token_count integer not null default 0 check (token_count >= 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint segments_video_seq_key unique (video_id, seq),
  constraint segments_end_after_start check (end_sec > start_sec),
  constraint segments_text_not_empty check (length(trim(text)) > 0),
  constraint segments_norm_text_not_empty check (length(trim(norm_text)) > 0)
);

create index if not exists segments_video_seq_idx on public.segments (video_id, seq);
create index if not exists segments_video_start_idx on public.segments (video_id, start_sec);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references public.videos(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  segment_start_seq integer not null check (segment_start_seq >= 0),
  segment_end_seq integer not null,
  chunk_start_sec double precision not null check (chunk_start_sec >= 0),
  chunk_end_sec double precision not null,
  full_text text not null,
  norm_text text not null,
  token_count integer not null default 0 check (token_count >= 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint chunks_video_chunk_index_key unique (video_id, chunk_index),
  constraint chunks_video_segment_range_key unique (video_id, segment_start_seq, segment_end_seq),
  constraint chunks_segment_seq_range check (segment_end_seq >= segment_start_seq),
  constraint chunks_end_after_start check (chunk_end_sec > chunk_start_sec),
  constraint chunks_full_text_not_empty check (length(trim(full_text)) > 0),
  constraint chunks_norm_text_not_empty check (length(trim(norm_text)) > 0)
);

create index if not exists chunks_video_start_idx on public.chunks (video_id, chunk_start_sec);
create index if not exists chunks_norm_text_trgm_idx on public.chunks using gin (norm_text gin_trgm_ops);

create table if not exists public.chunk_terms (
  chunk_id uuid not null references public.chunks(id) on delete cascade,
  term text not null,
  first_hit_sec double precision not null check (first_hit_sec >= 0),
  hit_count integer not null check (hit_count > 0),
  positions integer[] not null default '{}'::integer[],
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (chunk_id, term),
  constraint chunk_terms_term_not_empty check (length(trim(term)) > 0),
  constraint chunk_terms_positions_no_null check (array_position(positions, null) is null),
  constraint chunk_terms_positions_match_hit_count check (coalesce(array_length(positions, 1), 0) = hit_count)
);

create index if not exists chunk_terms_term_chunk_idx on public.chunk_terms (term, chunk_id);
create index if not exists chunk_terms_chunk_first_hit_idx on public.chunk_terms (chunk_id, first_hit_sec);

create table if not exists public.chunk_tokens (
  chunk_id uuid not null references public.chunks(id) on delete cascade,
  idx integer not null check (idx >= 0),
  token text not null,
  token_norm text not null,
  start_sec double precision not null check (start_sec >= 0),
  end_sec double precision not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (chunk_id, idx),
  constraint chunk_tokens_token_not_empty check (length(trim(token)) > 0),
  constraint chunk_tokens_token_norm_not_empty check (length(trim(token_norm)) > 0),
  constraint chunk_tokens_end_after_start check (end_sec > start_sec)
);

create index if not exists chunk_tokens_chunk_start_idx on public.chunk_tokens (chunk_id, start_sec);
create index if not exists chunk_tokens_token_norm_chunk_idx on public.chunk_tokens (token_norm, chunk_id);

-- Phase 2 readiness: behavior events are collected but not consumed in ranking by default.
create table if not exists public.search_feedback_events (
  id bigserial primary key,
  event_type text not null,
  session_id text,
  query text not null,
  chunk_id uuid references public.chunks(id) on delete set null,
  video_id text,
  result_index integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint search_feedback_events_event_type_check check (
    event_type in (
      'search_impression',
      'result_click',
      'play_5s',
      'play_15s',
      'replay_click',
      'next_within_5s'
    )
  ),
  constraint search_feedback_events_query_not_empty check (length(trim(query)) > 0),
  constraint search_feedback_events_result_index_nonnegative check (result_index is null or result_index >= 0),
  constraint search_feedback_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists search_feedback_events_created_idx
  on public.search_feedback_events (created_at desc);
create index if not exists search_feedback_events_event_type_idx
  on public.search_feedback_events (event_type, created_at desc);

create table if not exists public.ranking_config (
  key text primary key,
  value_json jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint ranking_config_value_object check (jsonb_typeof(value_json) = 'object')
);

insert into public.ranking_config (key, value_json)
values (
  'behavior_scoring',
  jsonb_build_object(
    'enabled', false,
    'alpha', 0.15,
    'minimum_exposures', 200
  )
)
on conflict (key) do nothing;

create or replace function public.normalize_search_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(coalesce(p_text, '')), '[^0-9a-z가-힣\s]+', ' ', 'g'),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.search_chunks_v1(
  p_query text,
  p_limit integer default 20,
  p_preroll double precision default 4
)
returns table (
  chunk_id uuid,
  video_id text,
  chunk_start_sec double precision,
  chunk_end_sec double precision,
  anchor_sec double precision,
  recommended_start_sec double precision,
  full_text text,
  norm_text text,
  token_count integer,
  matched_terms text[],
  term_match_count integer,
  term_hit_count integer,
  keyword_score double precision,
  text_score double precision,
  candidate_score double precision
)
language sql
stable
as $$
with normalized as (
  select
    public.normalize_search_text(p_query) as query_text,
    least(greatest(coalesce(p_limit, 20), 1), 300) as limit_count,
    least(greatest(coalesce(p_preroll, 4), 3.0), 5.0) as preroll_sec
),
query_terms as (
  select distinct term
  from normalized,
  lateral regexp_split_to_table(normalized.query_text, '\s+') as term
  where term <> ''
),
query_stats as (
  select greatest(count(*), 1)::double precision as query_term_count
  from query_terms
),
term_candidates as (
  select
    ct.chunk_id,
    array_agg(distinct ct.term order by ct.term) as matched_terms,
    count(distinct ct.term)::integer as term_match_count,
    sum(ct.hit_count)::integer as term_hit_count,
    min(ct.first_hit_sec) as anchor_sec
  from public.chunk_terms ct
  join query_terms qt on qt.term = ct.term
  group by ct.chunk_id
),
trigram_candidates as (
  select
    c.id as chunk_id,
    similarity(c.norm_text, normalized.query_text) as text_score
  from public.chunks c
  cross join normalized
  where normalized.query_text <> ''
    and c.norm_text % normalized.query_text
),
unioned as (
  select
    coalesce(tc.chunk_id, tg.chunk_id) as chunk_id,
    coalesce(tc.matched_terms, '{}'::text[]) as matched_terms,
    coalesce(tc.term_match_count, 0) as term_match_count,
    coalesce(tc.term_hit_count, 0) as term_hit_count,
    tc.anchor_sec,
    coalesce(tg.text_score, 0)::double precision as text_score
  from term_candidates tc
  full join trigram_candidates tg on tg.chunk_id = tc.chunk_id
),
capped as (
  select *
  from unioned
  order by
    (case when term_match_count > 0 then 1 else 0 end) desc,
    term_match_count desc,
    term_hit_count desc,
    text_score desc,
    chunk_id
  limit 300
),
scored as (
  select
    c.id as chunk_id,
    c.video_id,
    c.chunk_start_sec,
    c.chunk_end_sec,
    c.full_text,
    c.norm_text,
    c.token_count,
    capped.matched_terms,
    capped.term_match_count,
    capped.term_hit_count,
    coalesce(capped.anchor_sec, c.chunk_start_sec) as anchor_sec,
    capped.text_score,
    normalized.preroll_sec,
    normalized.limit_count,
    query_stats.query_term_count,
    (capped.term_match_count::double precision / query_stats.query_term_count) as keyword_score
  from capped
  join public.chunks c on c.id = capped.chunk_id
  cross join normalized
  cross join query_stats
)
select
  scored.chunk_id,
  scored.video_id,
  scored.chunk_start_sec,
  scored.chunk_end_sec,
  scored.anchor_sec,
  least(
    scored.chunk_end_sec,
    greatest(scored.chunk_start_sec, scored.anchor_sec - scored.preroll_sec)
  ) as recommended_start_sec,
  scored.full_text,
  scored.norm_text,
  scored.token_count,
  scored.matched_terms,
  scored.term_match_count,
  scored.term_hit_count,
  scored.keyword_score,
  scored.text_score,
  (scored.keyword_score * 0.72) + (scored.text_score * 0.28) as candidate_score
from scored
order by candidate_score desc, anchor_sec asc, chunk_start_sec asc
limit (
  select limit_count
  from normalized
);
$$;

create or replace function public.get_chunk_context_v1(
  p_chunk_id uuid
)
returns table (
  chunk_id uuid,
  video_id text,
  chunk_start_sec double precision,
  chunk_end_sec double precision,
  token_count integer,
  tokens jsonb
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.video_id,
    c.chunk_start_sec,
    c.chunk_end_sec,
    c.token_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'idx', ct.idx,
          'token', ct.token,
          'token_norm', ct.token_norm,
          'start_sec', ct.start_sec,
          'end_sec', ct.end_sec
        )
        order by ct.idx
      ) filter (where ct.chunk_id is not null),
      '[]'::jsonb
    ) as tokens
  from public.chunks c
  left join public.chunk_tokens ct on ct.chunk_id = c.id
  where c.id = p_chunk_id
  group by c.id;
$$;

create or replace function public.explain_search_chunks_v1(
  p_query text,
  p_limit integer default 20,
  p_preroll double precision default 4
)
returns table (plan text)
language plpgsql
as $$
begin
  return query
  execute format(
    'explain (analyze, buffers, format text) select * from public.search_chunks_v1(%L, %s, %s);',
    coalesce(p_query, ''),
    coalesce(p_limit, 20),
    coalesce(p_preroll, 4)
  );
end;
$$;

create or replace function public.scale_search_dataset(
  p_target_scale integer
)
returns table (
  target_scale integer,
  inserted_videos bigint,
  inserted_segments bigint,
  inserted_chunks bigint,
  inserted_terms bigint,
  inserted_tokens bigint
)
language plpgsql
as $$
declare
  scale_n integer;
  affected_rows bigint;
  total_inserted_videos bigint := 0;
  total_inserted_segments bigint := 0;
  total_inserted_chunks bigint := 0;
  total_inserted_terms bigint := 0;
  total_inserted_tokens bigint := 0;
begin
  if p_target_scale is null or p_target_scale < 1 then
    raise exception 'p_target_scale must be >= 1';
  end if;

  drop table if exists _base_videos;
  drop table if exists _base_segments;
  drop table if exists _base_chunks;
  drop table if exists _base_chunk_terms;
  drop table if exists _base_chunk_tokens;
  drop table if exists _chunk_scale_map;

  create temporary table _base_videos on commit drop as
    select id, title, duration_sec, metadata
    from public.videos
    where id !~ '__s[0-9]+$';

  create temporary table _base_segments on commit drop as
    select video_id, seq, start_sec, end_sec, text, norm_text, token_count
    from public.segments
    where video_id !~ '__s[0-9]+$';

  create temporary table _base_chunks on commit drop as
    select
      id,
      video_id,
      chunk_index,
      segment_start_seq,
      segment_end_seq,
      chunk_start_sec,
      chunk_end_sec,
      full_text,
      norm_text,
      token_count
    from public.chunks
    where video_id !~ '__s[0-9]+$';

  create temporary table _base_chunk_terms on commit drop as
    select
      ct.chunk_id,
      ct.term,
      ct.first_hit_sec,
      ct.hit_count,
      ct.positions
    from public.chunk_terms ct
    join _base_chunks bc on bc.id = ct.chunk_id;

  create temporary table _base_chunk_tokens on commit drop as
    select
      ct.chunk_id,
      ct.idx,
      ct.token,
      ct.token_norm,
      ct.start_sec,
      ct.end_sec
    from public.chunk_tokens ct
    join _base_chunks bc on bc.id = ct.chunk_id;

  create temporary table _chunk_scale_map (
    base_chunk_id uuid not null,
    new_chunk_id uuid not null,
    new_video_id text not null,
    chunk_index integer not null,
    segment_start_seq integer not null,
    segment_end_seq integer not null,
    chunk_start_sec double precision not null,
    chunk_end_sec double precision not null,
    full_text text not null,
    norm_text text not null,
    token_count integer not null
  ) on commit drop;

  if p_target_scale > 1 then
    for scale_n in 2..p_target_scale loop
      insert into public.videos (id, title, duration_sec, metadata)
      select
        bv.id || '__s' || scale_n::text,
        bv.title,
        bv.duration_sec,
        bv.metadata
      from _base_videos bv
      on conflict (id) do nothing;
      get diagnostics affected_rows = row_count;
      total_inserted_videos := total_inserted_videos + affected_rows;

      insert into public.segments (
        video_id,
        seq,
        start_sec,
        end_sec,
        text,
        norm_text,
        token_count
      )
      select
        bs.video_id || '__s' || scale_n::text,
        bs.seq,
        bs.start_sec,
        bs.end_sec,
        bs.text,
        bs.norm_text,
        bs.token_count
      from _base_segments bs
      on conflict (video_id, seq) do nothing;
      get diagnostics affected_rows = row_count;
      total_inserted_segments := total_inserted_segments + affected_rows;

      truncate table _chunk_scale_map;

      insert into _chunk_scale_map (
        base_chunk_id,
        new_chunk_id,
        new_video_id,
        chunk_index,
        segment_start_seq,
        segment_end_seq,
        chunk_start_sec,
        chunk_end_sec,
        full_text,
        norm_text,
        token_count
      )
      select
        bc.id,
        gen_random_uuid(),
        bc.video_id || '__s' || scale_n::text,
        bc.chunk_index,
        bc.segment_start_seq,
        bc.segment_end_seq,
        bc.chunk_start_sec,
        bc.chunk_end_sec,
        bc.full_text,
        bc.norm_text,
        bc.token_count
      from _base_chunks bc
      where not exists (
        select 1
        from public.chunks existing
        where existing.video_id = bc.video_id || '__s' || scale_n::text
          and existing.segment_start_seq = bc.segment_start_seq
          and existing.segment_end_seq = bc.segment_end_seq
      );

      insert into public.chunks (
        id,
        video_id,
        chunk_index,
        segment_start_seq,
        segment_end_seq,
        chunk_start_sec,
        chunk_end_sec,
        full_text,
        norm_text,
        token_count
      )
      select
        m.new_chunk_id,
        m.new_video_id,
        m.chunk_index,
        m.segment_start_seq,
        m.segment_end_seq,
        m.chunk_start_sec,
        m.chunk_end_sec,
        m.full_text,
        m.norm_text,
        m.token_count
      from _chunk_scale_map m;
      get diagnostics affected_rows = row_count;
      total_inserted_chunks := total_inserted_chunks + affected_rows;

      insert into public.chunk_terms (
        chunk_id,
        term,
        first_hit_sec,
        hit_count,
        positions
      )
      select
        m.new_chunk_id,
        bt.term,
        bt.first_hit_sec,
        bt.hit_count,
        bt.positions
      from _chunk_scale_map m
      join _base_chunk_terms bt on bt.chunk_id = m.base_chunk_id;
      get diagnostics affected_rows = row_count;
      total_inserted_terms := total_inserted_terms + affected_rows;

      insert into public.chunk_tokens (
        chunk_id,
        idx,
        token,
        token_norm,
        start_sec,
        end_sec
      )
      select
        m.new_chunk_id,
        btk.idx,
        btk.token,
        btk.token_norm,
        btk.start_sec,
        btk.end_sec
      from _chunk_scale_map m
      join _base_chunk_tokens btk on btk.chunk_id = m.base_chunk_id;
      get diagnostics affected_rows = row_count;
      total_inserted_tokens := total_inserted_tokens + affected_rows;
    end loop;
  end if;

  target_scale := p_target_scale;
  inserted_videos := total_inserted_videos;
  inserted_segments := total_inserted_segments;
  inserted_chunks := total_inserted_chunks;
  inserted_terms := total_inserted_terms;
  inserted_tokens := total_inserted_tokens;
  return next;
end;
$$;

grant execute on function public.search_chunks_v1(text, integer, double precision)
  to anon, authenticated, service_role;
grant execute on function public.get_chunk_context_v1(uuid)
  to anon, authenticated, service_role;
grant execute on function public.explain_search_chunks_v1(text, integer, double precision)
  to service_role;
grant execute on function public.scale_search_dataset(integer)
  to service_role;
