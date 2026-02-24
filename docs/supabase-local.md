# Supabase Local Setup

이 프로젝트는 Supabase 로컬 스택을 기본 포트 충돌 없이 실행하도록 설정되어 있습니다.

## Ports
- API: `http://127.0.0.1:56421`
- DB: `postgresql://postgres:postgres@127.0.0.1:56422/postgres`
- Studio: `http://127.0.0.1:56423`
- Mailpit: `http://127.0.0.1:56424`

## Commands
```bash
pnpm supabase:start
pnpm supabase:status
pnpm supabase:env
pnpm supabase:reset
pnpm supabase:stop
```

## What `supabase:reset` does
- 로컬 DB 재생성
- migration 재적용
- `supabase/seed.sql` 실행

## Applied Migrations
- `supabase/migrations/20260223012749_timed_subtitle_v2_schema.sql`
- `supabase/migrations/20260224023200_search_chunks_v1_optimization.sql`
- `supabase/migrations/20260224024700_search_chunks_v1_term_index_lookup.sql`

## Core Tables
- `public.videos`
- `public.segments`
- `public.chunks`
- `public.chunk_terms`
- `public.chunk_tokens`
- `public.search_feedback_events`
- `public.ranking_config`

## Key Functions
- `public.search_chunks_v1(text, integer, double precision)`
- `public.get_chunk_context_v1(uuid)`
- `public.explain_search_chunks_v1(text, integer, double precision)`
- `public.scale_search_dataset(integer)`

## Optional: Next.js env
`pnpm supabase:env` 출력 값을 `.env.local`에 반영합니다.
필수 키:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
