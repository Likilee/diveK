# PRD: K-Context (K-Culture Video Source Search Engine)

## 1. Introduction/Overview
K-Context는 이미 존재하는 유명 K-Culture(예: 무한도전, 침착맨, 피식대학 등) 영상들의 자막을 검색 가능한 데이터베이스로 파싱하여, 사용자가 특정 대사나 밈(Meme)을 검색했을 때 해당 영상의 정확한 타임라인으로 바로 연결해주는 검색 엔진(B2C Web App)입니다.
사용자에게 맥락(Context)을 찾는 빠르고 완벽한 경험을 제공하며, AdSense 트래픽 후크를 통한 광고 수익 창출을 비즈니스 목표로 합니다.

## 2. Goals
- **정확한 검색 경험 제공:** 사용자가 기억하는 밈이나 대사의 파편적인 단어로도 원하는 영상 구간을 정확히 찾아냄 (검색 히트율 70% 이상 달성).
- **마찰 없는 미디어 재생 UX:** 모바일 기기에서도 추가적인 탭(Tap)의 피로도를 최소화하고 즉각적으로 맥락을 확인할 수 있도록 함.
- **데이터 기반의 수익화 확보:** 페이지 전환(가상 페이지뷰) 트래킹을 통해 GA4에서 완벽한 데이터 분석 환경을 구축하고, 무효 클릭 없는 유의미한 AdSense 노출 달성.
- **초저비용 고효율 인프라 유지:** 1인 개발 특성상 월 유지비용을 0원에 가깝게 수렴하면서, 트래픽 스파이크를 감당할 수 있는 아키텍처(Vercel + Supabase) 구축.

## 3. User Stories

### US-001: 텍스트 키워드 기반 비디오 구간 검색
**Description:** As a 사용자, I want 내가 기억하는 대사의 일부 단어를 검색해서 so that 그 대사가 등장하는 정확한 영상들을 리스트업 받고 싶다.
**Acceptance Criteria:**
- [ ] 검색창에 단어를 치면 해당 단어가 포함된 자막을 가진 영상 리스트가 조회됨.
- [ ] 단순 Substring이 아니라, 형태소(근원어) 기반 검색으로 융통성 있는 검색 결과 제공 (Sliding Window & Keyword Overlap 기반).
- [ ] 검색 결과 카드에 매칭된 자막 스니펫(Snippet)이 볼드(Bold) 처리되어 노출.

### US-002: 검색 결과 클릭 시 해당 구간부터 영상 시청 (모바일 최적화)
**Description:** As a 사용자, I want 검색 결과의 썸네일을 클릭하면 so that 유튜브 앱으로 이동하거나 새로고침 없이 그 즉시 해당 타임라인부터 영상을 보고 맥락을 파악하고 싶다.
**Acceptance 실체 기준:**
- [ ] 썸네일 클릭 시 클라이언트 라우팅(Client-side navigation)을 통해 화면 깜빡임 없이 플레이어 뷰로 전환.
- [ ] YouTube Iframe 내에서 타겟 시간(t=초)부터 즉시재생(Autoplay).
- [ ] 모바일 자동재생 제한을 막기 위해 음소거(Muted)로 시작하되, 상단에 직관적인 "소리 켜기" 버튼 노출.
- [ ] Verify in browser using dev-browser skill

### US-003: 데이터 분석 및 광고 활성화를 위한 SPA 라우팅 트래킹
**Description:** As a 운영자/데이터분석가, I want 사용자가 검색부터 결과 클릭까지 페이지를 이동할 때마다 so that GA4에 페이지뷰 이벤트가 수집되어 퍼널 분석 및 AdSense 슬롯 갱신이 이루어지게 하고 싶다.
**Acceptance Criteria:**
- [ ] Next.js 리아우팅(Navigation)시 브라우저 Path가 변경되고, 히스토리(Back/Forward)가 정상 동작함.
- [ ] `usePathname`, `useSearchParams` 변경을 감지하여 GA4 Virtual Pageview 이벤트가 Fire 됨.
- [ ] 새로운 가상 페이지 진입 시, 컴포넌트 마운트를 통해 AdSense 슬롯이 규정에 맞게 새로 랜더링됨.

### US-004: 유튜브 자막 파싱 및 데이터 파이프라인 수집
**Description:** As a 데이터 관리자, I want 특정 유튜브 채널이나 재생목록의 자막을 로컬에서 일괄 추출하여 문맥 덩어리(Chunk)로 가공하고 DB에 적재해서 so that 사용자에게 의미 단위 검색이 원활하게 지원되는 인덱스를 제공하고 싶다.
**Acceptance Criteria:**
- [ ] 15초 단위의 문맥 청크 및 5초 오버랩(Overlap) 처리가 자동으로 이루어짐.
- [ ] 원본 자막 세그먼트의 `start_time`, `end_time`, `seq`가 별도 정규 테이블에 보존됨.
- [ ] 청크 레코드가 `segment_start_seq`, `segment_end_seq`, `timed_tokens`(JSONB)로 재생 하이라이트에 필요한 타이밍 정보를 포함함.
- [ ] 형태소 분석기(NLP)를 통해 불용어가 제거된 핵심 키워드 배열이 생성되어 Supabase에 Batch Insert 됨.
- [ ] (참고: [Data Pipeline Architecture](../docs/data-pipeline.md) 문서 참조)

