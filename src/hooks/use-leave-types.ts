'use client';

import { useEffect, useState } from 'react';

// The client-side single source of truth for "which leave types can be picked". Every HR/manager
// surface (day-edit, bulk-backfill, attendance review) uses this so the option list is always the
// ACTIVE, company-scoped set from config — never a hardcoded list. Backed by
// /api/hr/leave-types/options (which shares lib/hr/leave-types#fetchLeaveTypeOptions with the ESS
// endpoint). Pass the employee/store company id; pass null/undefined to resolve the caller's own.
export interface LeaveTypeOption {
  id: string;
  code: string;
  name_th: string;
  name_en: string;
  company_id: string | null;
  paid: boolean;
  requires_cert: boolean;
  requires_reason: boolean;
  probational_allowed: boolean;
  advance_notice_days: number | null;
}

interface UseLeaveTypesResult {
  leaveTypes: LeaveTypeOption[];
  loading: boolean;
  error: boolean;
}

export function useLeaveTypes(companyId?: string | null): UseLeaveTypesResult {
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
    (async () => {
      try {
        const res = await fetch(`/api/hr/leave-types/options${qs}`);
        if (!res.ok) throw new Error('load failed');
        const json = await res.json();
        if (alive) setLeaveTypes((json.data ?? []) as LeaveTypeOption[]);
      } catch {
        if (alive) {
          setLeaveTypes([]);
          setError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyId]);

  return { leaveTypes, loading, error };
}
