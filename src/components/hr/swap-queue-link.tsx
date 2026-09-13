'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { ArrowLeftRight } from 'lucide-react';

/**
 * The way from a roster to the day-off swaps waiting on it. A swap is a roster change, so the people
 * who build the roster decide it — but the queue used to live only under /hr, where a captain never
 * found it (owner report 2026-09-13). Shows the store's pending count so requests do not sit unseen.
 * /hr/schedule links to HR's door, /schedule to the store's.
 */
export function SwapQueueLink({ storeId }: { storeId: string }) {
  const isTh = useLocale() === 'th';
  const pathname = usePathname();
  const [counted, setCounted] = useState<{ storeId: string; pending: number }>({ storeId: '', pending: 0 });

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hr/dayoff-swaps?store_id=${storeId}&status=pending`);
        const json = res.ok ? await res.json() : { data: [] };
        if (!cancelled) setCounted({ storeId, pending: Array.isArray(json.data) ? json.data.length : 0 });
      } catch {
        if (!cancelled) setCounted({ storeId, pending: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // A count fetched for the previously selected store is not this store's.
  const pending = counted.storeId === storeId ? counted.pending : 0;
  const href = pathname?.startsWith('/hr') ? '/hr/swaps' : '/schedule/swaps';

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 self-end rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      <ArrowLeftRight className="h-4 w-4" />
      {isTh ? 'คำขอสลับวันหยุด' : 'Day-off swaps'}
      {pending > 0 && (
        <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {pending}
        </span>
      )}
    </Link>
  );
}