## 4. Functional Requirements
- **FR-1:** (데이터 파이프라인 추출) 유튜브 자막 추출 시 2~5초 단위 원본을 `{seq, start_time, end_time, duration, text}`로 정규화해야 한다.
- **FR-2:** (원본 보존) 정규화된 세그먼트는 `transcript_segments` 테이블에 먼저 저장되어야 하며, `UNIQUE(video_id, seq)` 제약을 가져야 한다.
- **FR-3:** (데이터 파이프라인 청킹) 문맥 단절 방지를 위해 15초 Sliding Window 청크와 5초 오버랩을 생성하고, 청크별 `segment_start_seq`, `segment_end_seq`, `timed_tokens`를 함께 산출해야 한다.
- **FR-4:** (데이터 파이프라인 정제) NLP 라이브러리(KoNLPy 등)를 통해 청크 텍스트에서 불용어를 제거하고 명사/동사 원형 위주의 `keywords` 배열을 추출해야 한다.
- **FR-5:** (DB 적재) `video_chunks` 적재 시 `keywords`, `full_text`, `start_time`, `end_time`, `timed_tokens`를 Batch Insert/Upsert 해야 한다.
- **FR-6:** (서버 연동) Supabase의 `pg_trgm` GIN 인덱스 및 Array Contains 쿼리를 이용하여 밀리초(ms) 단위의 텍스트 검색 API를 제공해야 한다.
- **FR-7:** (UX) 모바일 브라우저에서 사용자가 검색 결과를 터치 시, `mute=1&autoplay=1` 옵션이 적용된 Iframe을 띄우고 커스텀 "Unmute" 오버레이를 표시한다.
- **FR-8:** (데이터 수집 전략) 목표 유튜브 데이터 수집 스크립트는 **검색 효율을 고려한 Mixed-Mode (지정된 채널 전체 순회 방식과 특정 레전드 모음집 플레이리스트 방식 혼용)** 로 구축하며, Supabase DB 사이즈 절감을 위해 전체 텍스트가 아닌 '검색 가능 키워드 배열' 위주로 적재하여 Batch Insert 해야 한다.

## 5. Non-Goals (Out of Scope)
- 사용자의 자체적인 영상 업로드 포팅 및 호스팅 기능 (순수 유튜브 Iframe 임베드만 지원).
- 회원가입, 로그인 및 개인화(북마크, 좋아요 등) 아키텍처 (당장은 불필요, 익명 트래픽 극대화에 집중).
- 모바일 네이티브 앱 개발 (핵심 지표 검증 전까지 PWA 수준의 Responsive Web으로 한정).
- 클라우드 기반 자동 자막 수집 스크립트 스케줄러 (비용 절감을 위해 로컬에서 수동/반자동 방식으로 실행).

## 6. Design & Architecture Considerations
- **Architecture:** Vercel (Next.js App Router, SPA 형태) + Supabase (Postgres). 
- **DB Model:** 2-Layer 모델 (`transcript_segments` 정규 원본 + `video_chunks` 검색/재생 최적화 레이어).
- **UX Constraint:** 사용자 마찰을 극도로 없애기 위해 MPA 방식은 배제하고, SPA 라우팅 기반의 가상 페이지 갱신(History API)으로 애널리틱스 목적을 달성한다.
- **Ingestion Pipeline (상세 구조는 [Data Pipeline Architecture](../docs/data-pipeline.md) 참조):** 로컬(개발자 PC) 환경에서 Node.js/Python CLI 스크립트 형태로 작성하며, YouTube Data API v3를 이용해 특정 채널 목록을 순회하여 자막을 크롤링/청킹한 후 리소스 부담 없이 Supabase에 직통 Insert 하는 구조.

## 7. Technical Considerations
- **Supabase Storage Size (DB 용량 한계 대응):** 
  영상 원본은 저장하지 않고 텍스트/메타데이터만 저장한다는 원칙은 유지합니다. 다만 실시간 자막 하이라이트 정확도를 위해 `transcript_segments`와 `video_chunks.timed_tokens`가 추가되어 저장량이 증가하므로, 초기 수집 단계에서 인덱스 + JSONB 증가 폭을 함께 모니터링해야 합니다.
- **Supabase 무료 티어 한계:** 트래픽 폭증 시 커넥션 풀(Connection Pool) 고갈이나 API 한도 도달 문제가 발생할 수 있음. Vercel의 Edge Cache / SWR 캐싱을 적극 차용하여 검색 API 요청 수를 방어해야 함.
- **Sliding Window 사이즈 조정:** 15/5초 스펙은 릴리즈 후 Search 히트율과 YouTube IFrame 재생 경험을 관찰하며 세밀하게 튜닝할 수 있도록 파이프라인 로직을 유연하게 작성.
- **대량의 데이터 적재 최적화:** 로컬 환경에서 크롤링 진행 중 스크립트가 중단되어도 이어서 할 수 있도록 로컬 State 캐시(체크포인트)를 유지하고, Supabase Insert 시 Batch Size 및 Rate Limit 방어 로직을 필수적으로 구현해야 함.

## 8. Success Metrics
- **검색 체류시간 / PV:** 인당 평균 검색 수행 횟수 & 클릭 횟수 (Virtual Pageviews).
- **Search-to-Play Conversion Rate (검색 후 재생 전환율):** 검색 리스트업 후 실제 클릭하여 영상을 재생하는 비율 50% 이상.
- **인프라 비용:** 첫 달 $0 유지.

## 9. Open Questions
- 초기 크롤링(Seeding)할 채널(예: 무도, 핑계고, 침착맨 등) 리스트 1차 선정은 어떻게 할 것인지?
- Supabase 커넥션 한도 돌파 시 Upstash(Redis) 연동 등 두 번째 캐시 전략의 마일스톤 편입 시점은 언제로 잡을지?
