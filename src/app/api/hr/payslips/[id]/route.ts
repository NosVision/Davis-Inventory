import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { svPeriodMonth } from '@/lib/hr/pay-cycle';

// GET /api/hr/payslips/[id] — one payslip with its itemized earning + deduction lines.
// Readable by the employee it belongs to (own slip), by company-wide HR, or by a manager scoped
// to the payrun's store (§P5.5). Auth-any at the edge; ownership/scope is enforced explicitly so
// the ESS slip view can reuse this endpoint.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: slip, error: slErr } = await service
    .from('hr_payslips')
    .select('id, payrun_id, user_id, employee_id, rate_satang, pay_type, tax_mode, worked_days, gross_satang, sso_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('id', id)
    .maybeSingle();
  if (slErr) return NextResponse.json({ error: 'Failed to load payslip' }, { status: 500 });
  if (!slip) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 });

  // Ownership/scope gate: an employee sees only their own; otherwise the caller must be HR for the
  // payrun's store (company-wide HR, or a manager scoped to a store-scoped payrun's store).
  // isHrViewer distinguishes the two paths: HR-internal fields (the register remark) are stripped
  // from the employee's own ESS view.
  const isHrViewer = slip.user_id !== user.id;
  if (isHrViewer) {
    const { data: pr } = await service.from('hr_payruns').select('store_id').eq('id', slip.payrun_id).maybeSingle();
    const auth = await requireHrManagerForStore((pr?.store_id as string | null | undefined) ?? null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [earnRes, dedRes, payrunRes, profRes, ovrRes, empRes, bonusRes, remarkRes] = await Promise.all([
    service.from('hr_payslip_earnings').select('type, label, amount_satang, ref, sort').eq('payslip_id', id).order('sort'),
    service.from('hr_payslip_deductions').select('type, label, amount_satang, reason, ref, sort').eq('payslip_id', id).order('sort'),
    service.from('hr_payruns').select('id, company_id, period_year, period_month, cycle_start, cycle_end, pay_date, status, company:hr_companies(name, address, day_divisor)').eq('id', slip.payrun_id).maybeSingle(),
    service.from('profiles').select('username, display_name').eq('id', slip.user_id).maybeSingle(),
    service.from('hr_payslip_tax_overrides').select('tax_satang, note, set_via, updated_at').eq('payrun_id', slip.payrun_id).eq('profile_id', slip.user_id).maybeSingle(),
    // slip-form print header fields (§ dot-matrix form): code / formal name / bank account
    service.from('hr_employees').select('employee_code, full_name, bank_account_no').eq('id', (slip.employee_id as string) ?? '00000000-0000-0000-0000-000000000000').maybeSingle(),
    // HR one-time bonus for this (payrun, profile) — pre-fills the bonus box
    service.from('hr_payslip_bonuses').select('amount_satang, label').eq('payrun_id', slip.payrun_id).eq('profile_id', slip.user_id).maybeSingle(),
    // free-form register remark (legacy Payment file Remark column)
    service.from('hr_payrun_remarks').select('remark').eq('payrun_id', slip.payrun_id).eq('profile_id', slip.user_id).maybeSingle(),
  ]);
  if (earnRes.error || dedRes.error) {
    return NextResponse.json({ error: 'Failed to load payslip lines' }, { status: 500 });
  }

  // Adjustment lines carry ref = hr_payrun_adjustments.id; surface each line's mandatory reason
  // so the slip shows WHO-typed-WHY next to the number (the whole point of the narrowed rule).
  type Line = { type: string; label: string; amount_satang: number; ref?: string | null; reason?: string | null; sort: number };
  let earnLines = (earnRes.data ?? []) as Line[];
  let dedLines = (dedRes.data ?? []) as Line[];
  const adjRefs = [...earnLines, ...dedLines].filter((l) => l.type === 'adjustment' && l.ref).map((l) => l.ref as string);
  if (adjRefs.length > 0) {
    const { data: adjRows } = await service.from('hr_payrun_adjustments').select('id, reason').in('id', adjRefs);
    const reasonById = new Map(((adjRows ?? []) as { id: string; reason: string }[]).map((a) => [a.id, a.reason]));
    const attach = (l: Line): Line =>
      l.type === 'adjustment' && l.ref && reasonById.has(l.ref) ? { ...l, reason: reasonById.get(l.ref) } : l;
    earnLines = earnLines.map(attach);
    dedLines = dedLines.map(attach);
  }

  // Leave lines store the leave TYPE CODE as their label ('personal', 'sick'), because the code is
  // the stable key; the display name lives in hr_leave_types and is per-company and editable. The
  // slip printed the raw code, so a Thai payslip read "ลาไม่รับเงิน (personal)". Resolve the codes
  // actually present into both names and let the renderer pick by locale — done here so the screen
  // and the downloadable PDF cannot drift apart or pay for a second round-trip.
  const leaveCodes = [...new Set(
    dedLines.filter((l) => l.type === 'leave_unpaid' || l.type === 'travel_leave').map((l) => l.label).filter(Boolean)
  )];
  const leaveTypes: Record<string, { name_th: string; name_en: string }> = {};
  if (leaveCodes.length > 0) {
    const companyId = (payrunRes.data as { company_id?: string } | null)?.company_id;
    let q = service.from('hr_leave_types').select('code, name_th, name_en, company_id').in('code', leaveCodes);
    // The company's own types win over a global one of the same code — apply company rows last.
    q = companyId ? q.or(`company_id.eq.${companyId},company_id.is.null`) : q.is('company_id', null);
    const { data: ltRows } = await q;
    for (const r of ((ltRows ?? []) as { code: string; name_th: string; name_en: string; company_id: string | null }[])
      .sort((a, b) => Number(a.company_id !== null) - Number(b.company_id !== null))) {
      leaveTypes[r.code] = { name_th: r.name_th, name_en: r.name_en };
    }
  }

  const emp = empRes.data as { employee_code: string | null; full_name: string | null; bank_account_no: string | null } | null;
  const employeeName = emp?.full_name || profRes.data?.display_name || profRes.data?.username || '—';
  const nickname = profRes.data?.display_name && profRes.data.display_name !== employeeName ? profRes.data.display_name : null;

  // Service Charge (SV) riding on this payslip — the gross allocation, every deduction line (stock
  // penalties, ad-hoc, carry, …), and the resulting net. This is the "หัก Sv" detail HR keeps in the
  // Remark column of their register (owner ask 2026-07-10). SC pools are per store, so a
  // multi-store employee's allocations are summed. Absent → null (no SV on this slip).
  //
  // The pool comes from svPeriodMonth() — the same helper the generator paid into the earnings
  // line, so the panel always explains the money above it. When the two derived the month
  // separately they disagreed, and one slip carried two different SV rounds (report 2026-08-19).
  type SvLine = { source_type: string; label: string | null; amount_satang: number; carry_satang: number; note: string | null; auto: boolean };
  let serviceCharge: {
    period_month: string;
    pay_date: string | null;
    allocated_satang: number;
    deducted_satang: number;
    net_satang: number;
    deductions: SvLine[];
  } | null = null;
  const pr = payrunRes.data as { period_year?: number; period_month?: number } | null;
  if (pr?.period_year && pr?.period_month) {
    const periodMonth = svPeriodMonth(pr.period_year, pr.period_month);
    const { data: allocs } = await service
      .from('hr_sc_allocations')
      .select('allocated_satang, pool:hr_sc_pools!inner(period_month, pay_date), hr_sc_deductions(source_type, label, amount_satang, carry_satang, note, auto)')
      .eq('user_id', slip.user_id)
      .eq('pool.period_month', periodMonth);
    const rows = (allocs ?? []) as unknown as {
      allocated_satang: number;
      pool: { period_month: string; pay_date: string | null };
      hr_sc_deductions: SvLine[];
    }[];
    if (rows.length) {
      let allocated = 0;
      let deducted = 0;
      const lines: SvLine[] = [];
      for (const a of rows) {
        allocated += Number(a.allocated_satang) || 0;
        for (const d of a.hr_sc_deductions ?? []) {
          deducted += Math.max(0, Number(d.amount_satang) || 0);
          lines.push({
            source_type: d.source_type,
            label: d.label,
            amount_satang: Number(d.amount_satang) || 0,
            carry_satang: Number(d.carry_satang) || 0,
            note: d.note,
            auto: !!d.auto,
          });
        }
      }
      serviceCharge = {
        period_month: periodMonth,
        pay_date: rows[0]?.pool?.pay_date ?? null,
        allocated_satang: allocated,
        deducted_satang: deducted,
        net_satang: Math.max(0, allocated - deducted),
        deductions: lines,
      };
    }
  }

  return NextResponse.json({
    data: {
      payslip: {
        ...slip,
        employee_name: employeeName,
        employee_code: emp?.employee_code ?? null,
        nickname,
        bank_account_no: emp?.bank_account_no ?? null,
      },
      payrun: payrunRes.data ?? null,
      earnings: earnLines,
      deductions: dedLines,
      // official figure from the accounting office (null = engine estimate is in effect)
      tax_override: ovrRes.data ?? null,
      // HR one-time bonus for this payrun (null = none)
      bonus: bonusRes.data ?? null,
      // Service Charge (SV) detail for the month (null = none)
      service_charge: serviceCharge,
      // leave-type code → display names, for the leave lines on this slip
      leave_types: leaveTypes,
      // free-form register remark — HR-internal annotation, never shown to the slip's own
      // employee (an HR note like "หัก SV 100%" is register context, not employee-facing text)
      remark: isHrViewer ? ((remarkRes.data?.remark as string | undefined) ?? null) : null,
    },
  });
}
