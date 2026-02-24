# PRD: 검색 성능 최우선 리빌드 + 행동학습 2단계 로드맵

## 문서 메타
- 대상 파일: `/Users/kihoon/Documents/Project/kcontext/tasks/prd-search-performance-first-rebuild.md`
- 범위: `Phase 1 + Phase 2`
- UX 고정: `Top1 즉시 재생 유지`
- 성능 게이트: `검색 p95 <= 150ms`

## 1. Introduction / Overview
현재 시스템은 출시 전 단계이며 호환성 제약이 없다. 이번 작업의 목적은 검색/재생 파이프라인을 성능 중심으로 재설계해, 검색어에 맞는 결과를 빠르게 제공하고, 키워드 발생 시점보다 3~5초 앞에서 자연스럽게 재생을 시작하도록 만드는 것이다.
Phase 1에서는 정적 relevance 기반 품질을 완성하고, Phase 2에서 사용자 행동(반복 재생, 빠른 스킵 등)을 랭킹 점수에 반영한다.

## 2. Goals
- 검색 응답속도: 로컬 중간규모 데이터 기준 `p95 <= 150ms`.
- 시작점 정책: `recommendedStartSec = max(chunkStart, anchorSec - preroll)` 100% 준수.
- preroll 정책: `3~5초` 범위 강제, 기본값 4초.
- 재생 안정성: 초기 3초 내 seek 반복 p95 `<= 1`.
- 자막 싱크: 시작 drift p95 `<= 500ms`.
- 결과 적절성 자동지표: `TermHit@1 >= 95%`, `DupRate@10 <= 20%`.

## 3. User Stories

### US-001: 성능 최적화 스키마 베이스라인 구축
- 신규 Supabase migration에서 `videos`, `segments`, `chunks`, `chunk_terms`, `chunk_tokens` 생성
- 각 테이블의 PK/UK/인덱스가 PRD 스펙과 일치
- 기존 호환 컬럼/함수 의존 제거
- `pnpm supabase:reset` 성공
- Typecheck/lint passes

### US-002: CLI ingestion이 신규 검색 인덱스 데이터 생성
- 기존 입력(`--video-ids-file`)으로 ingestion 실행 가능
- `chunks.norm_text`, `chunks.token_count` 저장
- `chunk_terms(term, first_hit_sec, hit_count, positions)` 생성
- `chunk_tokens(idx, token, start_sec, end_sec)` 생성
- `.cache/sebasi15-video-ids-smoke.txt`로 적재 성공
- Typecheck/lint passes

### US-003: SQL 후보 검색 함수 구현
- `search_chunks_v1(p_query, p_limit, p_preroll)` 함수 구현
- term 매칭 + trigram 후보 union, 후보 상한 300 적용
- `anchorSec`, `recommendedStartSec` SQL/서비스 레이어에서 결정 가능
- `EXPLAIN ANALYZE`로 인덱스 사용 확인
- Typecheck/lint passes

### US-004: 서비스 리랭크 + 다양성 필터 구현
- 스코어 구성: `keywordScore`, `textScore`, `coverageScore`
- 최종점수 가중치: `keyword 0.55`, `text 0.30`, `coverage 0.15`
- same-video IoU>0.6 중복 제거
- top10에서 video당 최대 2개 제한
- `rankReason` 생성
- Typecheck/lint passes

### US-005: `/api/search` 응답 계약 개편
- 요청 파라미터 `q`, `limit`, `preroll` 지원
- 응답에 `anchorSec`, `recommendedStartSec`, 점수 분해 필드 포함
- snake_case 호환 필드 제거
- 빈 쿼리/잘못된 preroll 처리 명확화
- Typecheck/lint passes

### US-006: 플레이어 단건 context 로드 + 폴링 제거
- `GET /api/chunks/[chunkId]/context` 신규 구현
- 플레이어가 context 1회 로드로 자막 동기화 수행
- 주기적 `/api/videos/[videoId]/timed-tokens` 호출 제거
- soft correction 최대 1회 정책 적용
- Typecheck/lint passes
- Verify in browser using dev-browser skill

### US-007: 자동 품질지표 수집(라벨링 없음)
- 지표 계산: `TermHit@1`, `AnchorValid@1`, `PrerollPolicyPass@1`, `DupRate@10`, latency p50/p95/p99
- 지표 산출 스크립트 또는 리포트 경로 제공
- 샘플 데이터 기준 1회 리포트 생성 가능
- Typecheck/lint passes

### US-008: 성능 벤치 및 게이트 적용
- 1x/5x/10x 데이터 스케일 벤치 시나리오 문서화
- 검색 p95 측정 자동화
- 실패 기준: p95>150ms 또는 에러율>1%
- Typecheck/lint passes

### US-009: Phase 2 행동학습 준비(반영은 비활성)
- 이벤트 테이블/엔드포인트 스키마 정의(`search_impression`, `result_click`, `play_5s`, `play_15s`, `replay_click`, `next_within_5s`)
- 랭킹 반영 플래그 기본 OFF
- Phase 1에서는 relevance-only가 강제됨
- Typecheck/lint passes

