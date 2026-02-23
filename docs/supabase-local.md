# Supabase Local Setup

이 프로젝트는 Supabase 로컬 스택을 기본 포트 충돌 없이 실행하도록 설정되어 있습니다.

## Ports
- API: `http://127.0.0.1:56421`
- DB: `postgresql://postgres:postgres@127.0.0.1:56422/postgres`
- Studio: `http://127.0.0.1:56423`
- Mailpit: `http://127.0.0.1:56424`

## Prerequisites
- Docker Desktop 실행 중
- Supabase CLI 설치 (`supabase --version`)

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

## Applied Migration
- `supabase/migrations/20260223012749_timed_subtitle_v2_schema.sql`
- 생성 테이블:
  - `public.transcript_segments`
  - `public.video_chunks`

## Optional: Next.js env for Supabase client
로컬 스택 실행 후 아래 출력을 복사해서 `.env.local`에 반영합니다.

```bash
pnpm supabase:env
```

필수 권장 키:
- `NEXT_PUBLIC_SUPABASE_URL` = `API_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` = `SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` = `DB_URL`
