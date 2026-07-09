import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { issueSopWarning } from '@/lib/stock/sop-warning';
import {
  weekKeyMonday,
  fineForWeekSeq,
  DEFAULT_FINE_TIERS,
  DEFAULT_WARNING_THRESHOLD,
} from '@/lib/stock/penalty-engine';

// POST /api/stock/penalties — create a stock-SOP penalty and run the "two-clock" engine
// (owner ask 2026-07-09). See docs/hr/stock-penalty-to-hr.md. This replaces the old direct
// client insert so the money/discipline rules are enforced server-side:
//   • A-02 fine escalates weekly (Mon–Sun) per store occurrence: 1st free, 2nd 300, 3rd 500.
//   • A-03/M-01 deduct immediately (code default / provided cost).
//   • Group targets (bar_all / staff_all) expand to whoever was ON SHIFT the counted business
//     date (from hr_schedule), falling back to all of that role at the store.
//   • Every non-EXP-01 penalty counts toward the store's monthly SOP total; crossing the
//     threshold (default 7) alerts HQ and — in Auto mode — issues a warning to the head_bar.
// SV money is applied later on the HR side; penalties are created as status 'pending'.

const REVIEW_ROLES = ['owner', 'accountant', 'manager', 'hq'];
const GROUP_STAFF_ALL = '__group:staff_all__';
const GROUP_BAR_ALL = '__group:bar_all__';