## 4. Functional Requirements
- FR-1: 시스템은 기존 호환성 없이 신규 스키마로 동작해야 한다.
- FR-2: 시스템은 검색용 정규 텍스트(`norm_text`)를 저장해야 한다.
- FR-3: 시스템은 chunk별 term 인덱스(`chunk_terms`)를 저장해야 한다.
- FR-4: 시스템은 chunk별 시간 토큰(`chunk_tokens`)을 저장해야 한다.
- FR-5: 검색 API는 `preroll` 값을 3~5로 clamp 해야 한다.
- FR-6: 시스템은 `anchorSec`를 term 첫 매칭 시각 기준으로 계산해야 한다.
- FR-7: 시스템은 `recommendedStartSec`를 재생 가능한 범위로 보정해야 한다.
- FR-8: 검색 후보 쿼리는 인덱스 기반으로 동작해야 한다.
- FR-9: 랭킹은 점수 분해 필드를 반환해야 한다.
- FR-10: 랭킹은 중복 결과를 제거해야 한다.
- FR-11: 플레이어는 검색 결과에서 바로 Top1 즉시 재생해야 한다.
- FR-12: 플레이어는 context 단건 로드로 자막 동기화를 수행해야 한다.
- FR-13: 플레이어는 초기 반복 seek를 최소화해야 한다.
- FR-14: 시스템은 Phase 1에서 행동 점수를 랭킹에 반영하면 안 된다.
- FR-15: 시스템은 라벨링 없이 자동 품질 프록시 지표를 산출해야 한다.
- FR-16: 시스템은 성능 벤치 결과로 릴리즈 게이트를 판단할 수 있어야 한다.
- FR-17: ingestion은 `.cache/sebasi15-video-ids-smoke.txt` 입력으로 재현 가능해야 한다.
- FR-18: 지표/벤치 결과는 반복 실행 시 동일 기준으로 비교 가능해야 한다.

## 5. Non-Goals (Out of Scope)
- 수동 오프라인 정답셋 라벨링
- Phase 1에서 행동 기반 점수 반영
- 개인화 랭킹
- 멀티-암드 밴딧/탐색 트래픽 운영
- 기존 API 응답 포맷 유지

## 6. Design Considerations
- 사용자 플로우는 현재처럼 `검색 -> Top1 즉시 재생` 유지.
- Phase 1에서는 대안 결과 패널/리스트 페이지를 추가하지 않는다.
- 재생 UX는 “빠른 시작 + 최소 seek + 안정적 자막”을 우선한다.

## 7. Technical Considerations
- Supabase reset 기반으로 베이스라인 재시작: `pnpm supabase:reset`.
- seed SQL은 비워두고 CLI ingest를 단일 데이터 주입 경로로 사용.
- 데이터 적재 검증은 smoke 파일 우선: `/Users/kihoon/Documents/Project/kcontext/.cache/sebasi15-video-ids-smoke.txt`
- 성능 측정은 `EXPLAIN ANALYZE` + API latency 측정을 함께 사용.
- 플레이어는 서버 왕복을 줄이기 위해 context 응답을 로컬 캐시한다.

## 8. Success Metrics

### Phase 1 (반드시 달성)
- Search latency p95 `<= 150ms`
- `PrerollPolicyPass@1 = 100%`
- `AnchorValid@1 >= 99%`
- `TermHit@1 >= 95%`
- `DupRate@10 <= 20%`
- 초기 3초 seek count p95 `<= 1`
- start drift p95 `<= 500ms`

### Phase 2 (활성화 조건)
- 행동 이벤트 데이터가 충분히 누적될 때만 활성화
- 기본 식: `finalScore = relevanceScore + alpha * feedbackScore`
- 초기 alpha는 낮게 시작(예: 0.15), 최소 노출 미달 시 alpha=0 유지

## 9. 테스트 시나리오
- TS-1: migration 후 테이블/인덱스/함수 생성 검증
- TS-2: ingest 실행 후 `chunks/chunk_terms/chunk_tokens` row count 정합성 확인
- TS-3: `/api/search`의 `recommendedStartSec` 정책 준수 검증
- TS-4: 동일 쿼리에서 중복 제거 규칙 검증
- TS-5: 플레이어 시작점 및 soft correction 횟수 검증
- TS-6: 자막 활성 토큰이 재생 시간과 단조롭게 이동하는지 검증
- TS-7: 1x/5x/10x 벤치에서 p95 게이트 검증

## 10. Open Questions
- 없음 (본 PRD는 구현 결정을 잠금 상태로 정의함)

## 11. Assumptions / Defaults
- 출시 전이며 breaking change 허용
- 기본 preroll은 4초, 범위는 3~5초 고정
- Phase 1은 relevance-only 랭킹
- 행동 기반 랭킹은 Phase 2에서 별도 활성화
