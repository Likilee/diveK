"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdSlot } from "@/components/ad-slot";

export default function HomePage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const onSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedQuery = query.trim();
    setHasSearched(true);

    if (!trimmedQuery) {
      setErrorMessage("검색어를 입력해 주세요.");
      return;
    }

    setErrorMessage(null);
    startTransition(() => {
      const params = new URLSearchParams({ q: trimmedQuery, i: "0" });
      router.push(`/player?${params.toString()}`);
    });
  };

  return (
    <div className="page-shell">
      <div className="bg-grid" aria-hidden />
      <main className="search-layout">
        <header className="hero fade-in">
          <p className="eyebrow">K-Context MVP</p>
          <h1 className="hero-title">기억나는 한마디로 K-밈 원본 클립 찾기</h1>
          <p className="hero-copy">
            검색하면 바로 1번 결과가 열리고, 플레이어 아래 큰 자막 영역에서 검색어가 하이라이트됩니다.
          </p>
        </header>

        <section className="panel fade-in" style={{ animationDelay: "80ms" }}>
          <form className="search-form" onSubmit={onSearch}>
            <label htmlFor="query" className="sr-only">
              검색어
            </label>
            <input
              id="query"
              className="search-input"
              placeholder="예: 진짜 웃긴 포인트, 레전드 밈 대사"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="search-button" disabled={isPending}>
              {isPending ? "1번 결과 여는 중..." : "바로 듣기"}
            </button>
          </form>

          <div className="search-state" aria-live="polite">
            {!hasSearched && <p>추천 검색어: 진짜 웃기다, 레전드 밈, 그 말투</p>}
            {hasSearched && errorMessage && <p>{errorMessage}</p>}
            {hasSearched && !errorMessage && <p>플레이어에서 1번 결과부터 바로 재생합니다.</p>}
          </div>
        </section>

        <AdSlot />
      </main>
    </div>
  );
}
