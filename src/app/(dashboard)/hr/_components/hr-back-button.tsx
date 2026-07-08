'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

// A consistent "back" affordance on every HR sub-page (owner ask 2026-07-08). Rendered once in the
// HR layout so it appears above each page's own header. Hidden on the HR hub (/hr) itself, which is
// the top of the section. Goes to the previous page; if there's no history it falls back to the hub.
export function HrBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const isTh = useLocale() === 'th';
  if (pathname === '/hr') return null;

  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/hr');
  };

  return (
    <div className="px-4 pt-3">
      <button
        type="button"
        onClick={back}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        {isTh ? 'ย้อนกลับ' : 'Back'}
      </button>
    </div>
  );
}