async function readSetting<T>(service: ReturnType<typeof createServiceClient>, key: string, fallback: T): Promise<T> {
  const { data } = await service.from('hr_policy_settings').select('value').eq('key', key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return (v === undefined || v === null ? fallback : (v as T));
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: me } = await service.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const myRole = (me as { role?: string } | null)?.role;
  if (!myRole || !REVIEW_ROLES.includes(myRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  const codeStr = typeof body.code === 'string' ? body.code : '';
  const target = typeof body.staff_id === 'string' ? body.staff_id : '';
  const comparisonId = typeof body.comparison_id === 'string' ? body.comparison_id : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  const amountOverride =
    body.amount === null || body.amount === undefined || body.amount === '' ? null : Number(body.amount);
  if (!storeId || !codeStr || !target) {
    return NextResponse.json({ error: 'store_id, code, staff_id required' }, { status: 400 });
  }

  // Penalty-code metadata (SOP taxonomy).
  const { data: code } = await service
    .from('penalty_codes')
    .select('code, label, level, default_amount, included_in_quota')
    .eq('code', codeStr)
    .maybeSingle();
  if (!code) return NextResponse.json({ error: 'Unknown penalty code' }, { status: 400 });
  const codeMeta = code as {
    code: string;
    label: string;
    level: string;
    default_amount: number | null;
    included_in_quota: boolean;
  };

  // Business date being audited = the comparison's comp_date, else provided/today.
  let businessDate = typeof body.business_date === 'string' ? body.business_date : '';
  if (comparisonId) {
    const { data: comp } = await service.from('comparisons').select('comp_date').eq('id', comparisonId).maybeSingle();
    const d = (comp as { comp_date?: string } | null)?.comp_date;
    if (d) businessDate = d;
  }
  if (!businessDate) {
    return NextResponse.json({ error: 'business_date required (no comparison to derive from)' }, { status: 400 });
  }
  const monthYear = businessDate.slice(0, 7);
  const weekKey = weekKeyMonday(businessDate);

  // Resolve target staff. Group sentinels → whoever was on shift that business date, from the
  // HR schedule; fall back to all active members of that role at the store.
  let targetStaffIds: string[] = [];
  const groupRoles = target === GROUP_BAR_ALL ? ['bar', 'head_bar'] : target === GROUP_STAFF_ALL ? ['staff'] : null;
  if (groupRoles) {
    const { data: members } = await service
      .from('user_stores')
      .select('user_id, profiles!inner(id, role, active)')
      .eq('store_id', storeId);
    type Row = { profiles: { id: string; role: string; active: boolean } | { id: string; role: string; active: boolean }[] | null };
    const roleMembers = ((members ?? []) as unknown as Row[])
      .flatMap((r) => (Array.isArray(r.profiles) ? r.profiles : r.profiles ? [r.profiles] : []))
      .filter((p) => p.active && groupRoles.includes(p.role))
      .map((p) => p.id);
    // Narrow to those scheduled to work (not day off) on the audited business date, if we have data.
    const { data: sched } = await service
      .from('hr_schedule')
      .select('user_id')
      .eq('store_id', storeId)
      .eq('work_date', businessDate)
      .eq('is_day_off', false)
      .in('user_id', roleMembers.length ? roleMembers : ['00000000-0000-0000-0000-000000000000']);
    const onShift = new Set((sched ?? []).map((s) => (s as { user_id: string }).user_id));
    targetStaffIds = roleMembers.filter((id) => onShift.has(id));
    if (targetStaffIds.length === 0) targetStaffIds = roleMembers; // no schedule → whole role
  } else {
    targetStaffIds = [target];
  }
  if (targetStaffIds.length === 0) {
    return NextResponse.json({ error: 'ไม่มีพนักงานในกลุ่มที่เลือก' }, { status: 400 });
  }

  // ── Money clock ──────────────────────────────────────────────────────────────────────────
  // A-02 escalates weekly per STORE OCCURRENCE (a count-day), not per person: reuse the day's
  // sequence if that day already has an A-02, else it's the next occurrence of the week.
  const tiers = await readSetting<number[]>(service, 'stock_fine_tiers', DEFAULT_FINE_TIERS);
  let weekSeq: number | null = null;
  let amount: number | null = amountOverride;
  if (codeMeta.code === 'A-02' && amountOverride === null) {
    const { data: weekPen } = await service
      .from('penalties')
      .select('business_date, week_seq')
      .eq('store_id', storeId)
      .eq('penalty_code', 'A-02')
      .eq('week_key', weekKey)
      .neq('status', 'cancelled');
    const byDay = new Map<string, number>();
    for (const p of (weekPen ?? []) as { business_date: string | null; week_seq: number | null }[]) {
      if (p.business_date && p.week_seq != null) byDay.set(p.business_date, p.week_seq);
    }
    weekSeq = byDay.has(businessDate) ? (byDay.get(businessDate) as number) : byDay.size + 1;
    amount = fineForWeekSeq(weekSeq, tiers);
  } else if (amountOverride === null) {
    amount = codeMeta.default_amount; // A-03 → 500, M-01 → null (enter cost), notify codes → null
  }

  // ── Insert penalties (one per responsible person, sharing one batch = one SOP occurrence) ──
  const batchId = crypto.randomUUID();
  const rows = targetStaffIds.map((sid) => ({
    store_id: storeId,
    staff_id: sid,
    penalty_code: codeMeta.code,
    comparison_id: comparisonId,
    reason: codeMeta.label,
    amount,
    status: 'pending',
    notes,
    included_in_quota: codeMeta.included_in_quota,
    approved_by: user.id,
    business_date: businessDate,
    week_key: codeMeta.code === 'A-02' ? weekKey : null,
    week_seq: weekSeq,
    month_year: monthYear,
    batch_id: batchId,
  }));
  const { data: created, error } = await service.from('penalties').insert(rows).select('*');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── SOP clock ────────────────────────────────────────────────────────────────────────────
  // After inserting, check the store's monthly SOP total and, on crossing the threshold, alert
  // HQ + (Auto mode) issue a single warning to the head_bar for this store/month.
  const threshold = await readSetting<number>(service, 'stock_warning_threshold', DEFAULT_WARNING_THRESHOLD);
  const autoHr = await readSetting<boolean>(service, 'stock_escalation_auto_hr', false);
  let sopPoints = 0;
  let warning: { issued: boolean; reason?: string } = { issued: false };
  if (codeMeta.included_in_quota) {
    const { data: cnt } = await service
      .from('v_store_monthly_sop_count')
      .select('points')
      .eq('store_id', storeId)
      .eq('month_year', monthYear)
      .maybeSingle();
    sopPoints = (cnt as { points?: number } | null)?.points ?? 0;

    if (sopPoints >= threshold) {
      warning = await issueSopWarning(service, {
        storeId,
        monthYear,
        sopPoints,
        issuedBy: user.id,
        issueWarning: autoHr,
      });
    }
  }

  return NextResponse.json({
    created: created ?? [],
    week_seq: weekSeq,
    amount,
    business_date: businessDate,
    sop_points: sopPoints,
    threshold,
    warning,
  });
}
