import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import {
  buildBankTransferCsv,
  resolveBankCode,
  bankFileLabel,
  normalizeAccountNo,
  isCashBank,
  type BankTransferRow,
} from '@/lib/hr/bank-transfer';
import { buildXlsx } from '@/lib/xlsx';

interface EmpBank {
  id: string;
  profile_id: string;
  employee_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  bank_verified: boolean | null;
  tax_id: string | null;
}

// GET /api/hr/payruns/[id]/bank-file — bank-transfer file for a FINALIZED payrun (§E "โอน BBL").
// HR only. Only finalized payruns can be exported (a draft is still changing; paying from it
// would transfer wrong amounts). Two modes:
//   (no group)            → legacy direct-credit CSV, every bank in one file (unchanged).
//   ?group=bbl|other|cash → one .xlsx per bank batch (client ask 2026-07-24), columns mirroring
//     the BBL bulk-payment template's PAYMENT sheet so HR copy-pastes the block straight in:
//       bbl   — Bangkok Bank accounts only (the template's "all BBL? = yes" batch)
//       other — every other bank (interbank batch; rows carry "004, KASIKORNBANK …")
//       cash  — no bank account on file (e.g. Burmese staff) → hand-paid list
//     Safety rail: rows whose account HR has NOT verified (hr_employees.bank_verified) are
//     quarantined in a marked section below the main block and excluded from its totals, so an
//     unchecked hand-typed account number can never ride into the upload unnoticed.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = request.nextUrl.searchParams.get('group');
  if (group && !['bbl', 'other', 'cash'].includes(group)) {
    return NextResponse.json({ error: "group must be 'bbl', 'other' or 'cash'" }, { status: 400 });
  }
  const service = createServiceClient();

  const { data: payrun, error: prErr } = await service
    .from('hr_payruns')
    .select('id, company_id, store_id, period_year, period_month, cycle_start, cycle_end, pay_date, status, company:hr_companies(name)')
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
      .select('id, profile_id, employee_code, bank_name, bank_account_no, bank_account_name, bank_verified, tax_id')
      .in('id', empIds);
    for (const e of (emps ?? []) as EmpBank[]) bankByEmp.set(e.id, e);
  }
  const profileIds = [...new Set(slipRows.map((s) => s.user_id))];
  if (profileIds.length) {
    // A bank matches the payee against a legal name, so this fallback must be the ชื่อจริง — it
    // used to be profiles.display_name, i.e. the person's ชื่อเล่น. bank_account_name still wins
    // where it is on file; this is only the fallback for accounts without one.
    const entries = await buildEmployeeNameMap(service, profileIds);
    for (const [id, n] of entries) nameByProfile.set(id, n.name === '—' ? '' : n.name);
  }

  // ── Grouped .xlsx mode (client ask 2026-07-24) ─────────────────────────────
  if (group) {
    interface Line {
      name: string;
      account: string;
      bank: string | null;
      net: number; // satang
      employee: string;
      verified: boolean;
    }
    const lines: Line[] = [];
    for (const s of slipRows) {
      const emp = s.employee_id ? bankByEmp.get(s.employee_id) : undefined;
      const account = normalizeAccountNo(emp?.bank_account_no);
      const bank = emp?.bank_name?.trim() || null;
      // 'cash'/'เงินสด'/'-' typed into bank_name means hand-paid even if an account exists.
      const target = !account || !bank || isCashBank(bank) ? 'cash' : bank === 'BBL' ? 'bbl' : 'other';
      if (target !== group) continue;
      if (s.net_satang <= 0) continue; // nothing to pay
      lines.push({
        name: emp?.bank_account_name?.trim() || nameByProfile.get(s.user_id) || '',
        account,
        bank,
        net: s.net_satang,
        employee: nameByProfile.get(s.user_id) || '',
        verified: !!emp?.bank_verified,
      });
    }

    const b = (satang: number) => Math.round(satang) / 100;
    const companyName = (payrun.company as unknown as { name: string | null } | null)?.name ?? '';
    const periodLabel = `${String(payrun.period_month).padStart(2, '0')}/${payrun.period_year}`;
    const title =
      group === 'bbl' ? 'โอนเงินเดือน — ธนาคารกรุงเทพล้วน (BBL)'
      : group === 'other' ? 'โอนเงินเดือน — ต่างธนาคาร'
      : 'จ่ายเงินสด — ไม่มีบัญชีธนาคาร';
    const grid: (string | number | null)[][] = [
      [companyName],
      [`${title} · งวด ${periodLabel} · รอบ ${payrun.cycle_start ?? ''} – ${payrun.cycle_end ?? ''} · จ่าย ${payrun.pay_date ?? ''}`],
      [],
    ];

    if (group === 'cash') {
      grid.push(['NO.', 'ชื่อพนักงาน', 'จำนวนเงิน (NET)', 'หมายเหตุ']);
      lines.forEach((l, i) => grid.push([i + 1, l.employee, b(l.net), 'จ่ายเงินสด — ไม่มีบัญชีธนาคาร']));
      grid.push([]);
      grid.push(['รวม', `${lines.length} รายการ`, b(lines.reduce((s, l) => s + l.net, 0)), null]);
    } else {
      const header = [
        'NO.',
        'ชื่อผู้รับเงิน (Beneficiary Name)',
        'เลขที่บัญชี (Account No)',
        'จำนวนเงิน (Amount)',
        'สกุลเงิน (Currency)',
        'ธนาคารผู้รับเงิน (Bank)',
        'ชื่อพนักงาน (อ้างอิงภายใน)',
      ];
      const pushRows = (list: Line[]) =>
        list.forEach((l, i) =>
          grid.push([i + 1, l.name, l.account, b(l.net), 'THB', bankFileLabel(l.bank), l.employee])
        );
      const ok = lines.filter((l) => l.verified);
      const pending = lines.filter((l) => !l.verified);

      grid.push(header);
      pushRows(ok);
      grid.push([]);
      grid.push(['รวม (ตรวจบัญชีแล้ว — พร้อมอัปโหลด)', `${ok.length} รายการ`, null, b(ok.reduce((s, l) => s + l.net, 0)), null, null, null]);

      if (pending.length) {
        grid.push([]);
        grid.push(['⚠ ส่วนนี้บัญชียังไม่ผ่านการตรวจโดย HR — ห้ามคัดลอกลงไฟล์ธนาคารจนกว่าจะตรวจกับสมุด/สลิปจริง แล้วติ๊ก "ตรวจบัญชีแล้ว" ในหน้าพนักงาน']);
        grid.push(header);
        pushRows(pending);
        grid.push(['รวม (รอตรวจบัญชี)', `${pending.length} รายการ`, null, b(pending.reduce((s, l) => s + l.net, 0)), null, null, null]);
      }
    }

    // A grouped bank file with verified payable rows is money leaving the building — stamp
    // + audit exactly like the legacy CSV path (cash list moves no money by file).
    const payableCount = group === 'cash' ? 0 : lines.filter((l) => l.verified).length;
    if (payableCount > 0) {
      const { error: stampErr } = await service
        .from('hr_payruns')
        .update({ bank_exported_at: new Date().toISOString(), bank_exported_by: auth.userId })
        .eq('id', id);
      if (stampErr) console.error('[bank-file] failed to stamp bank_exported_at', stampErr.message);
    }
    await logHrAudit(service, {
      actorId: auth.userId, action: 'update', table: 'hr_payruns', recordId: id,
      before: null,
      after: { bank_file_exported: true, group, rows: lines.length, payable_rows: payableCount },
      reason: `bank transfer file exported (${group})`,
    });

    const fileGroup = group === 'bbl' ? 'BBL' : group === 'other' ? 'OtherBanks' : 'Cash';
    const sheetName = group === 'bbl' ? 'BBL' : group === 'other' ? 'Other Banks' : 'Cash';
    const buf = await buildXlsx([{ name: sheetName, rows: grid }]);
    const filename = `Payment-${fileGroup}-${String(payrun.period_month).padStart(2, '0')}-${payrun.period_year}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
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
