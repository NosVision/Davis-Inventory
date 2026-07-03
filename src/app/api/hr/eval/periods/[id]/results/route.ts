import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';

const RESULTS = 'hr_eval_results';

// GET /api/hr/eval/periods/[id]/results — all per-employee results for a period (HR view),
// with the employee's display name and the computed payout (if any) joined. Read-only.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const service = createServiceClient();

  const { data: rows, error } = await service
    .from(RESULTS)
    .select('id, employee_id, evaluator_count, raw_score_avg, max_score, score_pct, status, computed_at')
    .eq('period_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = (rows ?? []) as {
    id: string; employee_id: string; evaluator_count: number; raw_score_avg: number;
    max_score: number; score_pct: number | null; status: string; computed_at: string | null;
  }[];
  if (results.length === 0) return NextResponse.json({ data: [] });

  // Join names + latest payout amount per result.
  const employeeIds = [...new Set(results.map((r) => r.employee_id))];
  const resultIds = results.map((r) => r.id);
  const [{ data: profs }, { data: payouts }] = await Promise.all([
    service.from('profiles').select('id, display_name, username').in('id', employeeIds),
    service.from('hr_eval_payouts').select('result_id, amount_satang, status').in('result_id', resultIds),
  ]);
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, (p.display_name || p.username || '—') as string]));
  const payoutByResult = new Map(
    (payouts ?? []).map((p) => [p.result_id as string, { amount_satang: p.amount_satang as number, status: p.status as string }]),
  );

  const out = results
    .map((r) => ({
      ...r,
      employee_name: nameById.get(r.employee_id) ?? '—',
      payout: payoutByResult.get(r.id) ?? null,
    }))
    .sort((a, b) => (b.score_pct ?? -1) - (a.score_pct ?? -1));

  return NextResponse.json({ data: out });
}
