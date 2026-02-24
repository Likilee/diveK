"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeForSearch } from "@/lib/search/ranking";
import type { ChunkContext, SearchResult, TimedToken as SearchTimedToken } from "@/types/search";

type PlayerClientProps = {
  query: string;
  initialIndex?: number;
  results: SearchResult[];
};

type SubtitleToken = {
  text: string;
  tokenNorm: string;
  start: number;
  end: number;
  highlightable: boolean;
};

type SubtitleLine = {
  id: string;
  start: number;
  end: number;
  tokens: SubtitleToken[];
};

const TIME_POLL_INTERVAL_MS = 220;
const SEEK_COMMAND_DEDUP_WINDOW_MS = 400;
const SEEK_TARGET_DEDUP_EPSILON_SECONDS = 0.05;
const SOFT_START_ADJUST_MAX_ELAPSED_SECONDS = 2;
const SOFT_START_ADJUST_MIN_DRIFT_SECONDS = 0.85;
const SUBTITLE_LINE_MAX_TOKENS = 8;
const SUBTITLE_LINE_MAX_CHARS = 30;
const SUBTITLE_VISIBLE_LINES = 2;

type YouTubePlayer = {
  destroy: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
};

type YouTubePlayerConstructor = new (
  element: Element,
  options: {
    videoId: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: () => void;
      onError?: () => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: {
      Player?: YouTubePlayerConstructor;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytIframeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (ytIframeApiPromise) {
    return ytIframeApiPromise;
  }

  ytIframeApiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const previousHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousHandler?.();
      resolve();
    };

    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load YouTube Iframe API"));
    document.head.append(script);
  });

  return ytIframeApiPromise;
}

