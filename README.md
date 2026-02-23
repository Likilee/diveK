# K-Context (Frontend-first MVP)

Next.js 16(App Router) 기반의 K-밈 검색 MVP입니다. 현재는 mock subtitle chunk 데이터로 검색/재생 UX를 먼저 검증합니다.

## Stack
- Next.js 16
- React 19
- TypeScript
- pnpm (`corepack enable`)

## Run
```bash
corepack enable
pnpm install
pnpm dev
```

## Supabase Local
```bash
pnpm supabase:start
pnpm supabase:status
pnpm supabase:reset
```

## Implemented (Frontend-first)
- `/api/search` mock API (`q`, `limit`)
- 검색 페이지(`/`) + 스니펫 하이라이트
- 결과 카드 클릭 시 클라이언트 라우팅으로 `/player` 이동
- 플레이어 페이지(`/player`)에서 `autoplay=1`, `mute=1`, `start` 적용
- 온스크린 `소리 켜기` 오버레이 버튼
- `usePathname` + `useSearchParams` 기반 virtual pageview/ads refresh 훅

## Docs
- Pipeline reference: `/Users/kihoon/Documents/Project/kcontext/docs/data-pipeline.md`
- `yt-dlp` evaluation: `/Users/kihoon/Documents/Project/kcontext/docs/yt-dlp-evaluation.md`
- Supabase local setup: `/Users/kihoon/Documents/Project/kcontext/docs/supabase-local.md`
