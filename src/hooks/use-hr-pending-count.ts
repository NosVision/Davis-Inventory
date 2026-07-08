'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Total number of HR items awaiting action across the caller's scope — pending leaves, out-of-range
 * attendance punches, time-correction / OT requests, day-off swaps, claims, profile-change and
 * document requests, and unverified identity claims. Drives the red badge on the "HR" menu entry.
 *
 * HR-only (owner or `can_manage_hr`); everyone else always gets 0 so the badge stays hidden. The
 * source-of-truth aggregation lives in GET /api/hr/dashboard/badges (returns 403 for non-HR).
 * Refreshes on mount, on tab focus, and every `pollMs` (paused while the tab is hidden).
 */
export function useHrPendingCount(pollMs = 60_000): number {
  const { user } = useAuthStore();
  const [count, setCount] = useState(0);
  const isHr = user?.role === 'owner' || (user?.permissions ?? []).includes('can_manage_hr');
  const fetchRef = useRef<() => void>(() => {});

  const fetchCount = useCallback(async () => {
    if (!isHr) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch('/api/hr/dashboard/badges');
      if (!res.ok) return;
      const total = ((await res.json())?.data?.total as number) ?? 0;
      setCount(total);
    } catch {
      /* best-effort — keep the previous count */
    }
  }, [isHr]);

  useEffect(() => { fetchRef.current = fetchCount; }, [fetchCount]);

  useEffect(() => {
    if (!isHr) { setCount(0); return; }
    fetchRef.current();

    const interval = setInterval(() => {
      if (!document.hidden) fetchRef.current();
    }, pollMs);
    const onVisible = () => { if (!document.hidden) fetchRef.current(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isHr, pollMs]);

  return count;
}
