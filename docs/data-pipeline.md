# Data Ingestion Pipeline Architecture

## 1. Overview
이 문서는 유튜브 자막 원본 데이터를 K-Context의 검색 가능한 데이터베이스로 가공하고 적재하는 파이프라인의 아키텍처와 구체적인 데이터 변환 과정을 정의합니다. 파이프라인의 핵심 목표는 사용자가 자연스러운 문맥 단위로 영상을 검색하고 즉시 시청할 수 있도록 돕는 것입니다.

## 2. Core Principles
1. **문맥 단절 방지 (Sliding Window):** 단순한 자막 단위가 아니라 의미가 이어지는 덩어리(Chunk)로 문맥을 묶어 검색 누락을 방비합니다.
2. **검색 최적화 (NLP Keyword Extraction):** 사용자들의 다양한 검색어 변형(원형/파생어)을 커버하기 위해 형태소 분석을 통해 불용어를 제거하고 핵심 키워드 배열을 추출합니다.
3. **저장소 효율화:** 무거운 영상 원본 없이 텍스트 배열과 메타데이터만 저장하여 Supabase 무료 티어 한계 내에서 수십만 건의 데이터를 유지합니다.

## 3. Data Transformation Steps

### Step 1: Raw Transcript Extraction (원본 자막 추출)
가장 먼저 유튜브에서 스크립트가 긁어오는 원초적인 데이터 형태입니다. 유튜브 자막은 보통 2~5초 단위로 아주 짧게 쪼개져 있습니다.

```json
[
  { "offset": 12.0, "duration": 3.0, "text": "야, 너 저번에 그거" },
  { "offset": 15.0, "duration": 2.5, "text": "진짜 웃겼어." },
  { "offset": 17.5, "duration": 4.0, "text": "아 빵터졌네 진짜." }
]
```
이 상태 그대로 DB에 넣으면? 사용자가 "너 저번에 진짜 웃겼어"라고 하나의 문장처럼 이어서 검색했을 때, 실제 데이터는 두 개로 쪼개져 있어서 DB가 걸러내지 못하는 참사(검색 실패)가 발생합니다.

### Step 2: Sliding Window Chunking (문맥 덩어리 만들기)
이 짧은 자막들을 **15초 길이의 덩어리**로 합치되, 문맥을 잇기 위해 **5초씩 겹치게(Overlap)** 만듭니다.

- **Chunk 1 (0초~15초):** "야, 너 저번에 그거"
- **Chunk 2 (10초~25초):** "야, 너 저번에 그거 진짜 웃겼어. 아 빵터졌네 진짜."
- **Chunk 3 (20초~35초):** "아 빵터졌네 진짜. (다음 대사...)"

위 예시처럼 문장이 겹치면서 자연스럽게 이어지도록 가공합니다. 보통 이 과정은 배열을 순회하면서 `offset`을 기준으로 합칩니다.

### Step 3: NLP Keyword Extraction (NLP 키워드 추출)
사용자들이 "진짜 웃김", "웃기다" 등 변형해서 검색하는 것도 잡아내기 위해, **Chunk 2**의 텍스트에서 불용어("아", "저번에", "그거", "네" 등)를 제거하고 명사와 동사(원형)만 추출합니다. (Python의 KoNLPy 등 활용)

- **원본 텍스트:** `"야, 너 저번에 그거 진짜 웃겼어. 아 빵터졌네 진짜."`
- **정제된 키워드 배열:** `["야", "너", "진짜", "웃기다", "빵터지다"]`

### Step 4: Final DB Insertion (Supabase 적재)
가공된 데이터를 Supabase DB의 `video_chunks` 테이블에 1줄짜리 레코드 형태로 Insert 합니다 (Batch Rate-limit 고려).

| Column | Type | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 고유 레코드 식별자 |
| `video_id` | String | 매칭되는 유튜브 영상 ID |
| `start_time` | Float | 영상 재생 타깃 시작 초 (10초 타임라인 이동용) |
| `end_time` | Float | 청크 종료 시간 |
| `keywords` | Array(String) | **GIN 인덱스를 걸어 실제로 검색할 타겟 배열** (`["야", "너", "진짜", "웃기다", "빵터지다"]`) |
| `full_text` | String | UI에 보여줄 하이라이팅 원문 (`"야, 너 저번에 그거 진짜 웃겼어..."`) |

## 4. End-to-End User Scenario
1. **Local Pipeline**: 개발자 PC에 있는 Python 봇이 특정 채널의 동영상을 순회하며 1단계~3단계를 백그라운드에서 자동 가공하여 Supabase에 한 방에 쏩니다 (Batch Insert).
2. **User Target**: 사용자가 웹 화면에서 "진짜 웃긴거"라고 **검색**합니다.
3. **Frontend Request**: "진짜", "웃기다"로 검색어가 형태소 분리되어 백엔드/Supabase로 쿼리가 전송됩니다.
4. **DB Query**: GIN 인덱스와 Array Contains 연산을 바탕으로 `keywords` 배열에 해당 키워드가 포함된 청크를 밀리초 내에 스캔합니다.
5. **Playback Experience**: 검색 내역에서 결과 카드의 썸네일/버튼을 누르면 브라우저의 `<iframe autoplay=1 mute=1>` 속성을 이용해 곧바로 `start_time`인 10초 타임라인부터 영상을 시청할 수 있습니다.
