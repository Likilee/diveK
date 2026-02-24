# Search Benchmark Guide (1x / 5x / 10x)

## 목적
- 검색 성능 게이트를 자동 검증한다.
- 실패 기준: `p95 > 150ms` 또는 `errorRate > 1%`.

## 데이터 스케일 정의
- `1x`: smoke ingest 원본 데이터.
- `5x`: `scale_search_dataset` RPC로 2~5배 복제.
- `10x`: `scale_search_dataset` RPC로 6~10배 복제.

## 실행 순서
1. `pnpm supabase:start`
2. `pnpm supabase:reset`
3. `pnpm cli ingest run --video-ids-file .cache/sebasi15-video-ids-smoke.txt --checkpoint .cache/ingestion-phase1-smoke-v5.json`
4. `pnpm bench:search --sample-size 80 --runs-per-query 3 --scales 1,5,10 --auto-scale --gate-p95-ms 150 --gate-error-rate 0.01 --out .cache/search-benchmark-report.json`

## 결과 파일
- 벤치 리포트: `.cache/search-benchmark-report.json`
- 품질 지표 리포트: `.cache/search-metrics-report.json`

## 참고
- 자동 스케일은 DB의 `scale_search_dataset(integer)`를 사용한다.
- 벤치 쿼리는 `chunk_terms`에서 샘플링하며, 부족 시 fallback 쿼리를 사용한다.
