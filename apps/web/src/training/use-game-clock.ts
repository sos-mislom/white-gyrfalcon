"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionStateDto } from "@vsm/api-contracts";

const REAL_MS_PER_GAME_MINUTE = 30_000;
const IDLE_WINDOW_MS = 2 * REAL_MS_PER_GAME_MINUTE;

export function useGameClock(
  session: SessionStateDto | null,
  paused: boolean,
  busy: boolean,
  onIdle: () => void,
) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef(0);
  const lastTick = useRef(0);
  const firing = useRef(false);
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);
  const sessionId = session?.id;
  const outcome = session?.outcome;
  const difficulty = session?.difficulty ?? 1;
  const currentTimeMinutes = session?.currentTimeMinutes ?? 0;
  const actionKey = session?.appliedActions.at(-1)?.key ?? "start";

  useEffect(() => {
    const key = `vsm-clock:${sessionId ?? "none"}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as
        | { actionKey: string; elapsedMs: number }
        | null;
      elapsedRef.current = saved?.actionKey === actionKey ? Math.max(0, Math.min(IDLE_WINDOW_MS, saved.elapsedMs)) : 0;
      setElapsedMs(elapsedRef.current);
    } catch {
      elapsedRef.current = 0;
      setElapsedMs(0);
    }
    firing.current = false;
    lastTick.current = Date.now();
  }, [sessionId, actionKey]);

  useEffect(() => {
    if (!sessionId || outcome !== "active") return;
    const key = `vsm-clock:${sessionId}`;
    const triggerMs = Math.min(IDLE_WINDOW_MS, Math.max(0, 12 - 2 * difficulty - currentTimeMinutes) * REAL_MS_PER_GAME_MINUTE);
    const interval = window.setInterval(() => {
      const now = Date.now();
      const delta = Math.min(1000, Math.max(0, now - lastTick.current));
      lastTick.current = now;
      if (paused || busy || document.visibilityState !== "visible" || firing.current) return;
      elapsedRef.current = Math.min(IDLE_WINDOW_MS, elapsedRef.current + delta);
      setElapsedMs(elapsedRef.current);
      try { sessionStorage.setItem(key, JSON.stringify({ actionKey, elapsedMs: elapsedRef.current })); } catch { /* Clock still runs in memory. */ }
      if (elapsedRef.current >= triggerMs && !firing.current) {
        firing.current = true;
        onIdleRef.current();
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [sessionId, outcome, currentTimeMinutes, difficulty, actionKey, paused, busy]);

  const deadlineMinutes = 12 - 2 * difficulty;
  const seconds = Math.max(0, Math.ceil(
    (deadlineMinutes - currentTimeMinutes) * 60 -
    elapsedMs * 60 / REAL_MS_PER_GAME_MINUTE,
  ));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
