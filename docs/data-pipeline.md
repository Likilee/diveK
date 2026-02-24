# Data Pipeline Architecture (Search Performance First)

## Overview
파이프라인은 `segments -> chunks -> chunk_terms/chunk_tokens` 구조로 검색 런타임 파싱 비용을 제거하는 데 목적이 있습니다.

## Flow
1. Transcript normalize
- 입력: YouTube transcript
- 출력: `{seq, startTime, endTime, text, normText, tokenCount}`

2. Segment upsert
- 테이블: `segments`
- 제약: `UNIQUE(video_id, seq)`

3. Sliding window chunking
- 기본: 15초 window, 5초 overlap
- 출력: `chunk_index`, `segment_start_seq`, `segment_end_seq`, `full_text`, `norm_text`, `token_count`

4. Term/Token index build
- `chunk_terms(term, first_hit_sec, hit_count, positions)`
- `chunk_tokens(idx, token, token_norm, start_sec, end_sec)`

5. Upsert
- 테이블: `videos`, `chunks`, `chunk_terms`, `chunk_tokens`

## Search Runtime
- SQL 후보: `search_chunks_v1`
- 입력: `q`, `limit`, `preroll`
- 출력: `anchorSec`, `recommendedStartSec`, score components
- 서비스 리랭크: keyword/text/coverage + diversity filter

## Playback Runtime
- 검색 결과 Top1 즉시 재생
- 컨텍스트 API: `GET /api/chunks/[chunkId]/context`
- 폴링 제거, 단건 context + 로컬 캐시

## Phase 2 Readiness
- 이벤트 테이블: `search_feedback_events`
- 이벤트 타입: `search_impression`, `result_click`, `play_5s`, `play_15s`, `replay_click`, `next_within_5s`
- Phase 1에서는 relevance-only 강제 (`behavior scoring OFF`)
