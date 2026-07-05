import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';

// GET /api/hr/dashboard/alerts?window_days= — forward-looking HR reminders for the caller's scope
// (§P1.5): (1) probation ending within the window (status='probation', probation_end in range),
// (2) upcoming work anniversaries (start_date's month-day in range), and (3) SSO pending —
// full-time staff PAST probation who still aren't enrolled in social security (sso_enrolled=false).
// (3) deliberately nudges instead of auto-flipping the flag: real enrolment needs สปส. paperwork,
// so HR registers first, then ticks the box (per the owner, 2026-07-05). Read-only. Dates are
// calendar dates in the Bangkok business sense; the page passes no timezone.
interface EmpRow {
  profile_id: string;
  status: string;
  start_date: string | null;
  probation_end: string | null;
  pay_type: string | null;
  sso_enrolled: boolean | null;
  profile: { display_name: string | null; username: string | null; active: boolean | null } | null;
}
const DAY_MS = 86_400_000;
const nameOf = (p: EmpRow['profile']) => p?.display_name || p?.username || '—';

function todayBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}
// next occurrence (>= today) of an anniversary date's month/day, as an ISO date
function nextAnniversary(startIso: string, todayIso: string): { iso: string; years: number } | null {
  const d = new Date(`${startIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  for (const year of [ty, ty + 1]) {
    const cand = new Date(Date.UTC(year, mo, day));
    // guard Feb-29 rolling into Mar-1: keep the realized month/day
    const iso = cand.toISOString().slice(0, 10);
    const [cy, cm, cd] = iso.split('-').map(Number);
    const notPast = cy > ty || (cy === ty && (cm > tm || (cm === tm && cd >= td)));
    if (notPast) return { iso, years: year - d.getUTCFullYear() };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const windowDays = Math.min(Math.max(Number(request.nextUrl.searchParams.get('window_days')) || 14, 1), 90);
  const storeFilter = request.nextUrl.searchParams.get('store_id');
  const today = todayBangkok();
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + windowDays * DAY_MS).toISOString().slice(0, 10);

  const service = createServiceClient();

  // The store set we're allowed to look at: an explicit ?store_id must be within scope.
  let storeIds: string[] | null = scope.storeIds; // null = all (company-HR)
  if (storeFilter) {
    if (storeIds && !storeIds.includes(storeFilter)) {
      return NextResponse.json({ error: 'store out of scope' }, { status: 403 });
    }
    storeIds = [storeFilter];
  }

  // Scope: company-HR (storeIds null) → all; otherwise → those stores' staff.
  let scopedUserIds: Set<string> | null = null;
  if (storeIds) {
    const { data: us, error } = await service.from('user_stores').select('user_id').in('store_id', storeIds);
    if (error) return NextResponse.json({ error: 'Scope lookup failed' }, { status: 500 });
    scopedUserIds = new Set((us ?? []).map((r) => r.user_id as string));
    if (scopedUserIds.size === 0) return NextResponse.json({ data: { window_days: windowDays, probation_ending: [], anniversaries: [], sso_pending: [] } });
  }

  let q = service
    .from('hr_employees')
    .select('profile_id, status, start_date, probation_end, pay_type, sso_enrolled, profile:profiles!hr_employees_profile_id_fkey(display_name, username, active)')
    .in('status', ['active', 'probation']);
  if (scopedUserIds) q = q.in('profile_id', [...scopedUserIds]);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });

  const rows = ((data ?? []) as unknown as EmpRow[]).filter((e) => e.profile?.active !== false);

  const probation_ending = rows
    .filter((e) => e.status === 'probation' && e.probation_end && e.probation_end >= today && e.probation_end <= horizon)
    .map((e) => ({ user_id: e.profile_id, name: nameOf(e.profile), date: e.probation_end as string, days_left: daysBetween(today, e.probation_end as string) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const anniversaries = rows
    .map((e) => {
      if (!e.start_date) return null;
      const next = nextAnniversary(e.start_date, today);
      if (!next || next.iso < today || next.iso > horizon || next.years <= 0) return null;
      return { user_id: e.profile_id, name: nameOf(e.profile), date: next.iso, years: next.years, days_left: daysBetween(today, next.iso) };
    })
    .filter((x): x is { user_id: string; name: string; date: string; years: number; days_left: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Past probation but still not in SSO — full-time only (part-time gets no SSO by policy, §Q9).
  // Overdue has no window: once probation_end passes, the nudge stays until HR enrols + ticks.
  const sso_pending = rows
    .filter(
      (e) =>
        e.pay_type === 'full_monthly' &&
        e.sso_enrolled === false &&
        e.probation_end !== null &&
        e.probation_end < today
    )
    .map((e) => ({
      user_id: e.profile_id,
      name: nameOf(e.profile),
      date: e.probation_end as string,
      days_over: daysBetween(e.probation_end as string, today),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 50);

  return NextResponse.json({ data: { window_days: windowDays, probation_ending, anniversaries, sso_pending } });
}
