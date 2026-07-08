import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { notifyUser } from '@/lib/notifications/service';

// GET /api/cron/attendance-reminder — schedule-aware check-in/out nudges (owner ask 2026-07-08).
// Fired every ~30 min by Supabase pg_cron (Vercel Hobby can't do sub-daily crons). For each
// employee scheduled to WORK today (not a day off, not on approved leave):
//   • past shift-start + GRACE and no clock-in  → "ยังไม่เช็คอิน"
//   • past shift-end + GRACE, clocked in but no clock-out → "ลืมเช็คเอาท์"
// De-duped to once per employee/day/kind via hr_attendance_reminders (insert-first is race-safe).
// Notifications go through notifyUser → in-app + PWA push. Role-agnostic (driven by the schedule).

const GRACE_MS = 30 * 60_000; // 30 minutes past the boundary before nudging
const BKK = '+07:00';
const MORNING_CUTOFF_HOUR = 6; // a shift start before 06:00 lands on the next calendar day

const hhmm = (t: string) => t.slice(0, 5);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Absolute ms for a shift's start + end on a business date (Bangkok wall-clock, overnight-safe).
function shiftBounds(businessDate: string, start: string, end: string): { startMs: number; endMs: number } {
  const startBase = Number(start.slice(0, 2)) < MORNING_CUTOFF_HOUR ? addDays(businessDate, 1) : businessDate;
  const endBase = toMin(end) <= toMin(start) ? addDays(startBase, 1) : startBase; // end earlier-or-equal = overnight
  return {
    startMs: new Date(`${startBase}T${hhmm(start)}:00${BKK}`).getTime(),
    endMs: new Date(`${endBase}T${hhmm(end)}:00${BKK}`).getTime(),
  };
}

interface Shift {
  start_time: string;
  end_time: string;
  label: string | null;
}
interface SchedRow {
  user_id: string;
  store_id: string | null;
  shift: Shift | Shift[] | null;
}

export async function GET(request: NextRequest) {
  const service = createServiceClient();

  // Auth: accept the Vercel CRON_SECRET (if set) OR a secret managed entirely on the Supabase side
  // (public.cron_secrets) — so this can be scheduled via pg_cron WITHOUT editing any Vercel env var.
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let authorized = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  if (!authorized) {
    const { data: sec } = await service
      .from('cron_secrets')
      .select('secret')
      .eq('name', 'attendance_reminder')
      .maybeSingle();
    authorized = !!sec?.secret && token === (sec.secret as string);
  }
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const businessDate = openBusinessDateBangkok();
  const now = Date.now();

  // Work days scheduled for today (with a shift).
  const { data: sched, error: schedErr } = await service
    .from('hr_schedule')
    .select('user_id, store_id, shift:hr_shift_templates(start_time, end_time, label)')
    .eq('work_date', businessDate)
    .eq('is_day_off', false);
  if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });

  const rows = ((sched ?? []) as unknown as SchedRow[])
    .map((r) => ({ ...r, shift: (Array.isArray(r.shift) ? r.shift[0] : r.shift) as Shift | null }))
    .filter((r): r is { user_id: string; store_id: string | null; shift: Shift } => !!r.shift);
  if (rows.length === 0) return NextResponse.json({ ok: true, reminded: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [punchRes, leaveRes, sentRes] = await Promise.all([
    service.from('hr_attendance').select('user_id, type').eq('business_date', businessDate).in('user_id', userIds),
    service
      .from('hr_leaves')
      .select('user_id')
      .eq('status', 'approved')
      .lte('from_date', businessDate)
      .gte('to_date', businessDate)
      .in('user_id', userIds),
    service.from('hr_attendance_reminders').select('user_id, kind').eq('business_date', businessDate).in('user_id', userIds),
  ]);

  const clockedIn = new Set<string>();
  const clockedOut = new Set<string>();
  for (const p of (punchRes.data ?? []) as { user_id: string; type: string }[]) {
    if (p.type === 'in') clockedIn.add(p.user_id);
    if (p.type === 'out') clockedOut.add(p.user_id);
  }
  const onLeave = new Set((leaveRes.data ?? []).map((l) => (l as { user_id: string }).user_id));
  const alreadySent = new Set(
    (sentRes.data ?? []).map((s) => `${(s as { user_id: string }).user_id}|${(s as { kind: string }).kind}`)
  );

  let reminded = 0;
  for (const r of rows) {
    if (onLeave.has(r.user_id)) continue;
    const { startMs, endMs } = shiftBounds(businessDate, r.shift.start_time, r.shift.end_time);

    // Missing check-in
    if (!clockedIn.has(r.user_id) && now >= startMs + GRACE_MS && !alreadySent.has(`${r.user_id}|checkin`)) {
      const { error } = await service
        .from('hr_attendance_reminders')
        .insert({ user_id: r.user_id, business_date: businessDate, kind: 'checkin' });
      if (!error) {
        await notifyUser({
          userId: r.user_id,
          storeId: r.store_id,
          type: 'hr_attendance_reminder',
          title: '⏰ ยังไม่ได้เช็คอิน',
          body: `วันนี้คุณมีกะ${r.shift.label ? ` ${r.shift.label}` : ''} เริ่ม ${hhmm(r.shift.start_time)} แต่ยังไม่ได้เช็คอิน กรุณาลงเวลาเข้างาน`,
          data: { url: '/me/checkin' },
        }).catch(() => {});
        reminded++;
      }
    }

    // Missing check-out (clocked in, never out)
    if (
      clockedIn.has(r.user_id) &&
      !clockedOut.has(r.user_id) &&
      now >= endMs + GRACE_MS &&
      !alreadySent.has(`${r.user_id}|checkout`)
    ) {
      const { error } = await service
        .from('hr_attendance_reminders')
        .insert({ user_id: r.user_id, business_date: businessDate, kind: 'checkout' });
      if (!error) {
        await notifyUser({
          userId: r.user_id,
          storeId: r.store_id,
          type: 'hr_attendance_reminder',
          title: '🚪 ลืมเช็คเอาท์?',
          body: `กะของคุณเลิก ${hhmm(r.shift.end_time)} แล้ว แต่ยังไม่ได้เช็คเอาท์ กรุณาลงเวลาออกงาน`,
          data: { url: '/me/checkin' },
        }).catch(() => {});
        reminded++;
      }
    }
  }

  return NextResponse.json({ ok: true, business_date: businessDate, reminded });
}