export function PlayerClient({ query, initialIndex = 0, results }: PlayerClientProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playbackTimeRef = useRef<number | null>(null);
  const lastSeekRef = useRef<{ target: number; at: number } | null>(null);
  const softAdjustedResultIdRef = useRef<string | null>(null);
  const contextCacheRef = useRef<Map<string, ChunkContext>>(new Map());
  const contextRequestRef = useRef<Map<string, Promise<ChunkContext | null>>>(new Map());

  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(initialIndex, results.length));
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);
  const [chunkContext, setChunkContext] = useState<ChunkContext | null>(null);

  const currentResult = results[currentIndex] ?? null;
  const currentResultId = currentResult?.chunkId ?? null;
  const currentVideoId = currentResult?.videoId ?? null;
  const preferredStartTime = currentResult
    ? clamp(currentResult.recommendedStartSec, currentResult.chunkStartSec, currentResult.chunkEndSec)
    : 0;
  const normalizedMatchedTerms = useMemo(
    () =>
      new Set(
        (currentResult?.matchedTerms ?? [])
          .map((term) => normalizeForSearch(term))
          .filter(Boolean),
      ),
    [currentResult],
  );

  const fallbackSubtitleTokens = useMemo(() => {
    if (!currentResult) {
      return [];
    }

    return buildFallbackSubtitleTokens(
      currentResult.fullText,
      currentResult.chunkStartSec,
      currentResult.chunkEndSec,
    );
  }, [currentResult]);

  const contextSubtitleTokens = useMemo(
    () => mapContextTokensToSubtitleTokens(chunkContext?.tokens ?? []),
    [chunkContext],
  );

  const subtitleTokens = contextSubtitleTokens.length > 0 ? contextSubtitleTokens : fallbackSubtitleTokens;

  const subtitleLines = useMemo(() => buildSubtitleLines(subtitleTokens), [subtitleTokens]);
  const activeLineIndex = useMemo(
    () => findActiveSubtitleLineIndex(subtitleLines, playbackTime ?? preferredStartTime),
    [playbackTime, preferredStartTime, subtitleLines],
  );
  const visibleSubtitleLines = useMemo(
    () => pickVisibleSubtitleLines(subtitleLines, activeLineIndex, SUBTITLE_VISIBLE_LINES),
    [activeLineIndex, subtitleLines],
  );

  const currentPlaybackTime = useMemo(() => {
    if (typeof playbackTime === "number" && Number.isFinite(playbackTime)) {
      return playbackTime;
    }

    return preferredStartTime;
  }, [playbackTime, preferredStartTime]);

  const embedUrl = useMemo(() => {
    if (!currentVideoId) {
      return "";
    }

    const params = new URLSearchParams({
      autoplay: "1",
      mute: "0",
      start: Math.max(0, Math.floor(preferredStartTime)).toString(),
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
    });

    if (typeof window !== "undefined") {
      params.set("origin", window.location.origin);
    }

    return `https://www.youtube.com/embed/${currentVideoId}?${params.toString()}`;
  }, [currentVideoId, preferredStartTime]);

  const postIframeCommand = useCallback((func: string, args: unknown[] = []) => {
    const iframeWindow = iframeRef.current?.contentWindow;

    if (!iframeWindow) {
      return;
    }

    iframeWindow.postMessage(
      JSON.stringify({
        event: "command",
        func,
        args,
      }),
      "*",
    );
  }, []);

  const seekToTime = useCallback(
    (seconds: number, shouldPlay = true): boolean => {
      const now = Date.now();
      const player = playerRef.current;
      const target = Math.max(0, seconds);
      const lastSeek = lastSeekRef.current;

      if (
        lastSeek &&
        now - lastSeek.at < SEEK_COMMAND_DEDUP_WINDOW_MS &&
        Math.abs(lastSeek.target - target) <= SEEK_TARGET_DEDUP_EPSILON_SECONDS
      ) {
        return false;
      }

      lastSeekRef.current = { target, at: now };
      const seekResult = callPlayerMethod(player, "seekTo", [target, true]);

      if (seekResult.called) {
        if (shouldPlay) {
          callPlayerMethod(player, "playVideo");
        }
        return true;
      }

      postIframeCommand("seekTo", [target, true]);
      if (shouldPlay) {
        postIframeCommand("playVideo");
      }

      return true;
    },
    [postIframeCommand],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!String(event.origin).includes("youtube")) {
        return;
      }

      const message = parseYouTubeMessage(event.data);
      if (!message || message.event !== "infoDelivery") {
        return;
      }

      const nextTime = message.info?.currentTime;
      if (typeof nextTime === "number" && Number.isFinite(nextTime)) {
        playbackTimeRef.current = nextTime;
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

    const cached = contextCacheRef.current.get(currentResultId);
    if (cached) {
      setChunkContext(cached);
      return;
    }

    let active = true;
    let request = contextRequestRef.current.get(currentResultId);
    if (!request) {
      request = fetch(`/api/chunks/${currentResultId}/context`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as ChunkContext;
          return parseChunkContext(payload);
        })
        .catch(() => null)
        .finally(() => {
          contextRequestRef.current.delete(currentResultId);
        });

      contextRequestRef.current.set(currentResultId, request);
    }

    request.then((parsed) => {
      if (!active) {
        return;
      }

      if (!parsed) {
        setChunkContext(null);
        return;
      }

      contextCacheRef.current.set(currentResultId, parsed);
      setChunkContext(parsed);
    });

    return () => {
      active = false;
    };
  }, [currentResultId]);

  useEffect(() => {
    if (!currentVideoId || !currentResultId || !iframeRef.current) {
      return;
    }

    let active = true;
    let pollTimer: number | null = null;

    playbackTimeRef.current = null;
    playerRef.current = null;
    lastSeekRef.current = null;

    const pullCurrentTime = () => {
      const apiPlayer = playerRef.current;

      const currentTimeResult = callPlayerMethod(apiPlayer, "getCurrentTime");
      if (currentTimeResult.called && typeof currentTimeResult.value === "number") {
        const next = currentTimeResult.value;
        if (Number.isFinite(next)) {
          playbackTimeRef.current = next;
          setPlaybackTime(next);
        }
      } else {
        postIframeCommand("getCurrentTime");
      }
    };

    loadYouTubeIframeApi()
      .then(() => {
        if (!active || !iframeRef.current || !window.YT?.Player) {
          return;
        }

        const player = new window.YT.Player(iframeRef.current, {
          videoId: currentVideoId,
          playerVars: {
            autoplay: 1,
            mute: 0,
            start: Math.max(0, Math.floor(preferredStartTime)),
            playsinline: 1,
            rel: 0,
            controls: 1,
          },
          events: {
            onReady: () => {
              if (!active) {
                return;
              }

              callPlayerMethod(player, "playVideo");
              seekToTime(preferredStartTime, true);
            },
          },
        });

        playerRef.current = player;
      })
      .catch(() => undefined);

    pollTimer = window.setInterval(pullCurrentTime, TIME_POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      const apiPlayer = playerRef.current;
      playerRef.current = null;
      callPlayerMethod(apiPlayer, "destroy");
    };
  }, [currentResultId, currentVideoId, preferredStartTime, postIframeCommand, seekToTime]);

  useEffect(() => {
    if (!currentResultId) {
      softAdjustedResultIdRef.current = null;
      return;
    }

    if (
      softAdjustedResultIdRef.current === currentResultId ||
      typeof playbackTime !== "number" ||
      !Number.isFinite(playbackTime)
    ) {
      return;
    }

    if (playbackTime > preferredStartTime + SOFT_START_ADJUST_MAX_ELAPSED_SECONDS) {
      return;
    }

    if (Math.abs(playbackTime - preferredStartTime) < SOFT_START_ADJUST_MIN_DRIFT_SECONDS) {
      return;
    }

    const didSeek = seekToTime(preferredStartTime, false);
    if (!didSeek) {
      return;
    }

    softAdjustedResultIdRef.current = currentResultId;
  }, [currentResultId, playbackTime, preferredStartTime, seekToTime]);

  const onReplayCurrentClip = () => {
    if (!currentResult) {
      return;
    }

    seekToTime(preferredStartTime, true);
  };

  const goToIndex = (index: number) => {
    const nextIndex = clampIndex(index, results.length);
    if (nextIndex === currentIndex) {
      return;
    }

    setCurrentIndex(nextIndex);
    setPlaybackTime(null);
    lastSeekRef.current = null;
    softAdjustedResultIdRef.current = null;
    setChunkContext(null);
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
            key={currentResultId ?? "player"}
            ref={iframeRef}
            title="YouTube clip player"
            src={embedUrl}
            className="player-frame"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
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
            {formatTime(preferredStartTime)} - {formatTime(currentResult.chunkEndSec)}
          </p>
        </div>

        <section className="subtitle-board" aria-label="현재 자막">
          <div className="subtitle-list">
            {visibleSubtitleLines.length === 0 && <p className="subtitle-empty">자막을 불러오는 중입니다...</p>}
            {visibleSubtitleLines.map((line) => {
              const isActiveLine = line.index === activeLineIndex;

              return (
                <p
                  key={line.id}
                  className={`subtitle-line-row${isActiveLine ? " is-active" : ""}`}
                >
                  <span className="subtitle-line-time">{formatTime(line.start)}</span>
                  <span className="subtitle-line">{renderSubtitleLineTokens(line.tokens, normalizedMatchedTerms)}</span>
                </p>
              );
            })}
          </div>
          <p className="subtitle-progress">
            {formatTime(currentPlaybackTime)} / {formatTime(currentResult.chunkEndSec)}
          </p>
        </section>

        <div className="player-actions">
          <Link className="player-back" href="/">
            새 검색
          </Link>
          <a
            className="player-back"
            href={`https://www.youtube.com/watch?v=${currentResult.videoId}&t=${Math.max(0, Math.floor(preferredStartTime))}s`}
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

function renderSubtitleLineTokens(tokens: SubtitleToken[], normalizedMatchedTerms: Set<string>) {
  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token, index) => {
    const trimmedToken = token.text.trim();
    if (!trimmedToken) {
      return null;
    }

    const isMatchedKeyword = normalizedMatchedTerms.has(token.tokenNorm);

    return (
      <span key={`line-token-${token.start}-${index}`}>
        {index > 0 ? " " : ""}
        {isMatchedKeyword ? <mark className="subtitle-keyword">{trimmedToken}</mark> : trimmedToken}
      </span>
    );
  });
}

