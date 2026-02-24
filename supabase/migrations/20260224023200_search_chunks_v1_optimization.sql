-- Optimize candidate retrieval to stay under latency gate at higher data scales.

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
term_hits as (
  select
    ct.chunk_id,
    ct.term,
    ct.first_hit_sec,
    ct.hit_count
  from query_terms qt
  join public.chunk_terms ct on ct.term = qt.term
),
term_candidates as (
  select
    th.chunk_id,
    array_agg(distinct th.term order by th.term) as matched_terms,
    count(distinct th.term)::integer as term_match_count,
    sum(th.hit_count)::integer as term_hit_count,
    min(th.first_hit_sec) as anchor_sec
  from term_hits th
  group by th.chunk_id
),
trigram_candidates as (
  select
    c.id as chunk_id,
    similarity(c.norm_text, normalized.query_text) as text_score
  from normalized
  join lateral (
    select
      c.id,
      c.norm_text
    from public.chunks c
    where normalized.query_text <> ''
      and char_length(normalized.query_text) >= 6
      and c.norm_text % normalized.query_text
    order by similarity(c.norm_text, normalized.query_text) desc
    limit 300
  ) c on true
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
    c.chunk_id,
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
  cross join normalized
  cross join query_stats
  join lateral (
    select
      c.id as chunk_id,
      c.video_id,
      c.chunk_start_sec,
      c.chunk_end_sec,
      c.full_text,
      c.norm_text,
      c.token_count
    from public.chunks c
    where c.id = capped.chunk_id
  ) c on true
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
