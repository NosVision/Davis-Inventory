import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET /api/hr/ess/eval/my-periods — OPEN evaluation periods in which the caller is an evaluator
// (§G: an evaluator only scores while a period is open). Auth-any, strictly self-scoped by
// evaluator_id. Returns each period with the caller's total/done/pending assignment counts so the
// /me evaluations landing can show a "you have N people left to score" queue picker.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // The caller's own assignments (any status) → distinct period ids.
  const { data: aRows, error } = await service
    .from('hr_eval_assignments')
    .select('period_id, status')
    .eq('evaluator_id', user.id);
  if (error) return NextResponse.json({ error: 'Failed to load periods' }, { status: 500 });

  const assignments = (aRows ?? []) as { period_id: string; status: string }[];
  if (assignments.length === 0) return NextResponse.json({ data: [] });

  const periodIds = [...new Set(assignments.map((a) => a.period_id))];
  // Only OPEN periods are scoreable.
  const { data: pRows } = await service
    .from('hr_eval_periods')
    .select('id, title, period_month, status, max_score')
    .in('id', periodIds)
    .eq('status', 'open');
  const periods = (pRows ?? []) as { id: string; title: string; period_month: string; status: string; max_score: number }[];
  if (periods.length === 0) return NextResponse.json({ data: [] });

  const openIds = new Set(periods.map((p) => p.id));
  const countsByPeriod = new Map<string, { total: number; done: number }>();
  for (const a of assignments) {
    if (!openIds.has(a.period_id)) continue;
    const c = countsByPeriod.get(a.period_id) ?? { total: 0, done: 0 };
    c.total += 1;
    if (a.status === 'submitted') c.done += 1;
    countsByPeriod.set(a.period_id, c);
  }

  const out = periods
    .map((p) => {
      const c = countsByPeriod.get(p.id) ?? { total: 0, done: 0 };
      return {
        id: p.id,
        title: p.title,
        period_month: p.period_month,
        max_score: p.max_score,
        total: c.total,
        done: c.done,
        pending: c.total - c.done,
      };
    })
    .sort((a, b) => String(b.period_month).localeCompare(String(a.period_month)));

  return NextResponse.json({ data: out });
}
