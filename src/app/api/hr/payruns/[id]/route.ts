import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { callerCanViewConfidentialPay, confidentialProfileIds } from '@/lib/hr/pay-visibility';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { buildPayrunReviewRows } from '@/lib/hr/review-link';
import { loadWorkVenues } from '@/lib/hr/work-venues';
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
  // The SV/tip pool that belongs to this run is the PREVIOUS month (svPeriodMonth) — the one the
  // generator actually paid into these payslips. This used to read the run's own month, so the
  // register's SV column and the readiness chips described a round nobody on this run was paid.
  const periodMonth = svPeriodMonth(pr.period_year, pr.period_month);

  // Names (prefer the real full name), Service-Charge net + SV-deductions for the month, and the
  // accountant review link's status (powers the status stepper + the finalize gate).
  // reviewRows adds the money split (salary/OT/allowance/other-deduction) the register renders —
  // the same aggregation the accountant portal shows, finally visible to HR (redesign 2026-07-14).
  const [profsRes, empsRes, scRes, linkRes, scPoolsRes, tipPoolsRes, reviewRows, remarksRes, storeLinksRes] = await Promise.all([
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
    // Venue lookup for the register's per-store breakdown. A payrun is company-scoped while the
    // timesheet is store-scoped, so HR had no way to read a run venue by venue (owner ask
    // 2026-08-17). NOTE the breakdown attributes people by where they actually WORKED in the cycle,
    // not by this membership list — see the storesByUser build below.
    service.from('user_stores').select('user_id, store:stores(store_code, store_name)').in('user_id', userIds),
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
  // profile → the venues this payslip is attributed to.
  //
  // Membership alone was wrong: `user_stores` can mean "oversees this venue" (its meaning in the
  // deposit module it came from), so the accounting team — members of five venues, rostered at one —
  // was counted into five venues' subtotals (owner report 2026-08-17). Attribution therefore follows
  // evidence of work inside THIS cycle: a roster row or a kept punch at that venue. A member with no
  // evidence anywhere in the cycle is attributed to no venue and lands in the breakdown's
  // no-venue bucket, which is the honest answer — their pay cannot be pinned to a place.
  //
  // Multi-venue staff who genuinely worked two venues still appear under both, and the panel says so.
  const nameByStoreId = new Map<string, { code: string; name: string }>();
  const membershipByUser = new Map<string, string[]>();
  for (const l of (storeLinksRes.data ?? []) as unknown as {
    user_id: string;
    store_id?: string;
    store: { store_code: string | null; store_name: string | null } | null;
  }[]) {
    if (!l.store?.store_code) continue;
    membershipByUser.set(l.user_id, [...(membershipByUser.get(l.user_id) ?? []), l.store.store_code]);
    nameByStoreId.set(l.store.store_code, {
      code: l.store.store_code,
      name: l.store.store_name || l.store.store_code,
    });
  }

  const cycle = payrun as { cycle_start: string; cycle_end: string };
  const storesByUser = new Map<string, { code: string; name: string }[]>();
  try {
    const worked = await loadWorkVenues(service, cycle.cycle_start, cycle.cycle_end);
    // hr_work_venues returns store IDs; map them to the codes the breakdown labels with.
    const { data: storeRows } = await service.from('stores').select('id, store_code, store_name');
    const byId = new Map(
      ((storeRows ?? []) as { id: string; store_code: string; store_name: string | null }[]).map((s) => [
        s.id,
        { code: s.store_code, name: s.store_name || s.store_code },
      ])
    );
    for (const uid of userIds) {
      const ids = worked.get(uid);
      if (!ids || ids.size === 0) continue; // → no-venue bucket
      const list = [...ids].map((id) => byId.get(id)).filter((s): s is { code: string; name: string } => !!s);
      if (list.length) storesByUser.set(uid, list);
    }
  } catch {
    // Evidence unavailable → fall back to membership, which is what this panel shipped with. Its
    // double-count warning already explains an over-count; showing nothing would explain nothing.
    for (const [uid, codes] of membershipByUser) {
      const list = codes.map((c) => nameByStoreId.get(c)).filter((s): s is { code: string; name: string } => !!s);
      if (list.length) storesByUser.set(uid, list);
    }
  }

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
        stores: storesByUser.get(s.user_id) ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Drop the slips this caller may not see the pay of. Totals are computed from what remains, NOT
  // from the full run — a complete total beside a partial list is a subtraction away from the
  // figures being hidden. The response says how many are missing so the page can label itself.
  const canSeeAll = await callerCanViewConfidentialPay(service, auth.userId);
  const confidential = canSeeAll ? new Set<string>() : await confidentialProfileIds(service);
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
    },
  });
}