function buildSubtitleLines(tokens: SubtitleToken[]): SubtitleLine[] {
  const spokenTokens = tokens.filter((token) => token.highlightable && normalizeForSearch(token.text).length > 0);

  if (spokenTokens.length === 0) {
    return [];
  }

  const lines: SubtitleLine[] = [];
  let buffer: SubtitleToken[] = [];
  let charCount = 0;

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }

    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    lines.push({
      id: `${first.start}-${last.end}-${lines.length}`,
      start: first.start,
      end: last.end,
      tokens: buffer,
    });

    buffer = [];
    charCount = 0;
  };

  for (const token of spokenTokens) {
    const tokenLength = token.text.trim().length;
    const reachesSizeLimit =
      buffer.length >= SUBTITLE_LINE_MAX_TOKENS || charCount + tokenLength > SUBTITLE_LINE_MAX_CHARS;
    const endsSentence = /[.!?。？！]$/.test(token.text.trim());

    if (reachesSizeLimit) {
      flush();
    }

    buffer.push(token);
    charCount += tokenLength;

    if (endsSentence) {
      flush();
    }
  }

  flush();
  return lines;
}

function findActiveSubtitleLineIndex(lines: SubtitleLine[], currentTime: number): number {
  if (lines.length === 0) {
    return -1;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLastLine = index === lines.length - 1;
    if (currentTime >= line.start && (isLastLine ? currentTime <= line.end + 0.05 : currentTime < line.end)) {
      return index;
    }
  }

  if (currentTime < lines[0].start) {
    return 0;
  }

  return lines.length - 1;
}

function pickVisibleSubtitleLines(lines: SubtitleLine[], activeIndex: number, visibleCount: number): Array<
  SubtitleLine & { index: number }
