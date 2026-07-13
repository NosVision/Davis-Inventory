import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import {
  buildBankTransferCsv,
  resolveBankCode,
  type BankTransferRow,
} from '@/lib/hr/bank-transfer';

interface EmpBank {
  id: string;
  profile_id: string;
  employee_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  tax_id: string | null;
}

// GET /api/hr/payruns/[id]/bank-file — direct-credit CSV for a FINALIZED payrun (§E "โอน BBL").
// HR only. Only finalized payruns can be exported (a draft is still changing; paying from it
// would transfer wrong amounts). Returns text/csv as a download; logs the export for audit.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, pay_date, status')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to load payrun' }, { status: 500 });
  if (!payrun) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });

  // §P5.5: bank export of employee net pay — gate on the payrun's store.
  const auth = await requireHrManagerForStore(payrun.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (payrun.status !== 'finalized') {
    return NextResponse.json({ error: 'Only a finalized payrun can be exported to a bank file' }, { status: 409 });
  }

  const { data: slips, error: slErr } = await service
    .from('hr_payslips')
    .select('user_id, employee_id, net_satang')
    .eq('payrun_id', id);
  if (slErr) return NextResponse.json({ error: 'Failed to load payslips' }, { status: 500 });
  const slipRows = slips ?? [];
  if (slipRows.length === 0) {
    return NextResponse.json({ error: 'Payrun has no payslips' }, { status: 409 });
  }

  const empIds = [...new Set(slipRows.map((s) => s.employee_id).filter(Boolean))] as string[];
  const bankByEmp = new Map<string, EmpBank>();
  const nameByProfile = new Map<string, string>();
  if (empIds.length) {
    const { data: emps } = await service
      .from('hr_employees')
      .select('id, profile_id, employee_code, bank_name, bank_account_no, bank_account_name, tax_id')
      .in('id', empIds);
    for (const e of (emps ?? []) as EmpBank[]) bankByEmp.set(e.id, e);
  }
  const profileIds = [...new Set(slipRows.map((s) => s.user_id))];
  if (profileIds.length) {
    const { data: profs } = await service.from('profiles').select('id, username, display_name').in('id', profileIds);
    for (const p of (profs ?? []) as { id: string; username: string | null; display_name: string | null }[]) {
      nameByProfile.set(p.id, p.display_name || p.username || '');
    }
  }

  const rows: BankTransferRow[] = slipRows.map((s) => {
    const emp = s.employee_id ? bankByEmp.get(s.employee_id) : undefined;
    // Prefer the bank account name on file; fall back to the profile display name.
    const accountName = emp?.bank_account_name || nameByProfile.get(s.user_id) || '';
    return {
      bankCode: resolveBankCode(emp?.bank_name),
      accountNo: emp?.bank_account_no ?? '',
      accountName,
      netSatang: s.net_satang,
      citizenId: emp?.tax_id ?? null,
      reference: `${payrun.period_year}${String(payrun.period_month).padStart(2, '0')}-${emp?.employee_code ?? ''}`,
    };
  });

  const { csv, count, totalSatang, skipped } = buildBankTransferCsv(rows, {
    payDate: payrun.pay_date ?? '',
  });

  // Stamp the export so a paid payrun can't be silently reopened/regenerated after money moved
  // (§Phase 0B; enforced in /reopen). Only when the file carries payable rows — a header-only export
  // (every slip non-payable) moves no money, so it must not arm the force-required reopen lock.
  // Best-effort: a stamp failure must not fail the download, but it is logged so the gap is visible.
  if (count > 0) {
    const { error: stampErr } = await service
      .from('hr_payruns')
      .update({ bank_exported_at: new Date().toISOString(), bank_exported_by: auth.userId })
      .eq('id', id);
    if (stampErr) console.error('[bank-file] failed to stamp bank_exported_at', stampErr.message);
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: 'hr_payruns', recordId: id,
    before: null,
    after: { bank_file_exported: true, rows: count, total_satang: totalSatang, skipped: skipped.length },
    reason: 'bank transfer file exported',
  });

  const filename = `payroll_${payrun.period_year}${String(payrun.period_month).padStart(2, '0')}_bbl.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Transfer-Count': String(count),
      'X-Transfer-Total-Satang': String(totalSatang),
      'X-Transfer-Skipped': String(skipped.length),
    },
  });
}
