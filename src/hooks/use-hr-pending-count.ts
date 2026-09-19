'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Total number of HR items awaiting action across the caller's scope — everything /hr/inbox lists:
 * pending leaves, out-of-range attendance punches, time-correction / OT requests, day-off swaps,
 * claims, profile-change / document / paper-slip requests, resignations, offboardings waiting for a
 * signature and unverified identity claims. Drives the red badge on the "HR" menu entry.
 *
 * HR-only (owner or `can_manage_hr`); everyone else always gets 0 so the badge stays hidden. The
 * source-of-truth aggregation lives in GET /api/hr/dashboard/badges (returns 403 for non-HR);
 * its `inbox` figure is the same list the inbox page opens on, so the badge never promises rows
 * the page cannot show. Refreshes on mount, on tab focus, and every `pollMs` (paused while hidden).
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
      const data = (await res.json())?.data as { inbox?: number; total?: number } | undefined;
      setCount(data?.inbox ?? data?.total ?? 0);
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