> {
  if (lines.length === 0) {
    return [];
  }

  const safeVisibleCount = Math.max(1, visibleCount);
  const resolvedActive = activeIndex < 0 ? 0 : Math.min(activeIndex, lines.length - 1);
  let start = resolvedActive;
  const end = Math.min(lines.length, start + safeVisibleCount);

  if (end - start < safeVisibleCount) {
    start = Math.max(0, end - safeVisibleCount);
  }

  const picked: Array<SubtitleLine & { index: number }> = [];
  for (let index = start; index < end; index += 1) {
    picked.push({
      ...lines[index],
      index,
    });
  }

  return picked;
}

function mapContextTokensToSubtitleTokens(tokens: SearchTimedToken[]): SubtitleToken[] {
  return tokens.map((token) => ({
    text: token.token,
    tokenNorm: token.tokenNorm,
    start: token.startSec,
    end: token.endSec,
    highlightable: true,
  }));
}

function buildFallbackSubtitleTokens(text: string, startTime: number, endTime: number): SubtitleToken[] {
  const chunks = text.match(/(\s+|[^\s]+)/g) ?? [text];
  const duration = Math.max(endTime - startTime, 0.8);
  const weights = new Map<number, number>();

  let totalWeight = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (!/\S/.test(chunks[index])) {
      continue;
    }

    const normalized = normalizeForSearch(chunks[index]);
    const weight = Math.max(normalized.length, 1);
    weights.set(index, weight);
    totalWeight += weight;
  }

  if (weights.size === 0 || totalWeight === 0) {
    return chunks.map((chunk) => ({
      text: chunk,
      tokenNorm: normalizeForSearch(chunk),
      start: startTime,
      end: endTime,
      highlightable: false,
    }));
  }

  const tokens: SubtitleToken[] = [];
  let cursor = startTime;
  let lastHighlightableIndex = -1;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const weight = weights.get(index);

    if (!weight) {
      tokens.push({
        text: chunk,
        tokenNorm: normalizeForSearch(chunk),
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
      tokenNorm: normalizeForSearch(chunk),
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
function parseChunkContext(value: unknown): ChunkContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const chunkId = (value as { chunkId?: unknown }).chunkId;
  const videoId = (value as { videoId?: unknown }).videoId;
  const chunkStartSec = (value as { chunkStartSec?: unknown }).chunkStartSec;
  const chunkEndSec = (value as { chunkEndSec?: unknown }).chunkEndSec;
  const tokenCount = (value as { tokenCount?: unknown }).tokenCount;
  const tokens = (value as { tokens?: unknown }).tokens;

  if (
    typeof chunkId !== "string" ||
    typeof videoId !== "string" ||
    typeof chunkStartSec !== "number" ||
    typeof chunkEndSec !== "number" ||
    typeof tokenCount !== "number" ||
    !Array.isArray(tokens)
  ) {
    return null;
  }

  const parsedTokens = tokens
    .map((token) => parseContextToken(token))
    .filter((token): token is SearchTimedToken => token !== null)
    .sort((left, right) => left.idx - right.idx);

  return {
    chunkId,
    videoId,
    chunkStartSec,
    chunkEndSec,
    tokenCount,
    tokens: parsedTokens,
  };
}

function parseContextToken(value: unknown): SearchTimedToken | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const idx = (value as { idx?: unknown }).idx;
  const token = (value as { token?: unknown }).token;
  const tokenNorm = (value as { tokenNorm?: unknown; token_norm?: unknown }).tokenNorm ??
    (value as { token_norm?: unknown }).token_norm;
  const startSec = (value as { startSec?: unknown; start_sec?: unknown }).startSec ??
    (value as { start_sec?: unknown }).start_sec;
  const endSec = (value as { endSec?: unknown; end_sec?: unknown }).endSec ??
    (value as { end_sec?: unknown }).end_sec;

  if (
    typeof idx !== "number" ||
    typeof token !== "string" ||
    typeof tokenNorm !== "string" ||
    typeof startSec !== "number" ||
    typeof endSec !== "number"
  ) {
    return null;
  }

  return {
    idx,
    token,
    tokenNorm,
    startSec,
    endSec,
  };
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

function callPlayerMethod(
  player: YouTubePlayer | null,
  method: keyof YouTubePlayer,
  args: unknown[] = [],
): { called: boolean; value: unknown } {
  if (!player) {
    return { called: false, value: null };
  }

  const candidate = (player as unknown as Record<string, unknown>)[method];
  if (typeof candidate !== "function") {
    return { called: false, value: null };
  }

  try {
    return {
      called: true,
      value: (candidate as (...params: unknown[]) => unknown).apply(player, args),
    };
  } catch {
    return { called: false, value: null };
  }
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.min(Math.max(value, 0), length - 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
