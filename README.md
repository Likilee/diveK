# K-Context

검색 성능 우선(Phase 1) + 행동학습 준비(Phase 2)를 반영한 K-Context 검색/재생 시스템입니다.

## Stack
- Next.js 16 (App Router)
- React 19
- TypeScript
- Supabase (Postgres)
- pnpm

## Run
```bash
corepack enable
pnpm install
pnpm supabase:start
pnpm dev -p 3100
```

## Core Commands
```bash
# DB baseline reset
pnpm supabase:reset

# Smoke ingest
pnpm cli ingest run --video-ids-file .cache/sebasi15-video-ids-smoke.txt --checkpoint .cache/ingestion-phase1-smoke-v5.json

# Quality metrics
pnpm metrics:report --sample-size 120 --limit 10 --preroll 4 --out .cache/search-metrics-report.json

# Performance benchmark + gate (1x/5x/10x)
pnpm bench:search --sample-size 80 --runs-per-query 3 --scales 1,5,10 --auto-scale --gate-p95-ms 150 --gate-error-rate 0.01 --out .cache/search-benchmark-report.json
```

## Implemented
- 신규 검색 스키마: `videos`, `segments`, `chunks`, `chunk_terms`, `chunk_tokens`
- 검색 RPC: `search_chunks_v1(p_query, p_limit, p_preroll)`
- 플레이어 context RPC/API: `get_chunk_context_v1`, `GET /api/chunks/[chunkId]/context`
- `/api/search` 계약 개편 (`anchorSec`, `recommendedStartSec`, score breakdown)
- 서비스 리랭크(Keyword/Text/Coverage) + 다양성 필터(IoU, top10 video cap)
- Phase 2 이벤트 수집 스키마 + endpoint (`/api/events/search-feedback`)

## Docs
- Benchmark guide: `/Users/kihoon/Documents/Project/kcontext/docs/search-benchmark.md`
- Supabase local setup: `/Users/kihoon/Documents/Project/kcontext/docs/supabase-local.md`
- Pipeline reference: `/Users/kihoon/Documents/Project/kcontext/docs/data-pipeline.md`
