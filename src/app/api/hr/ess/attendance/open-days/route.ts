import { NextResponse } from 'next/server';
import { createClient, createServiceClient, getSessionUser } from '@/lib/supabase/server';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { findUnclosedDays } from '@/lib/hr/open-attendance';
import { closingInstantAfter, BUSINESS_DAY_CUTOFF_HOUR } from '@/lib/hr/attendance-window';

/**
 * GET /api/hr/ess/attendance/open-days — the caller's own days that have a check-IN and no
 * check-OUT, with the scheduled shift end (the sensible default time to propose) and whether a
 * request is already in flight for that day.
 *
 * Exists so the employee does not have to reconstruct any of this by hand: before, filing a
 * missing check-out meant knowing which day was broken, opening a blank form, picking the kind,
 * and typing a full timestamp — for a problem the server can already describe exactly.
 */
/**
 * The instant a shift on `businessDate` starts. A start before the 06:00 business-day cutoff (a
 * 01:00 start) belongs to the small hours of the NEXT calendar day, as the business date does.
 */
function shiftStartInstant(businessDate: string, startTime: string): string {
  const hhmm = startTime.slice(0, 5);
  const d = new Date(`${businessDate}T${hhmm}:00+07:00`);
  if (Number(hhmm.slice(0, 2)) < BUSINESS_DAY_CUTOFF_HOUR) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getSessionUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const today = openBusinessDateBangkok();
  const open = await findUnclosedDays(service, user.id, today);
  if (open.length === 0) return NextResponse.json({ data: [] });

  const dates = open.map((d) => d.business_date);

  const [schedRes, reqRes] = await Promise.all([
    service
      .from('hr_schedule')
      .select('work_date, shift:hr_shift_templates(start_time, end_time, label)')
      .eq('user_id', user.id)
      .in('work_date', dates),
    // An open day the employee has ALREADY filed for is waiting on a decision, not on them —
    // the UI must not nag them to file it twice.
    service
      .from('hr_attendance_requests')
      .select('id, business_date, status, kind')
      .eq('user_id', user.id)
      .in('business_date', dates)
      .in('status', ['pending', 'approved']),
  ]);

  const shiftByDate = new Map<string, { start_time: string; end_time: string; label: string | null }>();
  for (const r of (schedRes.data ?? []) as { work_date: string; shift: unknown }[]) {
    const sh = (Array.isArray(r.shift) ? r.shift[0] : r.shift) as
      | { start_time: string; end_time: string; label: string | null }
      | null;
    if (sh) shiftByDate.set(r.work_date, sh);
  }
  const reqByDate = new Map<string, { id: string; status: string }>();
  for (const r of (reqRes.data ?? []) as { id: string; business_date: string; status: string }[]) {
    reqByDate.set(r.business_date, { id: r.id, status: r.status });
  }

  return NextResponse.json({
    data: open.map((d) => {
      const shift = shiftByDate.get(d.business_date) ?? null;
      return {
        business_date: d.business_date,
        attendance_id: d.attendance_id,
        in_ts: d.in_ts,
        // Pre-fill: the shift's scheduled end is the closest thing to "when you actually left"
        // that the system knows. null when the day had no rostered shift — the employee types it.
        // Resolved against the check-in, not pasted onto the date: a shift ending at 02:00 finishes
        // in the small hours of the NEXT calendar day, and one ending at 10:00 finishes the next
        // MORNING — suggesting either on the business date itself would propose an out BEFORE the
        // evening's own check-in.
        suggested_out_ts: shift
          ? closingInstantAfter(d.business_date, shift.end_time, d.in_ts)
          : null,
        // For "ลืมเช็คอิน — that check-in was my check-out": the shift's start on the business date
        // is the sensible default for when they really arrived.
        suggested_in_ts: shift ? shiftStartInstant(d.business_date, shift.start_time) : null,
        shift_label: shift?.label ?? null,
        existing_request: reqByDate.get(d.business_date) ?? null,
      };
    }),
  });
}
