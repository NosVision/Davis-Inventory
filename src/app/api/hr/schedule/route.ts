import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireSchedulerForScope } from '@/lib/hr/route-auth';
import { isDateInFinalizedPeriod, employeeStoreIds, FINALIZED_PERIOD_ERROR } from '@/lib/hr/period-lock';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const DEFAULT_WORK_HOURS = 9;
const DEFAULT_DAYS_OFF = 6;

interface StoreMember {
  user_id: string;
}
interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  is_system: boolean | null;
}
/** A PostgREST to-one embed arrives as an object, but the generated types widen it to an array. */
type NamedRef = { name: string | null } | { name: string | null }[] | null;
function refName(r: NamedRef | undefined): string | null {
  if (!r) return null;
  return (Array.isArray(r) ? r[0]?.name : r.name) ?? null;
}

interface EmployeeRow {
  profile_id: string;
  full_name: string | null;
  work_hours_per_day: number | null;
  standard_days_off: number | null;
  status: string | null;
  end_date: string | null;
  company_id: string | null;
  position?: { name: string | null; sort_order: number | null } | { name: string | null; sort_order: number | null }[] | null;
  // Why a store roster and that store's payrun list different people: the roster is keyed on store
  // membership, a payrun on company + payroll group. Sent along so the row can say so itself.
  company?: NamedRef;
  payroll_group?: NamedRef;
}

// Roster scope (owner ask 2026-07-27): a month is scheduled per STORE (user_stores members,
// the original mode) or per COMPANY (every hr_employees of that company — reaches housekeepers/
// technicians with no store membership). company_id may be the literal 'none' = employees with
// no company yet. Row storage: store rows keep store_id; company rows have store_id NULL and
// company_id set (NULL for the none-bucket).
type Scope =
  | { kind: 'store'; storeId: string }
  | { kind: 'company'; companyId: string | null };

function parseScope(storeId: string, companyParam: string): Scope | null {
  if (companyParam) return { kind: 'company', companyId: companyParam === 'none' ? null : companyParam };
  if (storeId) return { kind: 'store', storeId };
  return null;
}

