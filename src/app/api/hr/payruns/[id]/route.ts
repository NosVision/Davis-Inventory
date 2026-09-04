import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { callerCanViewConfidentialPay, payHiddenProfileIds } from '@/lib/hr/pay-visibility';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { buildPayrunReviewRows } from '@/lib/hr/review-link';
import { svPeriodMonth } from '@/lib/hr/pay-cycle';

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
  // The SV/tip pool for this run — svPeriodMonth(), the same helper the generator used, so the
  // register's SV column and the readiness chips always describe the round these payslips paid.
  const periodMonth = svPeriodMonth(pr.period_year, pr.period_month);

  // Names (prefer the real full name), Service-Charge net + SV-deductions for the month, and the
  // accountant review link's status (powers the status stepper + the finalize gate).
  // reviewRows adds the money split (salary/OT/allowance/other-deduction) the register renders —
  // the same aggregation the accountant portal shows, finally visible to HR (redesign 2026-07-14).
  const [profsRes, empsRes, scRes, linkRes, scPoolsRes, tipPoolsRes, reviewRows, remarksRes] = await Promise.all([
    service.from('profiles').select('id, username, display_name').in('id', userIds),
    service.from('hr_employees').select('profile_id, full_name, start_date, end_date, position:hr_positions(name)').in('profile_id', userIds),
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
    // SC + tip pool readiness for the month (feeds the "จัดสรร SC/ทิป" strip on the payroll page).
    service.from('hr_sc_pools').select('status, store_id').eq('period_month', periodMonth),
    service.from('hr_tip_pools').select('status, store_id').eq('period_month', periodMonth),
    buildPayrunReviewRows(service, id),
    service.from('hr_payrun_remarks').select('profile_id, remark').eq('payrun_id', id),
  ]);

  const nameById = new Map<string, string>();
  for (const p of (profsRes.data ?? []) as ProfileRow[]) nameById.set(p.id, p.display_name || p.username || '—');
  const fullNameById = new Map<string, string>();
  const positionById = new Map<string, string>();
  const startDateById = new Map<string, string>();
  const endDateById = new Map<string, string>();
  for (const e of (empsRes.data ?? []) as unknown as { profile_id: string; full_name: string | null; start_date: string | null; end_date: string | null; position: { name: string | null } | null }[]) {
    if (e.full_name?.trim()) fullNameById.set(e.profile_id, e.full_name.trim());
    if (e.position?.name) positionById.set(e.profile_id, e.position.name);
    if (e.start_date) startDateById.set(e.profile_id, e.start_date);
    if (e.end_date) endDateById.set(e.profile_id, e.end_date);
  }
  // No venue attribution here, by design (owner ask 2026-09-04). A payrun is generated per
  // (company × payroll group); a venue for a payslip could only ever be INFERRED, and every way of
  // inferring it was wrong for the same people. `user_stores` membership put the accounting team —
  // members of five venues, working one — into five venues' subtotals (owner report 2026-08-17);
  // replacing it with roster/punch evidence then filed two of them under the venue they were
  // scheduled at and dropped the two who never punch into a no-venue bucket, so they read as
  // missing from their own team (owner report 2026-09-04). Venues are read on the timesheet, which
  // is store-scoped for real. Money is read by company.
  const reviewBySlip = new Map((reviewRows ?? []).map((r) => [r.payslip_id, r]));
  const remarkByUser = new Map<string, string>(
    ((remarksRes.data ?? []) as { profile_id: string; remark: string }[]).map((r) => [r.profile_id, r.remark])
  );
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
      const rr = reviewBySlip.get(s.id as string);
      return {
        ...s,
        name: fullNameById.get(s.user_id) || nameById.get(s.user_id) || '—',
        // the app nickname (profiles.display_name) — shown alongside the payroll full name so HR
        // can tie the slip to the person they know in chat/schedule (client ask 2026-07-21)
        nickname: nameById.get(s.user_id) ?? null,
        position: positionById.get(s.user_id) ?? null,
        start_date: startDateById.get(s.user_id) ?? null,
        end_date: endDateById.get(s.user_id) ?? null,
        employee_code: rr?.employee_code ?? null,
        sc_net_satang: sc?.net ?? 0,
        sv_deduct_satang: sc?.deducted ?? 0,
        // register money split (same aggregation as the accountant portal)
        salary_satang: rr?.salary_satang ?? 0,
        ot_satang: rr?.ot_satang ?? 0,
        allowance_satang: rr?.allowance_satang ?? 0,
        other_ded_satang: rr?.deduction_satang ?? 0,
        has_tax_override: rr?.has_override ?? false,
        remark: remarkByUser.get(s.user_id) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Drop the slips this caller may not see the pay of. Totals are computed from what remains, NOT
  // from the full run — a complete total beside a partial list is a subtraction away from the
  // figures being hidden. The response says how many are missing so the page can label itself.
  const canSeeAll = await callerCanViewConfidentialPay(service, auth.userId);
  const confidential = canSeeAll ? new Set<string>() : await payHiddenProfileIds(service, auth.userId);
  const hiddenCount = canSeeAll ? 0 : payslips.filter((s) => confidential.has(s.user_id)).length;
  const visibleSlips = canSeeAll ? payslips : payslips.filter((s) => !confidential.has(s.user_id));

  const totals = visibleSlips.reduce(
    (acc, s) => ({
      gross: acc.gross + s.gross_satang,
      net: acc.net + s.net_satang,
      sso: acc.sso + s.sso_satang,
      tax: acc.tax + s.tax_satang,
      sc_net: acc.sc_net + s.sc_net_satang,
      sv_deduct: acc.sv_deduct + s.sv_deduct_satang,
      salary: acc.salary + s.salary_satang,
      ot: acc.ot + s.ot_satang,
      allowance: acc.allowance + s.allowance_satang,
      other_ded: acc.other_ded + s.other_ded_satang,
    }),
    { gross: 0, net: 0, sso: 0, tax: 0, sc_net: 0, sv_deduct: 0, salary: 0, ot: 0, allowance: 0, other_ded: 0 }
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

  // SC/tip pool readiness for the month. A store-scoped payrun looks only at its own store's
  // pools; a company-wide run summarises every store's pools for the month.
  const payrunStoreId = (payrun as { store_id: string | null }).store_id ?? null;
  const summarizePools = (rows: { status: string; store_id: string | null }[] | null | undefined) => {
    const scoped = (rows ?? []).filter((r) => !payrunStoreId || r.store_id === payrunStoreId);
    return { total: scoped.length, finalized: scoped.filter((r) => r.status === 'finalized').length };
  };
  const pools = {
    month: periodMonth,
    sc: summarizePools(scPoolsRes.data as { status: string; store_id: string | null }[] | null),
    tip: summarizePools(tipPoolsRes.data as { status: string; store_id: string | null }[] | null),
  };

  return NextResponse.json({
    data: {
      payrun,
      payslips: visibleSlips,
      totals,
      review,
      pools,
      // > 0 → the page must say the figures are partial, or the reader will take the total as the
      // payrun's real total.
      hidden_count: hiddenCount,
      // Every action on a payrun (export, adjust, finalize, announce, reopen, print) reaches every
      // slip in it, so one hidden person disables the lot. Sent so the buttons can say why up
      // front instead of each one 403-ing when pressed.
      can_manage: hiddenCount === 0,
    },
  });
}
