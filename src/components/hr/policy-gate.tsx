'use client';

import { useCallback, useEffect, useState } from 'react';
import { PolicyReaderModal, type ReaderPolicy } from './policy-reader-modal';
import { getIdentityStatus, readGateCache, writeGateCache } from '@/lib/hr/ess-gate-cache';

// App-wide policy prompt (owner ask 2026-07-08). Rendered once in the dashboard layout so it reaches
// employees no matter which page their role lands on (e.g. staff land on /chat, not /me). A LINKED
// employee (an hr_employees record exists) who has active policies they have not accepted for the
// current version is shown the reader immediately; accepting stores the ack per version and advances
// to the next pending policy. "Later"/close snoozes until the next Bangkok day (same pattern as the
// identity-claim prompt); it re-appears until everything is accepted.
//
// "Everything accepted" is remembered per user in this tab for a few hours (ess-gate-cache), so a
// full page load during a shift no longer costs two requests for an answer that cannot change.
const SNOOZE_KEY = 'hr-policy-snooze';
const ALL_ACKED_KEY = 'policies-all-acked';

function bkkToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

function isSnoozedToday(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem(SNOOZE_KEY) === bkkToday();
  } catch {
    return false; // storage unavailable → just check the API
  }
}

export function PolicyGate({ role, userId }: { role: string; userId: string }) {
  // Owners aren't venue employees and customers have no dashboard — skip the check entirely.
  const eligible = role !== 'owner' && role !== 'customer';
  const [queue, setQueue] = useState<ReaderPolicy[]>([]);
  const [snoozed, setSnoozed] = useState(isSnoozedToday);

  const load = useCallback(async () => {
    try {
      const id = await getIdentityStatus(userId);
      if (!id?.linked) return; // only prompt identity-verified employees
      if (readGateCache(ALL_ACKED_KEY, userId)) return;
      const polRes = await fetch('/api/hr/ess/policies');
      const pol = await polRes.json().catch(() => ({}));
      if (!polRes.ok) return;
      const pending = ((pol?.data ?? []) as ReaderPolicy[]).filter((p) => !p.acked);
      if (pending.length === 0) writeGateCache(ALL_ACKED_KEY, userId);
      setQueue(pending);
    } catch {
      // silent — a prompt must never break the app
    }
  }, [userId]);

  useEffect(() => {
    if (!eligible || snoozed) return;
    // Deferred one tick: the setState-in-effect lint rule cannot see past the awaits in load(),
    // and nothing here is needed before first paint.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [eligible, snoozed, load]);

  if (!eligible || snoozed || queue.length === 0) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, bkkToday());
    } catch {
      /* ignore */
    }
    setSnoozed(true);
  };

  const onAcked = () => {
    // The last pending policy was just accepted — nothing left to ask about until the cache expires.
    if (queue.length <= 1) writeGateCache(ALL_ACKED_KEY, userId);
    setQueue((q) => q.slice(1));
  };

  return <PolicyReaderModal policy={queue[0]} onClose={snooze} onAcked={onAcked} />;
}
