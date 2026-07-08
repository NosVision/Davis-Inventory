'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ShieldAlert, ChevronRight } from 'lucide-react';

// A prominent prompt on the ESS home for employees who have LINKED their identity
// (an hr_employees record exists) but still have company policies they have not read
// and accepted for the current version (owner ask 2026-07-08). It nudges them into the
// reader; the actual scroll → accept → save gate lives on /me/policies. Non-linked
// users are not nagged here — they are steered to verify their identity first.
export function RequiredPolicyBanner() {
  const isTh = useLocale() === 'th';
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [idRes, polRes] = await Promise.all([
          fetch('/api/hr/ess/identity'),
          fetch('/api/hr/ess/policies'),
        ]);
        const id = await idRes.json().catch(() => ({}));
        const pol = await polRes.json().catch(() => ({}));
        if (!alive) return;
        if (!id?.data?.linked) return; // only linked (identity-verified) employees
        const pending = ((pol?.data ?? []) as { acked: boolean }[]).filter((p) => !p.acked).length;
        setCount(pending);
      } catch {
        // silent — the banner is a nudge, not critical path
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (count <= 0) return null;

  return (
    <Link
      href="/me/policies"
      className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-800/40 dark:text-amber-300">
        <ShieldAlert className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {isTh ? 'มีระเบียบบริษัทที่ต้องอ่านและยอมรับ' : 'Company policies need your acceptance'}
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300/80">
          {isTh
            ? `${count} ฉบับ — เลื่อนอ่านให้ครบแล้วกดยอมรับ`
            : `${count} to read — scroll through and accept`}
        </p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-amber-500" />
    </Link>
  );
}
