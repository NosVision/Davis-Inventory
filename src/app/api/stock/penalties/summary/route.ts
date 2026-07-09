import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_WARNING_THRESHOLD } from '@/lib/stock/penalty-engine';

// GET /api/stock/penalties/summary?store_id=…&month=YYYY-MM
// Read-only rollup for the HQ stock-penalty surface (owner ask 2026-07-09):
//   • sop_points   — this store's monthly SOP total (v_store_monthly_sop_count.points)
//   • threshold    — hr_policy_settings 'stock_warning_threshold' (default 7)
//   • auto_hr      — hr_policy_settings 'stock_escalation_auto_hr' (default false)
//   • week_summary — this month's A-02 occurrences grouped by ISO week (distinct count-days)
//   • recent       — the 50 most-recent penalties for the store/month, with staff_name resolved
// Visible to the same review roles as the owner-review page (no mutation happens here).

const REVIEW_ROLES = ['owner', 'accountant', 'manager', 'hq'];

async function readSetting<T>(service: ReturnType<typeof createServiceClient>, key: string, fallback: T): Promise<T> {
  const { data } = await service.from('hr_policy_settings').select('value').eq('key', key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return v === undefined || v === null ? fallback : (v as T);
}

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('store_id') ?? '';
  const month = searchParams.get('month') ?? '';
  if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'store_id and month (YYYY-MM) are required' }, { status: 400 });
  }

  // SOP points for the store/month (view already excludes EXP-01 and cancelled rows).
  const { data: cnt } = await service
    .from('v_store_monthly_sop_count')
    .select('points')
    .eq('store_id', storeId)
    .eq('month_year', month)
    .maybeSingle();
  const sopPoints = (cnt as { points?: number } | null)?.points ?? 0;

  const threshold = await readSetting<number>(service, 'stock_warning_threshold', DEFAULT_WARNING_THRESHOLD);
  const autoHr = await readSetting<boolean>(service, 'stock_escalation_auto_hr', false);

  // Weekly A-02 occurrences: DISTINCT business_date per week_key (matches the money-clock count).
  const { data: a02 } = await service
    .from('penalties')
    .select('week_key, business_date')
    .eq('store_id', storeId)
    .eq('month_year', month)
    .eq('penalty_code', 'A-02')
    .neq('status', 'cancelled');
  const daysByWeek = new Map<string, Set<string>>();
  for (const p of (a02 ?? []) as { week_key: string | null; business_date: string | null }[]) {
    if (!p.week_key) continue;
    const set = daysByWeek.get(p.week_key) ?? new Set<string>();
    if (p.business_date) set.add(p.business_date);
    daysByWeek.set(p.week_key, set);
  }
  const weekSummary = [...daysByWeek.entries()]
    .map(([week_key, dates]) => ({ week_key, occurrences: dates.size }))
    .sort((a, b) => a.week_key.localeCompare(b.week_key));

  // Recent penalties for the store/month + staff_name (display_name || username).
  const { data: recentRows } = await service
    .from('penalties')
    .select('*')
    .eq('store_id', storeId)
    .eq('month_year', month)
    .order('created_at', { ascending: false })
    .limit(50);
  const recentList = (recentRows ?? []) as Array<Record<string, unknown> & { staff_id: string }>;

  const staffIds = [...new Set(recentList.map((p) => p.staff_id).filter(Boolean))];
  const nameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: profiles } = await service
      .from('profiles')
      .select('id, username, display_name')
      .in('id', staffIds);
    for (const p of (profiles ?? []) as { id: string; username: string | null; display_name: string | null }[]) {
      nameById.set(p.id, p.display_name || p.username || '—');
    }
  }
  const recent = recentList.map((p) => ({ ...p, staff_name: nameById.get(p.staff_id) ?? '—' }));

  return NextResponse.json({
    sop_points: sopPoints,
    threshold,
    auto_hr: autoHr,
    week_summary: weekSummary,
    recent,
  });
}
