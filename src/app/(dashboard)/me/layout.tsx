'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ChevronLeft } from 'lucide-react';

// Shared shell for the ESS area: every /me/* sub-page gets a "back" affordance (owner ask
// 2026-07-09) without each page hand-rolling one. The /me hub itself is the root of this area, so
// it shows no back button. "Back" returns to wherever the user came from (router.back), falling
// back to the /me hub when there is no in-app history (deep link / new tab). print:hidden so the
// control never bleeds into printed payslips/documents.
export default function MeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isTh = useLocale() === 'th';
  const isHub = pathname === '/me';

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/me');
  };

  return (
    <>
      {!isHub && (
        <div className="px-4 pt-3 print:hidden">
          <button
            type="button"
            onClick={goBack}
            aria-label={isTh ? 'ย้อนกลับ' : 'Back'}
            className="-ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            {isTh ? 'ย้อนกลับ' : 'Back'}
          </button>
        </div>
      )}
      {children}
    </>
  );
}