function positionOf(e: EmployeeRow): { name: string | null; sort_order: number | null } | null {
  const p = e.position;
  if (!p) return null;
  return Array.isArray(p) ? p[0] ?? null : p;
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

  const EMP_SELECT =
    'profile_id, full_name, work_hours_per_day, standard_days_off, status, end_date, company_id, ' +
    'position:hr_positions(name, sort_order), company:hr_companies(name), payroll_group:hr_payroll_groups(name)';

  let userIds: string[] = [];
  let employees: EmployeeRow[] = [];
  if (scope.kind === 'store') {
    // Staff assigned to this store.
    const { data: membersData, error: membersErr } = await service
      .from('user_stores')
      .select('user_id')
      .eq('store_id', scope.storeId);
    if (membersErr) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
    userIds = (membersData as StoreMember[] | null)?.map((r) => r.user_id) ?? [];
    if (userIds.length) {
      const { data, error } = await service.from('hr_employees').select(EMP_SELECT).in('profile_id', userIds);
      if (error) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
      employees = (data ?? []) as unknown as EmployeeRow[];
    }
  } else {
    // Every employee of the company (or of no company yet), store membership irrelevant.
    let q = service.from('hr_employees').select(EMP_SELECT);
    q = scope.companyId ? q.eq('company_id', scope.companyId) : q.is('company_id', null);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
    employees = (data ?? []) as unknown as EmployeeRow[];
    userIds = employees.map((e) => e.profile_id);
  }

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

  const [profilesRes, templatesRes, entriesRes, companiesRes] = await Promise.all([
    userIds.length
      ? service.from('profiles').select('id, username, display_name, is_system').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    tplQuery,
    entryQuery,
    // Companies for the page's scope picker (small list, sent along every load).
    service.from('hr_companies').select('id, name').order('name'),
  ]);

  if (profilesRes.error || templatesRes.error || entriesRes.error) {
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const entries = (entriesRes.data ?? []) as ScheduleRow[];

  const empByProfile = new Map(employees.map((e) => [e.profile_id, e]));
  // A store member is on the roster unless they had already left before this month began:
  // a leaver stays visible for any month overlapping their employment (end_date >= month
  // start), mirroring the payroll leaver-window, then drops off in later months. This
  // keeps a just-offboarded person's final-month roster viewable (client ask 2026-07-22).
  const staff = profiles
    // System accounts (print servers, test fixtures) are store members so the print server can
    // authenticate — they are not people, so they stay off the roster. profiles.is_system now,
    // rather than sniffing the username (2026-08-11).
    .filter((p) => !p.is_system)
    .filter((p) => {
      const e = empByProfile.get(p.id);
      // No HR record, no row — in either scope.
      //
      // Store scope used to list every store member regardless, on the theory that someone can be
      // working before their employee record is filled in. In practice it listed dead accounts:
      // the sweep (00183) switched off every login with no payroll name behind it and left
      // user_stores untouched, so 99 swept accounts stayed on the rosters, under their usernames
      // because there is no full name to show.
      //
      // Rostering someone the payroll cannot name is not useful anyway — you cannot pay a shift
      // you cannot attach to a person (owner decision 2026-08-14). Requiring the record makes HR
      // link them first, which is the step that was being skipped. Nobody real is lost: the only
      // active store member without a record today is the owner's own account.
      if (!e) return false;
      if (e.status !== 'resigned' && e.status !== 'terminated') return true;
      return !!e.end_date && e.end_date >= first;
    })
    .map((p) => {
      const e = empByProfile.get(p.id);
      const departed = e?.status === 'resigned' || e?.status === 'terminated';
      const pos = e ? positionOf(e) : null;
      return {
        user_id: p.id,
        name: p.display_name || p.username || '—',
        // For the roster's nickname ↔ full-name toggle: real name from the HR record,
        // login username as the last-resort fallback.
        full_name: e?.full_name ?? null,
        username: p.username ?? null,
        // Company scope sorts/labels by job position ("ไม่มี" group for the unassigned).
        position_name: pos?.name ?? null,
        position_sort: pos?.sort_order ?? null,
        // Payrun scope, for the chips that explain a store-vs-company list difference.
        company_name: refName(e?.company),
        payroll_group_name: refName(e?.payroll_group),
        work_hours_per_day: e?.work_hours_per_day ?? DEFAULT_WORK_HOURS,
        standard_days_off: e?.standard_days_off ?? DEFAULT_DAYS_OFF,
        // Signals the roster UI that this person has left (their end_date caps assignments).
        end_date: departed ? (e?.end_date ?? null) : null,
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

  // Company public holidays for the month → the roster auto-marks them as day-off (they already
  // skip payroll/leave counting; the roster used to require manual entry). Global holidays
  // (company_id IS NULL) apply to every store; company holidays only to this store's company.
  const companyId =
    scope.kind === 'company' ? scope.companyId : employees.find((e) => e.company_id)?.company_id ?? null;
  let holidayFilter = service
    .from('hr_holidays')
    .select('holiday_date, name_th, name_en')
    .eq('active', true)
    .gte('holiday_date', first)
    .lte('holiday_date', last);
  holidayFilter = companyId
    ? holidayFilter.or(`company_id.eq.${companyId},company_id.is.null`)
    : holidayFilter.is('company_id', null);
  const { data: holidayRows } = await holidayFilter;
  const holidays = (holidayRows ?? []) as { holiday_date: string; name_th: string; name_en: string }[];

  // Who has NOTHING on the roster this month. HR asked to see this plainly (2026-08-07): an
  // employee with no rows is not "scheduled for zero days" — nobody has thought about them at
  // all, and it is invisible in a grid where their line just looks empty like any other.
  const scheduledUserIds = new Set(entries.map((e) => e.user_id));
  const unscheduled = staff
    .filter((s) => !scheduledUserIds.has(s.user_id))
    .map((s) => ({ user_id: s.user_id, name: s.full_name || s.name, position_name: s.position_name ?? null }));

  return NextResponse.json({
    employees: staff,
    templates,
    entries,
    balance,
    monthStatus,
    holidays,
    unscheduled,
    companies: companiesRes.data ?? [],
  });
}

// POST — upsert one cell { (store_id|company_id), user_id, work_date, shift_template_id|null, is_day_off }.
// Any manager edit returns the cell to 'draft' so the roster must be re-submitted.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const scope = parseScope(storeId, typeof body.company_id === 'string' ? body.company_id : '');
  if (!scope) return NextResponse.json({ error: 'store_id or company_id is required' }, { status: 400 });
  const auth = await requireSchedulerForScope(scope.kind === 'store' ? scope.storeId : null);
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

  // The employee must belong to this scope: store membership, or the company on their HR record.
  if (scope.kind === 'store') {
    const { data: member, error: memberErr } = await service
      .from('user_stores')
      .select('user_id')
      .eq('store_id', scope.storeId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memberErr) return NextResponse.json({ error: 'Failed to verify staff' }, { status: 500 });
    if (!member) {
      return NextResponse.json({ error: 'Employee is not assigned to this store' }, { status: 400 });
    }
  } else {
    const { data: emp, error: empErr } = await service
      .from('hr_employees')
      .select('company_id')
      .eq('profile_id', userId)
      .maybeSingle();
    if (empErr) return NextResponse.json({ error: 'Failed to verify staff' }, { status: 500 });
    if (!emp || (emp.company_id ?? null) !== scope.companyId) {
      return NextResponse.json({ error: 'Employee is not in this company scope' }, { status: 400 });
    }
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

  // A shift assignment must reference an active template of THIS scope.
  if (shiftTemplateId) {
    let tplQ = service
      .from('hr_shift_templates')
      .select('id')
      .eq('id', shiftTemplateId)
      .eq('active', true);
    if (scope.kind === 'store') tplQ = tplQ.eq('store_id', scope.storeId);
    else if (scope.companyId) tplQ = tplQ.eq('company_id', scope.companyId);
    else tplQ = tplQ.is('store_id', null).is('company_id', null);
    const { data: tpl, error: tplErr } = await tplQ.maybeSingle();
    if (tplErr) return NextResponse.json({ error: 'Failed to verify shift' }, { status: 500 });
    if (!tpl) {
      return NextResponse.json({ error: 'Invalid shift template for this scope' }, { status: 400 });
    }
  }

  // §Phase 0B: don't let a finalized (possibly paid) period's roster be edited after the fact.
  // hr_schedule is unique on (user_id, work_date), so the lock must span EVERY store the employee
  // works — not just this one — or an upsert here could overwrite another store's finalized row.
  try {
    const storeIds = await employeeStoreIds(service, userId, scope.kind === 'store' ? scope.storeId : null);
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
        store_id: scope.kind === 'store' ? scope.storeId : null,
        company_id: scope.kind === 'company' ? scope.companyId : null,
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
