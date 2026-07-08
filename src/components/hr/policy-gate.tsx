'use client';

import { useCallback, useEffect, useState } from 'react';
import { PolicyReaderModal, type ReaderPolicy } from './policy-reader-modal';

// App-wide policy prompt (owner ask 2026-07-08). Rendered once in the dashboard layout so it reaches
// employees no matter which page their role lands on (e.g. staff land on /chat, not /me). A LINKED
// employee (an hr_employees record exists) who has active policies they have not accepted for the
// current version is shown the reader immediately; accepting stores the ack per version and advances
// to the next pending policy. "Later"/close snoozes until the next Bangkok day (same pattern as the
// identity-claim prompt); it re-appears until everything is accepted.
const SNOOZE_KEY = 'hr-policy-snooze';

function bkkToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export function PolicyGate({ role }: { role: string }) {
  // Owners aren't venue employees and customers have no dashboard — skip the check entirely.
  const eligible = role !== 'owner' && role !== 'customer';
  const [queue, setQueue] = useState<ReaderPolicy[]>([]);
  const [snoozed, setSnoozed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [idRes, polRes] = await Promise.all([
        fetch('/api/hr/ess/identity'),
        fetch('/api/hr/ess/policies'),
      ]);
      const id = await idRes.json().catch(() => ({}));
      const pol = await polRes.json().catch(() => ({}));
      if (!id?.data?.linked) return; // only prompt identity-verified employees
      const pending = ((pol?.data ?? []) as ReaderPolicy[]).filter((p) => !p.acked);
      setQueue(pending);
    } catch {
      // silent — a prompt must never break the app
    }
  }, []);

  useEffect(() => {
    if (!eligible) return;
    try {
      if (localStorage.getItem(SNOOZE_KEY) === bkkToday()) {
        setSnoozed(true);
        return;
      }
    } catch {
      /* storage unavailable → just check the API */
    }
    load();
  }, [eligible, load]);

  if (!eligible || snoozed || queue.length === 0) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, bkkToday());
    } catch {
      /* ignore */
    }
    setSnoozed(true);
  };

  return (
    <PolicyReaderModal
      policy={queue[0]}
      onClose={snooze}
      onAcked={() => setQueue((q) => q.slice(1))}
    />
  );
}
