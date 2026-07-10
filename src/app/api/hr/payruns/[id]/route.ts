import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
}

// GET /api/hr/payruns/[id] — a payrun with its per-employee payslip summaries (HR only).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, cycle_start, cycle_end, pay_date, status, finalized_at, note, announced_at')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });

  // §P5.5: a store-scoped payrun is reachable by a manager of that store; company-wide (NULL) is full-HR only.
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: slips, error: slErr } = await service
    .from('hr_payslips')
    .select('id, user_id, employee_id, rate_satang, pay_type, tax_mode, worked_days, gross_satang, sso_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('payrun_id', id);
  if (slErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });

  const slipRows = slips ?? [];
  const userIds = [...new Set(slipRows.map((s) => s.user_id))];
  const pr = payrun as { period_year: number; period_month: number };
  const periodMonth = `${pr.period_year}-${String(pr.period_month).padStart(2, '0')}-01`;

  // Names (prefer the real full name), Service-Charge net + SV-deductions for the month, and the
  // accountant review link's status (powers the status stepper + the finalize gate).
  const [profsRes, empsRes, scRes, linkRes] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    service.from('hr_employees').select('profile_id, full_name').in('profile_id', userIds),
    service
      .from('hr_sc_allocations')
      .select('user_id, allocated_satang, pool:hr_sc_pools!inner(period_month), hr_sc_deductions(amount_satang)')
      .eq('pool.period_month', periodMonth)
      .in('user_id', userIds),
    service
      .from('hr_payrun_review_links')
      .select('created_at, expires_at, accessed_at, saved_at, confirmed_at')
      .eq('payrun_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const nameById = new Map<string, string>();
  for (const p of (profsRes.data ?? []) as ProfileRow[]) nameById.set(p.id, p.display_name || p.username || '—');
  const fullNameById = new Map<string, string>();
  for (const e of (empsRes.data ?? []) as { profile_id: string; full_name: string | null }[]) {
    if (e.full_name?.trim()) fullNameById.set(e.profile_id, e.full_name.trim());
  }
  const scByUser = new Map<string, { net: number; deducted: number }>();
  for (const a of (scRes.data ?? []) as { user_id: string; allocated_satang: number; hr_sc_deductions: { amount_satang: number }[] }[]) {
    const ded = (a.hr_sc_deductions ?? []).reduce((s, d) => s + Math.max(0, Number(d.amount_satang) || 0), 0);
    const alloc = Number(a.allocated_satang) || 0;
    const cur = scByUser.get(a.user_id) ?? { net: 0, deducted: 0 };
    scByUser.set(a.user_id, { net: cur.net + Math.max(0, alloc - ded), deducted: cur.deducted + ded });
  }

  const payslips = slipRows
    .map((s) => {
      const sc = scByUser.get(s.user_id);
      return {
        ...s,
        name: fullNameById.get(s.user_id) || nameById.get(s.user_id) || '—',
        sc_net_satang: sc?.net ?? 0,
        sv_deduct_satang: sc?.deducted ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const totals = payslips.reduce(
    (acc, s) => ({
      gross: acc.gross + s.gross_satang,
      net: acc.net + s.net_satang,
      sso: acc.sso + s.sso_satang,
      tax: acc.tax + s.tax_satang,
      sc_net: acc.sc_net + s.sc_net_satang,
      sv_deduct: acc.sv_deduct + s.sv_deduct_satang,
    }),
    { gross: 0, net: 0, sso: 0, tax: 0, sc_net: 0, sv_deduct: 0 }
  );

  const review = linkRes.data
    ? {
        created_at: linkRes.data.created_at as string,
        expires_at: linkRes.data.expires_at as string,
        accessed_at: (linkRes.data.accessed_at as string | null) ?? null,
        saved_at: (linkRes.data.saved_at as string | null) ?? null,
        confirmed_at: (linkRes.data.confirmed_at as string | null) ?? null,
      }
    : null;

  return NextResponse.json({ data: { payrun, payslips, totals, review } });
}
