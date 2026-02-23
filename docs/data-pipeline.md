# Data Ingestion Pipeline Architecture (Timed Subtitle v2)

## 1. Overview
이 문서는 K-Context 파이프라인을 **정확한 자막 타이밍 보존** 기준으로 재정의합니다.
핵심 목표는 검색 정확도뿐 아니라, 플레이어에서 재생 시간에 맞춰 단어/구문 하이라이트를 안정적으로 제공하는 것입니다.

## 2. Core Principles
1. **문맥 단절 방지 (Sliding Window):** 15초 청크 + 5초 오버랩으로 검색 누락을 줄입니다.
2. **검색 최적화 (Keyword + Trigram):** 형태소 기반 키워드와 원문 유사도를 결합합니다.
3. **저장소 효율화:** 영상 원본 없이 텍스트/메타데이터만 저장합니다.
4. **타이밍 정밀도 보존 (Timing Fidelity):** 2~5초 원본 세그먼트의 `start_time/end_time`을 DB에 영구 저장합니다.
5. **재처리 가능성:** 원본 세그먼트를 잃지 않고 청킹/키워드 로직만 재실행 가능해야 합니다.

## 3. Data Transformation Steps

### Step 1: Raw Transcript Extraction (원본 자막 추출)
YouTube에서 가져온 자막을 정규화하여 아래 구조로 고정합니다.

```json
[
  { "seq": 0, "start_time": 12.0, "end_time": 15.0, "duration": 3.0, "text": "야, 너 저번에 그거" },
  { "seq": 1, "start_time": 15.0, "end_time": 17.5, "duration": 2.5, "text": "진짜 웃겼어." },
  { "seq": 2, "start_time": 17.5, "end_time": 21.5, "duration": 4.0, "text": "아 빵터졌네 진짜." }
]
```

정규화 규칙:
- 빈 문자열/공백 세그먼트는 제거
- `end_time <= start_time`이면 해당 세그먼트 제외
- `seq`는 영상 내 단조 증가

### Step 2: Persist Canonical Segments (정규 세그먼트 저장)
정규화된 세그먼트를 `transcript_segments`에 먼저 저장합니다.

이 단계가 있어야:
- 하이라이트 정확도 개선을 위한 재가공 가능
- 청크 로직 변경 시 원본 재수집 없이 재생성 가능

### Step 3: Sliding Window Chunking (문맥 청크 생성)
`transcript_segments`를 기반으로 15초/5초 오버랩 청크를 생성합니다.
각 청크는 단순 `full_text`뿐 아니라 **세그먼트 범위**와 **타이밍 토큰**을 함께 저장합니다.

청크 출력 예시:

```json
{
  "video_id": "abc123",
  "start_time": 10.0,
  "end_time": 25.0,
  "segment_start_seq": 0,
  "segment_end_seq": 4,
  "full_text": "야, 너 저번에 그거 진짜 웃겼어. 아 빵터졌네 진짜.",
  "timed_tokens": [
    { "token": "야", "start_time": 12.0, "end_time": 12.4 },
    { "token": "진짜", "start_time": 15.1, "end_time": 15.7 }
  ]
}
```

### Step 4: NLP Keyword Extraction (키워드 추출)
청크 단위 `full_text`에서 불용어 제거 + 명사/동사 원형 추출로 `keywords`를 만듭니다.

예시:
- 원문: `"야, 너 저번에 그거 진짜 웃겼어. 아 빵터졌네 진짜."`
- 키워드: `["야", "너", "진짜", "웃기다", "빵터지다"]`

### Step 5: Final DB Upsert (적재)
순서:
1. `transcript_segments` upsert
2. `video_chunks` upsert

배치 삽입 + 재시도(backoff) + 체크포인트 재개를 적용합니다.

## 4. Database Model (Supabase)

### 4.1 `transcript_segments` (정규 원본 레이어)
| Column | Type | 설명 |
| :--- | :--- | :--- |
| `id` | BIGSERIAL PK | 세그먼트 ID |
| `video_id` | TEXT | 유튜브 영상 ID |
| `seq` | INT | 영상 내 세그먼트 순번 |
| `start_time` | DOUBLE PRECISION | 세그먼트 시작 초 |
| `end_time` | DOUBLE PRECISION | 세그먼트 종료 초 |
| `duration` | DOUBLE PRECISION | `end_time - start_time` |
| `text` | TEXT | 세그먼트 원문 |
| `created_at` | TIMESTAMPTZ | 적재 시각 |

인덱스/제약:
- `UNIQUE(video_id, seq)`
- `INDEX(video_id, start_time)`

### 4.2 `video_chunks` (검색/재생 최적화 레이어)
| Column | Type | 설명 |
| :--- | :--- | :--- |
| `id` | UUID PK | 청크 ID |
| `video_id` | TEXT | 유튜브 영상 ID |
| `start_time` | DOUBLE PRECISION | 청크 시작 초 |
| `end_time` | DOUBLE PRECISION | 청크 종료 초 |
| `segment_start_seq` | INT | 청크 첫 세그먼트 순번 |
| `segment_end_seq` | INT | 청크 마지막 세그먼트 순번 |
| `keywords` | TEXT[] | 검색 키워드 배열 |
| `full_text` | TEXT | 청크 원문 |
| `timed_tokens` | JSONB | 토큰별 타이밍 배열 |
| `created_at` | TIMESTAMPTZ | 적재 시각 |

인덱스:
- `pg_trgm` + `GIN(full_text gin_trgm_ops)`
- `GIN(keywords)`
- `INDEX(video_id, start_time)`

## 5. API/Playback Contract
검색 API 응답은 최소 아래 필드를 반환합니다.
- `chunk_id`, `video_id`, `start_time`, `end_time`, `snippet`, `score`

플레이어는 `chunk_id` 기반으로 `timed_tokens`를 받아 재생 시간과 동기화된 하이라이트를 수행합니다.

## 6. Checkpoint and Resume
체크포인트는 로컬 파일(`/.cache/ingestion-checkpoint.json`)에 저장합니다.

권장 필드:
```json
{
  "last_video_id": "abc123",
  "last_segment_seq": 418,
  "last_chunk_start_time": 520.0,
  "updated_at": "2026-02-23T09:00:00Z"
}
```

## 7. End-to-End User Scenario
1. 로컬 CLI가 영상 자막을 수집해 `transcript_segments`에 저장
2. 청킹/NLP 처리 후 `video_chunks`에 적재
3. 사용자가 검색하면 `video_chunks`에서 고속 매칭
4. 결과 선택 시 플레이어는 `timed_tokens`를 사용해 단어 하이라이트 동기화
5. UI는 재생 시간 변화에 맞춰 활성 토큰을 이동 표시
