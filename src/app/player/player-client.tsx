"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type TimedTokenApiRow = {
  token: string;
  start_time: number;
  end_time: number;
};

type TimedTokensByTimeResponse = {
  chunkId: string;
  videoId: string;
  start_time: number;
  end_time: number;
  timedTokens?: TimedTokenApiRow[];
};

type RemoteTimedTokenState = {
  videoId: string;
  chunkId: string;
  startTime: number;
  endTime: number;
  tokens: TimedToken[];
};

type SubtitleLine = {
  id: string;
  start: number;
  end: number;
  tokens: TimedToken[];
};

const TIME_POLL_INTERVAL_MS = 180;
const SEEK_PRIME_INTERVAL_MS = 360;
const SEEK_PRIME_MAX_ATTEMPTS = 14;
const SUBTITLE_LINE_MAX_TOKENS = 8;
const SUBTITLE_LINE_MAX_CHARS = 30;
const SUBTITLE_VISIBLE_LINES = 3;
const SUBTITLE_RANGE_MARGIN_SECONDS = 0.35;
const SUBTITLE_REMOTE_FETCH_THROTTLE_MS = 900;

type YouTubePlayer = {
  destroy: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
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

export function PlayerClient({ query, requestedIndex, results }: PlayerClientProps) {
  const router = useRouter();
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playbackTimeRef = useRef<number | null>(null);
  const subtitleFetchAtRef = useRef(0);
  const lastStartAdjustmentRef = useRef<{ resultId: string; targetStart: number } | null>(null);
  const [unmutedResultId, setUnmutedResultId] = useState<string | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);
  const [playerReadyTick, setPlayerReadyTick] = useState(0);
  const [remoteTimedTokenState, setRemoteTimedTokenState] = useState<RemoteTimedTokenState | null>(null);

  const currentIndex = clampIndex(requestedIndex, results.length);
  const currentResult = results[currentIndex] ?? null;
  const currentResultId = currentResult?.id ?? null;
  const currentVideoId = currentResult?.videoId ?? null;
  const currentStartTime = currentResult?.startTime ?? 0;
  const queryTerms = useMemo(() => tokenizeQuery(query), [query]);
  const normalizedQueryTerms = useMemo(
    () => queryTerms.map((term) => normalizeForSearch(term)).filter(Boolean),
    [queryTerms],
  );
  const fallbackTimedTokens = useMemo(() => {
    if (!currentResult) {
      return [];
    }

    return buildTimedTokens(currentResult.fullText, currentResult.startTime, currentResult.endTime);
  }, [currentResult]);
  const currentChunkTimedTokens = useMemo(() => {
    if (
      remoteTimedTokenState?.videoId === currentVideoId &&
      remoteTimedTokenState.chunkId === currentResultId &&
      remoteTimedTokenState.tokens.length > 0
    ) {
      return remoteTimedTokenState.tokens;
    }

    return fallbackTimedTokens;
  }, [currentResultId, currentVideoId, fallbackTimedTokens, remoteTimedTokenState]);
  const timedTokens = useMemo(() => {
    if (remoteTimedTokenState?.videoId === currentVideoId && remoteTimedTokenState.tokens.length > 0) {
      return remoteTimedTokenState.tokens;
    }

    return currentChunkTimedTokens;
  }, [currentChunkTimedTokens, currentVideoId, remoteTimedTokenState]);
  const subtitleRangeStart =
    remoteTimedTokenState?.videoId === currentVideoId ? remoteTimedTokenState.startTime : currentResult?.startTime ?? 0;
  const subtitleRangeEnd =
    remoteTimedTokenState?.videoId === currentVideoId ? remoteTimedTokenState.endTime : currentResult?.endTime ?? 0;
  const preferredStartTime = useMemo(() => {
    if (!currentResult) {
      return 0;
    }

    const matchedStart = findMatchedTokenStart(currentChunkTimedTokens, normalizedQueryTerms);
    if (matchedStart === null) {
      return currentResult.startTime;
    }

    const padded = Math.max(currentResult.startTime, matchedStart - 0.25);
    return Math.min(padded, currentResult.endTime);
  }, [currentChunkTimedTokens, currentResult, normalizedQueryTerms]);
  const subtitleLines = useMemo(() => buildSubtitleLines(timedTokens), [timedTokens]);
  const activeLineIndex = useMemo(
    () => findActiveSubtitleLineIndex(subtitleLines, playbackTime ?? preferredStartTime),
    [playbackTime, preferredStartTime, subtitleLines],
  );
  const visibleSubtitleLines = useMemo(
    () => pickVisibleSubtitleLines(subtitleLines, activeLineIndex, SUBTITLE_VISIBLE_LINES),
    [activeLineIndex, subtitleLines],
  );
  const hasUnmuted = currentResult ? unmutedResultId === currentResult.id : false;
  const currentPlaybackTime = useMemo(() => {
    if (typeof playbackTime === "number" && Number.isFinite(playbackTime)) {
      return playbackTime;
    }

    return preferredStartTime;
  }, [playbackTime, preferredStartTime]);

  const seekToTime = useCallback((seconds: number, shouldPlay = true) => {
    const player = playerRef.current;
    if (!player) {
      return;
    }

    const target = Math.max(0, seconds);
    player.seekTo(target, true);
    if (shouldPlay) {
      player.playVideo();
    }
  }, []);

  useEffect(() => {
    if (!currentResultId || !currentVideoId || !currentResult) {
      return;
    }

    let active = true;

    fetch(`/api/chunks/${currentResultId}/timed-tokens`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as { timedTokens?: TimedTokenApiRow[] };
        const parsed = parseApiTimedTokens(payload.timedTokens);

        if (active) {
          setRemoteTimedTokenState({
            videoId: currentVideoId,
            chunkId: currentResultId,
            startTime: currentResult.startTime,
            endTime: currentResult.endTime,
            tokens: parsed,
          });
        }

        return null;
      })
      .catch(() => {
        if (active) {
          setRemoteTimedTokenState({
            videoId: currentVideoId,
            chunkId: currentResultId,
            startTime: currentResult.startTime,
            endTime: currentResult.endTime,
            tokens: [],
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentResult, currentResultId, currentVideoId]);

  useEffect(() => {
    if (!currentVideoId || !currentResultId || !playerHostRef.current) {
      return;
    }

    let active = true;
    let syncTimer: number | null = null;
    let primeTimer: number | null = null;
    const targetStart = Math.max(0, preferredStartTime);
    let primeAttempts = 0;

    playbackTimeRef.current = null;
    lastStartAdjustmentRef.current = null;

    loadYouTubeIframeApi()
      .then(() => {
        if (!active || !playerHostRef.current || !window.YT?.Player) {
          return;
        }

        playerRef.current?.destroy();
        playerRef.current = null;

        const player = new window.YT.Player(playerHostRef.current, {
          videoId: currentVideoId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            start: Math.floor(targetStart),
            playsinline: 1,
            rel: 0,
            controls: 1,
          },
          events: {
            onReady: () => {
              if (!active) {
                return;
              }

              try {
                player.mute();
                setUnmutedResultId((previous) => (previous === currentResultId ? null : previous));
              } catch {
                return;
              }

              setPlayerReadyTick((value) => value + 1);
              primeSeek();
            },
          },
        });

        playerRef.current = player;

        function pullCurrentTime() {
          try {
            const next = player.getCurrentTime();
            if (typeof next === "number" && Number.isFinite(next)) {
              playbackTimeRef.current = next;
              setPlaybackTime(next);
            }

            const muted = player.isMuted();
            setUnmutedResultId((previous) => {
              if (!muted) {
                return previous === currentResultId ? previous : currentResultId;
              }

              if (previous === currentResultId) {
                return null;
              }

              return previous;
            });
          } catch {
            // noop
          }
        }

        function primeSeek() {
          if (!active) {
            return;
          }

          primeAttempts += 1;
          try {
            player.seekTo(targetStart, true);
            player.playVideo();
            pullCurrentTime();
          } catch {
            // noop
          }
        }

        syncTimer = window.setInterval(pullCurrentTime, TIME_POLL_INTERVAL_MS);
        primeTimer = window.setInterval(() => {
          const latest = playbackTimeRef.current;
          const synced = typeof latest === "number" && latest >= targetStart - 0.35;

          if (synced || primeAttempts >= SEEK_PRIME_MAX_ATTEMPTS) {
            if (primeTimer !== null) {
              window.clearInterval(primeTimer);
              primeTimer = null;
            }
            return;
          }

          primeSeek();
        }, SEEK_PRIME_INTERVAL_MS);

        primeSeek();
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (syncTimer !== null) {
        window.clearInterval(syncTimer);
      }
      if (primeTimer !== null) {
        window.clearInterval(primeTimer);
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [currentResultId, currentVideoId, preferredStartTime]);

  useEffect(() => {
    if (!currentResultId || playerReadyTick === 0) {
      return;
    }

    const previous = lastStartAdjustmentRef.current;
    if (previous?.resultId === currentResultId && Math.abs(previous.targetStart - preferredStartTime) < 0.05) {
      return;
    }

    const latestTime = playbackTimeRef.current;
    const shouldAdjust =
      preferredStartTime > currentStartTime + 0.8 &&
      (typeof latestTime !== "number" || latestTime < preferredStartTime - 0.4);

    if (shouldAdjust) {
      seekToTime(preferredStartTime, true);
    }

    lastStartAdjustmentRef.current = {
      resultId: currentResultId,
      targetStart: preferredStartTime,
    };
  }, [currentResultId, currentStartTime, playerReadyTick, preferredStartTime, seekToTime]);

  useEffect(() => {
    if (!currentVideoId || typeof playbackTime !== "number" || !Number.isFinite(playbackTime)) {
      return;
    }

    const outsideLoadedRange = isPlaybackOutsideRange(
      playbackTime,
      subtitleRangeStart,
      subtitleRangeEnd,
      SUBTITLE_RANGE_MARGIN_SECONDS,
    );

    if (!outsideLoadedRange) {
      return;
    }

    const now = Date.now();
    if (now - subtitleFetchAtRef.current < SUBTITLE_REMOTE_FETCH_THROTTLE_MS) {
      return;
    }
    subtitleFetchAtRef.current = now;

    const controller = new AbortController();

    fetch(`/api/videos/${currentVideoId}/timed-tokens?time=${playbackTime.toFixed(3)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as TimedTokensByTimeResponse;
        const parsed = parseApiTimedTokens(payload.timedTokens);

        if (!payload.chunkId || parsed.length === 0) {
          return;
        }

        setRemoteTimedTokenState({
          videoId: currentVideoId,
          chunkId: payload.chunkId,
          startTime: payload.start_time,
          endTime: payload.end_time,
          tokens: parsed,
        });
      })
      .catch(() => undefined);

    return () => {
      controller.abort();
    };
  }, [currentVideoId, playbackTime, subtitleRangeEnd, subtitleRangeStart]);

  const onUnmute = () => {
    const player = playerRef.current;
    if (!player) {
      return;
    }

    player.unMute();
    player.setVolume(100);
    player.playVideo();

    setUnmutedResultId(currentResult?.id ?? null);
  };

  const onReplayCurrentClip = () => {
    if (!currentResult) {
      return;
    }

    seekToTime(preferredStartTime, true);
  };

  const onSeekSubtitleLine = (lineStartTime: number) => {
    seekToTime(lineStartTime, true);
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
          <div ref={playerHostRef} className="player-frame" aria-label="YouTube clip player" />
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
            {formatTime(preferredStartTime)} - {formatTime(currentResult.endTime)}
          </p>
        </div>

        <section className="subtitle-board" aria-label="현재 자막">
          <div className="subtitle-list">
            {visibleSubtitleLines.length === 0 && <p className="subtitle-empty">자막을 불러오는 중입니다...</p>}
            {visibleSubtitleLines.map((line) => {
              const isActiveLine = line.index === activeLineIndex;

              return (
                <button
                  key={line.id}
                  type="button"
                  className={`subtitle-line-button${isActiveLine ? " is-active" : ""}`}
                  onClick={() => onSeekSubtitleLine(line.start)}
                  title={`${formatTime(line.start)}부터 재생`}
                >
                  <span className="subtitle-line-time">{formatTime(line.start)}</span>
                  <span className="subtitle-line">
                    {renderSubtitleLineTokens(line.tokens, currentPlaybackTime, normalizedQueryTerms)}
                  </span>
                </button>
              );
            })}
          </div>
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

function renderSubtitleLineTokens(tokens: TimedToken[], currentTime: number, normalizedQueryTerms: string[]) {
  if (tokens.length === 0) {
    return null;
  }

  const lastHighlightableIndex = findLastHighlightableIndex(tokens);

  return tokens.map((token, index) => {
    const trimmedToken = token.text.trim();

    if (!trimmedToken) {
      return null;
    }

    const normalizedToken = normalizeForSearch(trimmedToken);
    const isQueryToken =
      normalizedToken.length > 0 &&
      normalizedQueryTerms.some((term) => normalizedToken.includes(term) || term.includes(normalizedToken));
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
      <span key={`line-token-${token.start}-${index}`}>
        {index > 0 ? " " : ""}
        <span className={className}>{trimmedToken}</span>
      </span>
    );
  });
}

function buildSubtitleLines(tokens: TimedToken[]): SubtitleLine[] {
  const spokenTokens = tokens.filter((token) => token.highlightable && normalizeForSearch(token.text).length > 0);

  if (spokenTokens.length === 0) {
    return [];
  }

  const lines: SubtitleLine[] = [];
  let buffer: TimedToken[] = [];
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
  let start = Math.max(0, resolvedActive - 1);
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

function parseApiTimedTokens(value: unknown): TimedToken[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: TimedToken[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const row = value[index];

    if (typeof row !== "object" || row === null) {
      continue;
    }

    const token = (row as TimedTokenApiRow).token;
    const start = (row as TimedTokenApiRow).start_time;
    const end = (row as TimedTokenApiRow).end_time;

    if (typeof token !== "string" || typeof start !== "number" || typeof end !== "number") {
      continue;
    }

    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    parsed.push({
      text: trimmed,
      start,
      end,
      highlightable: true,
    });
  }

  return parsed;
}

function findLastHighlightableIndex(tokens: TimedToken[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].highlightable) {
      return index;
    }
  }

  return -1;
}

function findMatchedTokenStart(tokens: TimedToken[], normalizedQueryTerms: string[]): number | null {
  if (normalizedQueryTerms.length === 0) {
    return null;
  }

  for (const token of tokens) {
    if (!token.highlightable) {
      continue;
    }

    const normalizedToken = normalizeForSearch(token.text.trim());
    if (!normalizedToken) {
      continue;
    }

    const matched = normalizedQueryTerms.some(
      (term) => normalizedToken.includes(term) || term.includes(normalizedToken),
    );

    if (matched) {
      return token.start;
    }
  }

  return null;
}

function isPlaybackOutsideRange(time: number, start: number, end: number, margin: number): boolean {
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }

  return time < start - margin || time > end + margin;
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
