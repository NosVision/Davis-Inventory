import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { isDateInFinalizedPeriod, employeeStoreIds, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';
import { loadPunchedInRange, neverPunchedWindow } from '@/lib/hr/work-venues';
import {
  resolveRoster,
  rosterMemberName,
  loadSchedulableProfileIds,
  findNotSchedulable,
  type RosterMember,
} from '@/lib/hr/roster';
import { todayBangkok } from '@/lib/utils/date';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
// The "everyone must clock in" policy only started counting from this date (spec §4 D1, owner
// decision 2026-08-28) — see neverPunchedWindow's doc comment for why the banner floors its
// lookback here instead of always widening a fixed number of days off of today.
const NEVER_PUNCHED_POLICY_START = '2026-09-01';

const DEFAULT_WORK_HOURS = 9;
const DEFAULT_DAYS_OFF = 6;

// Roster scope (owner ask 2026-07-27): a month is scheduled per STORE (user_stores members ∪
// work_store_id assignees, the original mode) or per COMPANY (every hr_employees of that company —
// reaches housekeepers/technicians with no store membership). company_id may be the literal
// 'none' = employees with no company yet. Row storage: store rows keep store_id; company rows
// have store_id NULL and company_id set (NULL for the none-bucket). WHO is listed for either
// scope is decided by lib/hr/roster.ts — the same answer the timesheet and the SC pool get.
type Scope =
  | { kind: 'store'; storeId: string }
  | { kind: 'company'; companyId: string | null };

function parseScope(storeId: string, companyParam: string): Scope | null {
  if (companyParam) return { kind: 'company', companyId: companyParam === 'none' ? null : companyParam };
  if (storeId) return { kind: 'store', storeId };
  return null;
}
interface TemplateRow {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  color: string | null;
}
interface ScheduleRow {
  id: string;
  user_id: string;
  work_date: string;
  shift_template_id: string | null;
  is_day_off: boolean;
  status: string;
  note: string | null;
}

// First/last calendar day (YYYY-MM-DD) of a YYYY-MM month.
function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, '0')}` };
}

// Minutes-since-midnight from a 'HH:MM' or 'HH:MM:SS' time string.
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Shift length in minutes, wrapping past midnight (17:00–01:00 = 480).
function shiftMinutes(start: string, end: string): number {
  const d = (toMinutes(end) - toMinutes(start) + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

// GET /api/hr/schedule?(store_id|company_id)&month=YYYY-MM — a monthly roster (§C):
// employees + shift templates + assignments + a per-employee balance summary. Company scope
// (company_id, or 'none' for company-less staff) reaches employees with no store membership.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const scope = parseScope(sp.get('store_id') ?? '', sp.get('company_id') ?? '');
  if (!scope) return NextResponse.json({ error: 'store_id or company_id is required' }, { status: 400 });
  // A store roster is the venue manager's to build; company rosters stay HQ/HR.
  const auth = await requireSchedulerForScope(scope.kind === 'store' ? scope.storeId : null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const month = sp.get('month') ?? '';
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const { first, last } = monthRange(month);

  const service = createServiceClient();

  // Members listed here only on the strength of a user_stores row — no roster row and no punch at
  // this venue this month. `user_stores` came from the deposit module and can mean "oversees this
  // venue" rather than "works here", so an HR/accounting user overseeing five venues was appearing
  // on five rosters (owner report 2026-08-17). Reported separately; nobody vanishes silently.
  const includeInactive = sp.get('include_inactive') === 'true';

  // The month's people, by the one rule every venue surface shares (lib/hr/roster.ts): a linked
  // hr_employees record, not a system account, employed at some point in the month; store scope
  // additionally split on venue evidence. Sorted by name; company scope re-sorts by position below.
  let members: RosterMember[];
  let inactiveMembers: RosterMember[];
  try {
    const roster = await resolveRoster(service, { scope, from: first, to: last, includeInactive });
    members = roster.members;
    inactiveMembers = roster.inactiveHere;
  } catch {
    return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  }
  const userIds = members.map((m) => m.profile_id);

  // Templates belong to the scope: a store's set, a company's set, or the global none-bucket.
  let tplQuery = service
    .from('hr_shift_templates')
    .select('id, label, start_time, end_time, color')
    .eq('active', true)
    .order('start_time');
  if (scope.kind === 'store') tplQuery = tplQuery.eq('store_id', scope.storeId);
  else if (scope.companyId) tplQuery = tplQuery.eq('company_id', scope.companyId);
  else tplQuery = tplQuery.is('store_id', null).is('company_id', null);

  // Entries: store scope keeps the original store filter; company scope shows EVERY row of the
  // listed people that month (their store rows included) — the company view is the full picture.
  let entryQuery = service
    .from('hr_schedule')
    .select('id, user_id, work_date, shift_template_id, is_day_off, status, note')
    .gte('work_date', first)
    .lte('work_date', last);
  if (scope.kind === 'store') entryQuery = entryQuery.eq('store_id', scope.storeId);
  else entryQuery = userIds.length ? entryQuery.in('user_id', userIds) : entryQuery.eq('user_id', NIL_UUID);

  const [templatesRes, entriesRes] = await Promise.all([tplQuery, entryQuery]);

  if (templatesRes.error || entriesRes.error) {
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
  }

  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const entries = (entriesRes.data ?? []) as ScheduleRow[];

  // Who is on the roster — record required, system accounts out, leaver-window applied — was
  // decided by resolveRoster above; this only shapes the rows the grid reads.
  const staff = members
    .map((m) => {
      const departed = m.status === 'resigned' || m.status === 'terminated';
      return {
        user_id: m.profile_id,
        name: m.display_name || m.username || '—',
        // For the roster's nickname ↔ full-name toggle: real name from the HR record,
        // login username as the last-resort fallback.
        full_name: m.full_name,
        username: m.username,
        // Company scope sorts/labels by job position ("ไม่มี" group for the unassigned).
        position_name: m.position_name,
        position_sort: m.position_sort,
        // Payrun scope, for the chips that explain a store-vs-company list difference.
        company_name: m.company_name,
        payroll_group_name: m.payroll_group_name,
        work_hours_per_day: m.work_hours_per_day ?? DEFAULT_WORK_HOURS,
        standard_days_off: m.standard_days_off ?? DEFAULT_DAYS_OFF,
        // Signals the roster UI that this person has left (their end_date caps assignments).
        end_date: departed ? m.end_date : null,
      };
    })
    .sort((a, b) => {
      if (scope.kind === 'company') {
        // Position first (positions' own sort_order, "no position" last), then name.
        const sa = a.position_sort ?? Number.MAX_SAFE_INTEGER;
        const sb = b.position_sort ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        const pn = (a.position_name ?? 'ๆๆๆ').localeCompare(b.position_name ?? 'ๆๆๆ', 'th');
        if (pn !== 0) return pn;
      }
      return a.name.localeCompare(b.name, 'th');
    });

  const tplById = new Map(templates.map((t) => [t.id, t]));

  // Per-employee balance: work vs off days and scheduled vs standard minutes.
  const balance = staff.map((s) => {
    const mine = entries.filter((e) => e.user_id === s.user_id);
    const workDays = mine.filter((e) => !e.is_day_off).length;
    const dayOffDays = mine.filter((e) => e.is_day_off).length;
    const scheduledMinutes = mine.reduce((sum, e) => {
      if (e.is_day_off || !e.shift_template_id) return sum;
      const t = tplById.get(e.shift_template_id);
      return t ? sum + shiftMinutes(t.start_time, t.end_time) : sum;
    }, 0);
    return {
      user_id: s.user_id,
      work_days: workDays,
      day_off_days: dayOffDays,
      scheduled_minutes: scheduledMinutes,
      standard_minutes: workDays * s.work_hours_per_day * 60,
      off_target: s.standard_days_off,
      off_delta: dayOffDays - s.standard_days_off,
    };
  });

  // Aggregate publish state for the month → drives the submit/acknowledge buttons.
  let monthStatus: 'empty' | 'draft' | 'submitted' | 'acknowledged' | 'mixed' = 'empty';
  if (entries.length) {
    const statuses = new Set(entries.map((e) => e.status));
    monthStatus = statuses.size === 1 ? (entries[0].status as typeof monthStatus) : 'mixed';
  }


  // Who has NOTHING on the roster this month. HR asked to see this plainly (2026-08-07): an
  // employee with no rows is not "scheduled for zero days" — nobody has thought about them at
  // all, and it is invisible in a grid where their line just looks empty like any other.
  const scheduledUserIds = new Set(entries.map((e) => e.user_id));
  const unscheduled = staff
    .filter((s) => !scheduledUserIds.has(s.user_id))
    .map((s) => ({ user_id: s.user_id, name: s.full_name || s.name, position_name: s.position_name ?? null }));

  // Rostered here but never actually clocks in — the other half of the same incident. Someone can be
  // "attached" to this venue purely on the strength of a roster row (loadVenueAttachment above counts
  // that as evidence too), while never once producing a KEPT punch — and that combination is exactly
  // what turns every one of their rostered days into an absence the time engine cannot tell apart
  // from someone simply not showing up (owner report: ten such staff docked ~20 days each, nothing on
  // any screen saying so until a payslip was opened). Store scope only: company rosters are a legacy
  // read path with no venue-attachment concept to hang this off.
  //
  // Window: anchored to TODAY via neverPunchedWindow, never the viewed `month` above — a future or
  // historical month must not ask the question about a window that hasn't happened yet or has long
  // since closed. Floored at NEVER_PUNCHED_POLICY_START, and suppressed outright when the org-wide
  // punched set for the window is empty: no evidence is not proof of absence, and after migration
  // 00196 wiped every attendance row, an unfloored window named ~124 of 127 people (owner report
  // 2026-08-28).
  let neverPunched: { user_id: string; name: string }[] = [];
  if (scope.kind === 'store' && staff.length > 0) {
    const window = neverPunchedWindow(todayBangkok(), NEVER_PUNCHED_POLICY_START);
    if (window) {
      try {
        const punched = await loadPunchedInRange(service, window.from, window.to);
        if (punched.size > 0) {
          neverPunched = staff
            .filter((s) => !punched.has(s.user_id))
            .map((s) => ({ user_id: s.user_id, name: s.full_name || s.name }));
        }
      } catch {
        // Evidence unavailable → no banner rather than a wrong one; a reload retries once it recovers.
        neverPunched = [];
      }
    }
  }

  // Names of the members held out of the grid, so the page can offer them back rather than just
  // quietly showing fewer people than last month.
  const inactive_here = inactiveMembers.map((m) => ({ user_id: m.profile_id, name: rosterMemberName(m) }));

  return NextResponse.json({
    employees: staff,
    templates,
    entries,
    balance,
    monthStatus,
    unscheduled,
    never_punched: neverPunched,
    inactive_here,
  });
}

// POST — upsert one cell { (store_id|company_id), user_id, work_date, shift_template_id|null, is_day_off }.
// Any manager edit returns the cell to 'draft' so the roster must be re-submitted.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const scope = parseScope(storeId, typeof body.company_id === 'string' ? body.company_id : '');
  if (!scope) return NextResponse.json({ error: 'store_id or company_id is required' }, { status: 400 });
  // Rosters are per-store from 2026-08-28 (owner decision): the office is itself a store, so the
  // company scope no longer has a population of its own. Reads still accept it for legacy rows.
  if (scope.kind === 'company') {
    return NextResponse.json(
      { error: 'ตารางกะจัดเป็นรายสาขาเท่านั้น — เลือกสาขา (สำนักงานก็เป็นสาขาหนึ่ง)' },
      { status: 400 }
    );
  }
  const auth = await requireSchedulerForScope(scope.storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const workDate = typeof body.work_date === 'string' ? body.work_date : '';
  const isDayOff = body.is_day_off === true;
  const shiftTemplateId =
    typeof body.shift_template_id === 'string' ? body.shift_template_id : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

  if (!userId || !DATE_RE.test(workDate)) {
    return NextResponse.json({ error: 'user_id and a valid work_date are required' }, { status: 400 });
  }
  // Exactly one of: a day off, or a shift assignment.
  if (isDayOff === !!shiftTemplateId) {
    return NextResponse.json(
      { error: 'Provide either is_day_off or a shift_template_id, not both' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // The employee must be someone this store's roster lists — the same rule the GET uses, so a
  // person the grid shows can always be scheduled. Used to demand a user_stores row, which refused
  // everyone HR had placed here via work_store_id alone (2026-09-19).
  try {
    const rosterIds = await loadSchedulableProfileIds(service, scope.storeId, workDate, workDate);
    if (findNotSchedulable(rosterIds, [userId])) {
      return NextResponse.json({ error: 'Employee is not assigned to this store' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify staff' }, { status: 500 });
  }

  // A leaver stays visible on the roster for their final month, so cap edits at their
  // last working day — no assignments past the employment end.
  const { data: empRec, error: empRecErr } = await service
    .from('hr_employees')
    .select('status, end_date')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empRecErr) return NextResponse.json({ error: 'Failed to verify staff' }, { status: 500 });
  if (
    empRec &&
    (empRec.status === 'resigned' || empRec.status === 'terminated') &&
    (!empRec.end_date || workDate > (empRec.end_date as string))
  ) {
    return NextResponse.json(
      { error: 'This employee has left — cannot schedule beyond their last working day' },
      { status: 400 }
    );
  }

  // A shift assignment must reference an active template of THIS store.
  if (shiftTemplateId) {
    const { data: tpl, error: tplErr } = await service
      .from('hr_shift_templates')
      .select('id')
      .eq('id', shiftTemplateId)
      .eq('active', true)
      .eq('store_id', scope.storeId)
      .maybeSingle();
    if (tplErr) return NextResponse.json({ error: 'Failed to verify shift' }, { status: 500 });
    if (!tpl) {
      return NextResponse.json({ error: 'Invalid shift template for this scope' }, { status: 400 });
    }
  }

  // §Phase 0B: don't let a finalized (possibly paid) period's roster be edited after the fact.
  // hr_schedule is unique on (user_id, work_date), so the lock must span EVERY store the employee
  // works — not just this one — or an upsert here could overwrite another store's finalized row.
  try {
    const storeIds = await employeeStoreIds(service, userId, scope.storeId);
    if (await isDateInFinalizedPeriod(service, workDate, storeIds)) {
      return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
  }

  const { data, error } = await service
    .from('hr_schedule')
    .upsert(
      {
        store_id: scope.storeId,
        company_id: null,
        user_id: userId,
        work_date: workDate,
        shift_template_id: isDayOff ? null : shiftTemplateId,
        is_day_off: isDayOff,
        note,
        status: 'draft',
        created_by: auth.userId,
      },
      { onConflict: 'user_id,work_date' }
    )
    .select('id, user_id, work_date, shift_template_id, is_day_off, status, note')
    .single();
  if (error) return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
  return NextResponse.json({ data });
}

// DELETE ?id — clear one cell, guarded by the row's own store.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: row, error: rowErr } = await service
    .from('hr_schedule')
    .select('store_id, work_date, user_id')
    .eq('id', id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: 'Failed to load assignment' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const auth = await requireSchedulerForScope((row.store_id as string | null) ?? null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // §Phase 0B: a finalized (possibly paid) period's roster is locked from deletion too — across
  // every store the employee works (unique key is user_id+work_date).
  try {
    const storeIds = await employeeStoreIds(service, row.user_id as string, row.store_id as string);
    if (await isDateInFinalizedPeriod(service, row.work_date as string, storeIds)) {
      return NextResponse.json({ error: FINALIZED_PERIOD_ERROR }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to verify pay period' }, { status: 500 });
  }

  const { error } = await service.from('hr_schedule').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to clear assignment' }, { status: 500 });
  return NextResponse.json({ data: { id } });
}
