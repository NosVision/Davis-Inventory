'use client';

import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';

/**
 * One "บริษัท / ทั้งหมด" filter for HR lists (HR ask 2026-10-05: every HR picker and table should
 * narrow by company). Nine pages had each grown their own fetch of /api/hr/companies; new filters
 * use this instead.
 *
 * Client-side by design: the lists it narrows already carry company_id per row, so filtering here
 * costs no new API surface. /api/hr/companies is HR-manager only — for anyone else (a venue manager
 * on the leave queue) the list comes back empty and the select renders nothing, which is right:
 * they only ever see their own venue's people anyway.
 */

export interface HrCompany {
  id: string;
  name: string;
  active?: boolean | null;
}

export function useHrCompanies(): HrCompany[] {
  const [companies, setCompanies] = useState<HrCompany[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/hr/companies');
        if (!res.ok) return;
        const json = (await res.json()) as { data?: HrCompany[] };
        if (alive) setCompanies((json.data ?? []).filter((c) => c.active !== false));
      } catch {
        /* no filter rather than a broken page */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return companies;
}

/** '' = ทั้งหมด. A row with no company only shows under ทั้งหมด. */
export function matchesCompany(rowCompanyId: string | null | undefined, filter: string): boolean {
  return !filter || rowCompanyId === filter;
}

export function CompanyFilterSelect({
  companies,
  value,
  onChange,
  label = 'บริษัท',
  className,
}: {
  companies: readonly HrCompany[];
  value: string;
  onChange: (companyId: string) => void;
  label?: string;
  className?: string;
}) {
  // One company (or none loaded) leaves nothing to choose between.
  if (companies.length < 2) return null;
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      options={[{ value: '', label: 'ทั้งหมด' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
    />
  );
}
