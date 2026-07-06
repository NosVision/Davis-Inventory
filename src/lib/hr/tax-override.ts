import type { SupabaseClient } from '@supabase/supabase-js';
import { logHrAudit } from '@/lib/hr/audit';

// Apply the accounting office's official tax figure to ONE payslip (owner plan 2026-07-06).
// Two write paths share this: the accountant review link (set_via 'link') and the HR fallback
// (set_via 'hr'). It upserts the (payrun, profile) override — so a draft regenerate re-applies
// it via the engine — AND patches the persisted slip surgically so the numbers change without
// a full rebuild: tax line replaced, total_deduction/net re-derived from the stored gross.
// Draft payruns only; a finalized period is immutable (reopen first, as with every other edit).

export interface ApplyTaxOverrideParams {
  payslipId: string;
  taxSatang: number;
  note?: string | null;
  setVia: 'hr' | 'link';
  /** the acting profile for audit; for 'link' pass the HR user who issued the link */
  actorId: string;
  /** stored on the override row; null for the anonymous accountant link */
  setBy: string | null;
}

export type ApplyTaxOverrideResult =
  | { ok: true; payslip: { id: string; tax_satang: number; total_deduction_satang: number; net_satang: number } }
  | { ok: false; status: number; error: string };

export async function applyTaxOverride(
  service: SupabaseClient,
  params: ApplyTaxOverrideParams
): Promise<ApplyTaxOverrideResult> {
  const taxSatang = Math.round(params.taxSatang);
  if (!Number.isFinite(taxSatang) || taxSatang < 0 || taxSatang > 100_000_000_00) {
    return { ok: false, status: 400, error: 'tax_satang out of range' };
  }

  const { data: slip, error: slipErr } = await service
    .from('hr_payslips')
    .select('id, payrun_id, user_id, gross_satang, tax_satang, total_deduction_satang, net_satang')
    .eq('id', params.payslipId)
    .maybeSingle();
  if (slipErr) return { ok: false, status: 500, error: 'Failed to load payslip' };
  if (!slip) return { ok: false, status: 404, error: 'Payslip not found' };

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, status')
    .eq('id', slip.payrun_id)
    .maybeSingle();
  if (prErr || !payrun) return { ok: false, status: 500, error: 'Failed to load payrun' };
  if (payrun.status !== 'draft') {
    return { ok: false, status: 409, error: 'Payrun is finalized — reopen it before changing tax' };
  }

  // 1) durable override — survives draft regenerates (the engine reads it back in).
  const { error: upErr } = await service
    .from('hr_payslip_tax_overrides')
    .upsert(
      {
        payrun_id: slip.payrun_id,
        profile_id: slip.user_id,
        tax_satang: taxSatang,
        note: params.note ?? null,
        set_via: params.setVia,
        set_by: params.setBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'payrun_id,profile_id' }
    );
  if (upErr) return { ok: false, status: 500, error: upErr.message };

  // 2) patch the persisted slip: replace the tax line, re-derive totals from stored gross.
  const oldTax = Number(slip.tax_satang) || 0;
  const newTotalDed = Number(slip.total_deduction_satang) - oldTax + taxSatang;
  const newNet = Number(slip.gross_satang) - newTotalDed;

  const { data: taxLine } = await service
    .from('hr_payslip_deductions')
    .select('id')
    .eq('payslip_id', slip.id)
    .eq('type', 'tax')
    .maybeSingle();
  if (taxSatang > 0) {
    if (taxLine) {
      const { error } = await service
        .from('hr_payslip_deductions')
        .update({ amount_satang: taxSatang, reason: params.note ?? null })
        .eq('id', taxLine.id);
      if (error) return { ok: false, status: 500, error: 'Failed to update tax line' };
    } else {
      const { error } = await service.from('hr_payslip_deductions').insert({
        payslip_id: slip.id,
        type: 'tax',
        label: 'tax',
        amount_satang: taxSatang,
        reason: params.note ?? null,
        created_by: params.actorId,
        sort: 998, // statutory lines render last
      });
      if (error) return { ok: false, status: 500, error: 'Failed to insert tax line' };
    }
  } else if (taxLine) {
    const { error } = await service.from('hr_payslip_deductions').delete().eq('id', taxLine.id);
    if (error) return { ok: false, status: 500, error: 'Failed to clear tax line' };
  }

  const { error: slipUpdErr } = await service
    .from('hr_payslips')
    .update({ tax_satang: taxSatang, total_deduction_satang: newTotalDed, net_satang: newNet })
    .eq('id', slip.id);
  if (slipUpdErr) return { ok: false, status: 500, error: 'Failed to update payslip totals' };

  await logHrAudit(service, {
    actorId: params.actorId,
    action: 'update',
    table: 'hr_payslips',
    recordId: slip.id,
    before: { tax_satang: oldTax, total_deduction_satang: slip.total_deduction_satang, net_satang: slip.net_satang },
    after: { tax_satang: taxSatang, total_deduction_satang: newTotalDed, net_satang: newNet },
    reason: `Tax override (${params.setVia})${params.note ? `: ${params.note}` : ''}`,
  });

  return { ok: true, payslip: { id: slip.id, tax_satang: taxSatang, total_deduction_satang: newTotalDed, net_satang: newNet } };
}
