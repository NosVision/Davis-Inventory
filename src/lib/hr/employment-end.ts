/**
 * When does someone's employment END, for payroll purposes?
 *
 * hr_employees.end_date is written only when an offboarding is COMPLETED (assets returned, both
 * signatures in). Payroll prorated the final month off that column alone, so a resignation HR had
 * already accepted — offboarding row in `draft`, last working date agreed — still paid a full month
 * until the paperwork closed. Four September 2026 leavers were paid 30 days for 10 that way (HR
 * report 2026-09-10). HR's expectation is the natural one: once the resignation is accepted, the
 * last working date is the end date, and payroll should say so straight away.
 *
 * So the effective end is resolved here, in one place, from BOTH records:
 *   1. hr_employees.end_date when set (completion wrote it; it is the record of truth), else
 *   2. hr_offboarding.last_working_date while the offboarding is draft / pending_signoff /
 *      completed — never a cancelled one, which is a resignation withdrawn.
 *
 * A completed offboarding dated before the person's current start_date is a previous employment
 * (a rehire): it is ignored, or the rehired person would vanish from every payrun.
 *
 * Pure — the callers load the rows; this only decides. Shared by payrun generation, the coverage
 * panel and the payrun detail, so they cannot disagree about who is leaving when.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type OffboardingStatus = 'draft' | 'pending_signoff' | 'completed' | 'cancelled';

/** Offboarding statuses whose last_working_date counts as an agreed end of employment. */
export const EFFECTIVE_OFFBOARDING_STATUSES: readonly OffboardingStatus[] = [
  'draft',
  'pending_signoff',
  'completed',
];

export interface OffboardingEndRow {
  user_id: string;
  last_working_date: string | null;
  status: string | null;
  /** ISO timestamp — newest wins when one person has several rows. */
  created_at?: string | null;
}

export interface EmploymentEndInput {
  /** hr_employees.end_date */
  end_date: string | null | undefined;
  /** hr_employees.start_date — an offboarding older than this is a previous employment. */
  start_date?: string | null;
  /** hr_offboarding.last_working_date of the row chosen by pickOffboardingEnd (or null). */
  offboarding_last_working_date?: string | null;
  /** hr_offboarding.status of that row. */
  offboarding_status?: string | null;
}

export type EmploymentEndSource = 'employee' | 'offboarding';

export interface EmploymentEnd {
  /** YYYY-MM-DD, or null while the person is employed with no end agreed. */
  date: string | null;
  source: EmploymentEndSource | null;
}

function isEffectiveStatus(status: string | null | undefined): boolean {
  return (EFFECTIVE_OFFBOARDING_STATUSES as readonly string[]).includes(status ?? '');
}

/** The effective end of employment with where it came from. */
export function resolveEmploymentEndDetail(input: EmploymentEndInput): EmploymentEnd {
  if (input.end_date) return { date: input.end_date, source: 'employee' };
  const offEnd = input.offboarding_last_working_date ?? null;
  if (!offEnd || !isEffectiveStatus(input.offboarding_status)) return { date: null, source: null };
  // A rehired person's old offboarding must not end their new employment before it starts.
  if (input.start_date && offEnd < input.start_date) return { date: null, source: null };
  return { date: offEnd, source: 'offboarding' };
}

/** The effective end of employment as a date (YYYY-MM-DD) or null. */
export function resolveEmploymentEnd(input: EmploymentEndInput): string | null {
  return resolveEmploymentEndDetail(input).date;
}

function isOpenStatus(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'pending_signoff';
}

/**
 * One offboarding row per person out of a bulk load: an OPEN row (draft / pending_signoff) wins
 * over a completed one, the newest wins within a tier, and cancelled rows are dropped. The
 * unique index allows only one open row per person, so ties are only between completed ones.
 */
export function pickOffboardingEnds(rows: readonly OffboardingEndRow[]): Map<string, OffboardingEndRow> {
  const out = new Map<string, OffboardingEndRow>();
  for (const row of rows) {
    if (!isEffectiveStatus(row.status)) continue;
    const cur = out.get(row.user_id);
    if (!cur) {
      out.set(row.user_id, row);
      continue;
    }
    const curOpen = isOpenStatus(cur.status);
    const rowOpen = isOpenStatus(row.status);
    if (curOpen !== rowOpen) {
      if (rowOpen) out.set(row.user_id, row);
      continue;
    }
    if ((row.created_at ?? '') > (cur.created_at ?? '')) out.set(row.user_id, row);
  }
  return out;
}

/**
 * The offboarding rows that can end employment, for a set of people, in ONE query — picked down to
 * one row per person. Returns null on a query error so the caller can 500 rather than silently
 * treat everyone as employed (which is the exact bug this module exists to end).
 */
export async function loadOffboardingEnds(
  service: SupabaseClient,
  userIds: readonly string[]
): Promise<Map<string, OffboardingEndRow> | null> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await service
    .from('hr_offboarding')
    .select('user_id, last_working_date, status, created_at')
    .in('user_id', [...userIds])
    .in('status', [...EFFECTIVE_OFFBOARDING_STATUSES]);
  if (error) return null;
  return pickOffboardingEnds((data ?? []) as OffboardingEndRow[]);
}

/**
 * Resolve the effective end for one employee against the picked offboarding rows.
 * Convenience wrapper so callers do not have to spell the input out for every row.
 */
export function employmentEndFor(
  employee: { profile_id: string; start_date?: string | null; end_date: string | null | undefined },
  offboardingByUser: ReadonlyMap<string, OffboardingEndRow>
): EmploymentEnd {
  const off = offboardingByUser.get(employee.profile_id);
  return resolveEmploymentEndDetail({
    end_date: employee.end_date,
    start_date: employee.start_date ?? null,
    offboarding_last_working_date: off?.last_working_date ?? null,
    offboarding_status: off?.status ?? null,
  });
}
