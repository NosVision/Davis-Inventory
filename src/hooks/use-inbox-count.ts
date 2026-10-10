'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';

const REALTIME_REFETCH_DEBOUNCE_MS = 3_000;

/**
 * Total number of items waiting for owner approval across all stores.
 *
 * Mirrors the categories surfaced on `/inbox`:
 *   - comparisons.status='explained'         (stock explanations)
 *   - deposits.status='pending_confirm'      (bar-side receive)
 *   - deposits.status='pending_staff'        (LIFF customer requests)
 *   - borrows.status='pending_approval'      (lender approval)
 *   - transfers.status='pending'             (receiver confirm)
 *
 * Privileged-only (owner/accountant); other roles always get 0 so the
 * sidebar badge stays hidden for them.
 *
 * The five counts are one RPC (inbox_pending_counts, migration 20261010120000), SECURITY
 * INVOKER so the same row-level security applies as to the five separate count queries it
 * replaced.
 *
 * Update strategy:
 *   1. Supabase Realtime: subscribe to changes on the four source tables
 *      and refetch (debounced 3s) when an event arrives. Every write to these
 *      tables reaches every owner/accountant tab, so at the 04:00 shift-end
 *      burst a short debounce turned into a refetch storm; 3s folds a burst
 *      into one refetch.
 *   2. Polling fallback: every `pollMs` (default 60s) AND on tab focus,
 *      in case the realtime channel hiccups or a deploy invalidates the
 *      socket. Poll is paused while the tab is hidden so we don't burn
 *      quota when the user has the page open in a background tab.
 */
export function useInboxCount(pollMs = 60_000): number {
  const { user } = useAuthStore();
  const [count, setCount] = useState(0);
  const isPrivileged = user?.role === 'owner' || user?.role === 'accountant';
  const fetchRef = useRef<() => void>(() => {});

  const fetchCount = useCallback(async () => {
    if (!isPrivileged) {
      setCount(0);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc('inbox_pending_counts');
    if (error || !data) return; // keep the last badge rather than flashing 0 on a blip
    const c = data as Record<string, number>;
    setCount(
      (c.explained ?? 0)
      + (c.pending_confirm ?? 0)
      + (c.pending_staff ?? 0)
      + (c.pending_approval ?? 0)
      + (c.transfer_pending ?? 0),
    );
  }, [isPrivileged]);

  // Keep a ref to the latest fetcher so the realtime + interval callbacks
  // always call the current closure (avoids stale `isPrivileged`).
  useEffect(() => { fetchRef.current = fetchCount; }, [fetchCount]);

  useEffect(() => {
    if (!isPrivileged) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!document.hidden) fetchRef.current();
      }, REALTIME_REFETCH_DEBOUNCE_MS);
    };

    fetchRef.current();

    // ── Realtime: refetch on any change to the five source tables ──
    const supabase = createClient();
    const channel = supabase
      .channel('inbox-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comparisons' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrows' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, debouncedFetch)
      .subscribe();

    // ── Polling fallback: skip when the tab is hidden ──
    const interval = setInterval(() => {
      if (!document.hidden) fetchRef.current();
    }, pollMs);

    // ── Refetch on focus / when the tab becomes visible again ──
    const onFocus = () => {
      if (!document.hidden) fetchRef.current();
    };
    const onVisibility = () => {
      if (!document.hidden) fetchRef.current();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
  }, [isPrivileged, pollMs]);

  return count;
}
