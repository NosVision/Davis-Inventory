import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { todayBangkok } from '@/lib/utils/date';

// GET /api/hr/ess/leaves/summary — the caller's OWN leave quota/usage for the current
// Bangkok year (self only; any logged-in user). Effective quota per type = the employee's
// hr_leave_balances override for this year ?? the type's annual_quota_days (null = unlimited).
// `monthly` is total approved leave days per month across ALL types (index 0 = January).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .select('id, company_id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (empErr) return NextResponse.json({ error: 'Failed to load employee' }, { status: 500 });
  // Not a registered employee (or no company) → nothing to summarise.
  if (!emp || !emp.company_id) return NextResponse.json({ data: null });

  const year = Number(todayBangkok().slice(0, 4));

  const [typesRes, balancesRes, usedRes] = await Promise.all([
    service
      .from('hr_leave_types')
      .select('id, code, name_th, name_en, annual_quota_days')
      .eq('active', true)
      .or(`company_id.is.null,company_id.eq.${emp.company_id}`)
      .order('sort_order', { ascending: true }),
    service
      .from('hr_leave_balances')
      .select('leave_type_id, quota_days')
      .eq('employee_id', emp.id as string)
      .eq('year', year),
    service
      .from('hr_leaves')
      .select('leave_type_id, from_date, days')
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .gte('from_date', `${year}-01-01`)
      .lte('from_date', `${year}-12-31`),
  ]);
  if (typesRes.error || balancesRes.error || usedRes.error) {
    return NextResponse.json({ error: 'Failed to load leave summary' }, { status: 500 });
  }

  const balanceByType = new Map<string, number>(
    (balancesRes.data ?? []).map((b) => [b.leave_type_id as string, Number(b.quota_days)])
  );

  const usedByType = new Map<string, number>();
  const monthly = Array.from({ length: 12 }, () => 0);
  for (const row of usedRes.data ?? []) {
    const days = Number(row.days ?? 0);
    const typeId = row.leave_type_id as string;
    usedByType.set(typeId, Math.round(((usedByType.get(typeId) ?? 0) + days) * 10) / 10);
    const month = Number(String(row.from_date).slice(5, 7));
    if (month >= 1 && month <= 12) {
      monthly[month - 1] = Math.round((monthly[month - 1] + days) * 10) / 10;
    }
  }

  const types = (typesRes.data ?? []).map((t) => {
    const override = balanceByType.get(t.id as string);
    const quota =
      override ?? (t.annual_quota_days == null ? null : Number(t.annual_quota_days));
    const used = usedByType.get(t.id as string) ?? 0;
    return {
      id: t.id as string,
      code: t.code as string,
      name_th: t.name_th as string,
      name_en: t.name_en as string,
      quota,
      used,
      remaining: quota == null ? null : Math.round((quota - used) * 10) / 10,
    };
  });

  return NextResponse.json({ data: { year, types, monthly } });
}
