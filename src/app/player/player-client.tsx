"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeForSearch, tokenizeQuery } from "@/lib/search/ranking";
import type { SearchResult } from "@/types/search";

type PlayerClientProps = {
  query: string;
  requestedIndex: number;
  results: SearchResult[];
};

type TimedToken = {
  text: string;
  start: number;
  end: number;
  highlightable: boolean;
};

const TIME_POLL_INTERVAL_MS = 250;

export function PlayerClient({ query, requestedIndex, results }: PlayerClientProps) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [unmutedResultId, setUnmutedResultId] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);

  const currentIndex = clampIndex(requestedIndex, results.length);
  const currentResult = results[currentIndex] ?? null;
  const currentResultId = currentResult?.id ?? null;
  const queryTerms = useMemo(() => tokenizeQuery(query), [query]);
  const timedTokens = useMemo(() => {
    if (!currentResult) {
      return [];
    }

    return buildTimedTokens(currentResult.fullText, currentResult.startTime, currentResult.endTime);
  }, [currentResult]);
  const hasUnmuted = currentResult ? unmutedResultId === currentResult.id : false;
  const currentPlaybackTime = useMemo(() => {
    if (!currentResult) {
      return 0;
    }

    if (
      typeof playbackTime === "number" &&
      playbackTime >= currentResult.startTime - 0.2 &&
      playbackTime <= currentResult.endTime + 2
    ) {
      return playbackTime;
    }

    return currentResult.startTime;
  }, [currentResult, playbackTime]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.includes("youtube")) {
        return;
      }

      const message = parseYouTubeMessage(event.data);

      if (!message || message.event !== "infoDelivery") {
        return;
      }

      const nextTime = message.info?.currentTime;

      if (typeof nextTime === "number" && Number.isFinite(nextTime)) {
        setPlaybackTime(nextTime);
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (!currentResultId) {
      return;
    }

    const pullCurrentTime = () => {
      const iframeWindow = iframeRef.current?.contentWindow;

      if (!iframeWindow) {
        return;
      }

      iframeWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "getCurrentTime",
          args: [],
        }),
        "*",
      );
    };

    pullCurrentTime();
    const timer = window.setInterval(pullCurrentTime, TIME_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentResultId]);

  const embedUrl = useMemo(() => {
    if (!currentResult) {
      return "";
    }

    const params = new URLSearchParams({
      autoplay: "1",
      mute: "1",
      start: currentResult.startTime.toString(),
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
    });

    return `https://www.youtube.com/embed/${currentResult.videoId}?${params.toString()}`;
  }, [currentResult]);

  const onUnmute = () => {
    const iframeWindow = iframeRef.current?.contentWindow;

    if (iframeWindow) {
      const sendCommand = (func: string, args: unknown[] = []) => {
        iframeWindow.postMessage(
          JSON.stringify({
            event: "command",
            func,
            args,
          }),
          "*",
        );
      };

      sendCommand("unMute");
      sendCommand("setVolume", [100]);
      sendCommand("playVideo");
    }

    setUnmutedResultId(currentResult?.id ?? null);
  };

  const onReplayCurrentClip = () => {
    if (!currentResult) {
      return;
    }

    const iframeWindow = iframeRef.current?.contentWindow;

    if (iframeWindow) {
      iframeWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [currentResult.startTime, true],
        }),
        "*",
      );
      iframeWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "playVideo",
          args: [],
        }),
        "*",
      );
    }
  };

  const goToIndex = (index: number) => {
    if (!query) {
      return;
    }

    const params = new URLSearchParams({ q: query, i: index.toString() });
    router.replace(`/player?${params.toString()}`);
  };

  if (!query) {
    return (
      <main className="player-layout">
        <div className="player-panel">
          <h1 className="player-title">재생할 영상 정보가 없습니다.</h1>
          <p className="player-copy">검색어가 없습니다.</p>
          <Link className="player-back" href="/">
            검색으로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  if (!currentResult) {
    return (
      <main className="player-layout">
        <div className="player-panel">
          <h1 className="player-title">재생할 영상 정보가 없습니다.</h1>
          <p className="player-copy">&quot;{query}&quot;에 대한 결과가 없습니다.</p>
          <Link className="player-back" href="/">
            검색으로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="player-layout">
      <div className="player-panel fade-in">
        <h1 className="player-headline">
          How to find <span className="headline-mark">{query}</span> in K-Context ({currentIndex + 1} out of {results.length})
        </h1>

        <div className="player-frame-wrap">
          <iframe
            ref={iframeRef}
            title="YouTube clip player"
            src={embedUrl}
            className="player-frame"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          {!hasUnmuted && (
            <button type="button" className="unmute-button" onClick={onUnmute}>
              소리 켜기
            </button>
          )}
        </div>

        <div className="player-controls-bar">
          <button
            type="button"
            className="control-button"
            onClick={() => goToIndex(currentIndex - 1)}
            disabled={currentIndex <= 0}
          >
            이전
          </button>
          <button type="button" className="control-button" onClick={onReplayCurrentClip}>
            다시 듣기
          </button>
          <button
            type="button"
            className="control-button"
            onClick={() => goToIndex(currentIndex + 1)}
            disabled={currentIndex >= results.length - 1}
          >
            다음
          </button>
          <p className="clip-time">
            {formatTime(currentResult.startTime)} - {formatTime(currentResult.endTime)}
          </p>
        </div>

        <section className="subtitle-board" aria-label="현재 자막">
          <p className="subtitle-line">{renderTimedSubtitle(timedTokens, currentPlaybackTime, queryTerms)}</p>
          <p className="subtitle-progress">
            {formatTime(currentPlaybackTime)} / {formatTime(currentResult.endTime)}
          </p>
        </section>

        <div className="player-actions">
          <Link className="player-back" href="/">
            새 검색
          </Link>
          <a
            className="player-back"
            href={`https://www.youtube.com/watch?v=${currentResult.videoId}&t=${currentResult.startTime}s`}
            target="_blank"
            rel="noopener noreferrer"
          >
            유튜브에서 열기
          </a>
        </div>
      </div>
    </main>
  );
}

function renderTimedSubtitle(tokens: TimedToken[], currentTime: number, queryTerms: string[]) {
  if (tokens.length === 0) {
    return null;
  }

  const normalizedTerms = queryTerms.map(normalizeForSearch).filter(Boolean);
  const lastHighlightableIndex = findLastHighlightableIndex(tokens);

  return tokens.map((token, index) => {
    if (!token.highlightable) {
      return <span key={`token-${index}-${token.text}`}>{token.text}</span>;
    }

    const normalizedToken = normalizeForSearch(token.text);
    const isQueryToken =
      normalizedToken.length > 0 &&
      normalizedTerms.some((term) => normalizedToken.includes(term) || term.includes(normalizedToken));
    const isLastToken = index === lastHighlightableIndex;
    const isActive =
      currentTime >= token.start &&
      (isLastToken ? currentTime <= token.end + 0.05 : currentTime < token.end);

    let className = "subtitle-token";

    if (isQueryToken) {
      className = `${className} subtitle-mark-query`;
    }

    if (isActive) {
      className = `${className} subtitle-mark-active`;
    }

    return (
      <span key={`token-${index}-${token.start}`} className={className}>
        {token.text}
      </span>
    );
  });
}

function buildTimedTokens(text: string, startTime: number, endTime: number): TimedToken[] {
  const chunks = text.match(/(\s+|[^\s]+)/g) ?? [text];
  const duration = Math.max(endTime - startTime, 0.8);
  const weights = new Map<number, number>();

  let totalWeight = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (!/\S/.test(chunks[index])) {
      continue;
    }

    const weight = Math.max(normalizeForSearch(chunks[index]).length, 1);
    weights.set(index, weight);
    totalWeight += weight;
  }

  if (weights.size === 0 || totalWeight === 0) {
    return chunks.map((chunk) => ({
      text: chunk,
      start: startTime,
      end: endTime,
      highlightable: false,
    }));
  }

  const tokens: TimedToken[] = [];
  let cursor = startTime;
  let lastHighlightableIndex = -1;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const weight = weights.get(index);

    if (!weight) {
      tokens.push({
        text: chunk,
        start: cursor,
        end: cursor,
        highlightable: false,
      });
      continue;
    }

    const tokenStart = cursor;
    const tokenEnd = tokenStart + (duration * weight) / totalWeight;

    tokens.push({
      text: chunk,
      start: tokenStart,
      end: tokenEnd,
      highlightable: true,
    });

    cursor = tokenEnd;
    lastHighlightableIndex = tokens.length - 1;
  }

  if (lastHighlightableIndex >= 0) {
    tokens[lastHighlightableIndex] = {
      ...tokens[lastHighlightableIndex],
      end: endTime,
    };
  }

  return tokens;
}

function findLastHighlightableIndex(tokens: TimedToken[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].highlightable) {
      return index;
    }
  }

  return -1;
}

function parseYouTubeMessage(rawData: unknown): {
  event?: string;
  info?: { currentTime?: number };
} | null {
  if (typeof rawData === "string") {
    try {
      return JSON.parse(rawData) as { event?: string; info?: { currentTime?: number } };
    } catch {
      return null;
    }
  }

  if (typeof rawData === "object" && rawData !== null) {
    return rawData as { event?: string; info?: { currentTime?: number } };
  }

  return null;
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.min(Math.max(value, 0), length - 1);
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
