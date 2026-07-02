import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStoreManager } from '@/lib/hr/route-auth';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_WORK_HOURS = 9;
const DEFAULT_DAYS_OFF = 6;

interface StoreMember {
  user_id: string;
}
interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}
interface EmployeeRow {
  profile_id: string;
  work_hours_per_day: number | null;
  standard_days_off: number | null;
  status: string | null;
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

// GET /api/hr/schedule?store_id&month=YYYY-MM — a store's monthly roster (§C):
// employees + shift templates + assignments + a per-employee balance summary.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const storeId = sp.get('store_id') ?? '';
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const month = sp.get('month') ?? '';
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  const { first, last } = monthRange(month);

  const service = createServiceClient();

  // Staff assigned to this store.
  const { data: membersData, error: membersErr } = await service
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId);
  if (membersErr) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 });
  const userIds = (membersData as StoreMember[] | null)?.map((r) => r.user_id) ?? [];

  const [profilesRes, employeesRes, templatesRes, entriesRes] = await Promise.all([
    userIds.length
      ? service.from('profiles').select('id, username, display_name').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? service
          .from('hr_employees')
          .select('profile_id, work_hours_per_day, standard_days_off, status')
          .in('profile_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    service
      .from('hr_shift_templates')
      .select('id, label, start_time, end_time, color')
      .eq('store_id', storeId)
      .eq('active', true)
      .order('start_time'),
    service
      .from('hr_schedule')
      .select('id, user_id, work_date, shift_template_id, is_day_off, status, note')
      .eq('store_id', storeId)
      .gte('work_date', first)
      .lte('work_date', last),
  ]);

  if (profilesRes.error || employeesRes.error || templatesRes.error || entriesRes.error) {
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
  }

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const employees = (employeesRes.data ?? []) as EmployeeRow[];
  const templates = (templatesRes.data ?? []) as TemplateRow[];
  const entries = (entriesRes.data ?? []) as ScheduleRow[];

  const empByProfile = new Map(employees.map((e) => [e.profile_id, e]));
  // A store member is schedulable unless their HR employee record is resigned/terminated.
  const staff = profiles
    .filter((p) => {
      const e = empByProfile.get(p.id);
      return !e || (e.status !== 'resigned' && e.status !== 'terminated');
    })
    .map((p) => {
      const e = empByProfile.get(p.id);
      return {
        user_id: p.id,
        name: p.display_name || p.username || '—',
        work_hours_per_day: e?.work_hours_per_day ?? DEFAULT_WORK_HOURS,
        standard_days_off: e?.standard_days_off ?? DEFAULT_DAYS_OFF,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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

  return NextResponse.json({
    employees: staff,
    templates,
    entries,
    balance,
    monthStatus,
  });
}

// POST — upsert one cell { store_id, user_id, work_date, shift_template_id|null, is_day_off }.
// Any manager edit returns the cell to 'draft' so the roster must be re-submitted.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const auth = await requireStoreManager(storeId);
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

  // The employee must belong to this store.
  const { data: member, error: memberErr } = await service
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('user_id', userId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: 'Failed to verify staff' }, { status: 500 });
  if (!member) {
    return NextResponse.json({ error: 'Employee is not assigned to this store' }, { status: 400 });
  }

  // A shift assignment must reference an active template of THIS store.
  if (shiftTemplateId) {
    const { data: tpl, error: tplErr } = await service
      .from('hr_shift_templates')
      .select('id')
      .eq('id', shiftTemplateId)
      .eq('store_id', storeId)
      .eq('active', true)
      .maybeSingle();
    if (tplErr) return NextResponse.json({ error: 'Failed to verify shift' }, { status: 500 });
    if (!tpl) {
      return NextResponse.json({ error: 'Invalid shift template for this store' }, { status: 400 });
    }
  }

  const { data, error } = await service
    .from('hr_schedule')
    .upsert(
      {
        store_id: storeId,
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
    .select('store_id')
    .eq('id', id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: 'Failed to load assignment' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const auth = await requireStoreManager(row.store_id as string);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { error } = await service.from('hr_schedule').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to clear assignment' }, { status: 500 });
  return NextResponse.json({ data: { id } });
}
