// Tax override (accounting-office official figure) — live e2e on a THROWAWAY payrun (2026-08,
// HR Test Co) so p43's 2026-07 state is untouched. Proves the full contract:
// PUT override → slip tax/total/net patched + tax line replaced + detail exposes tax_override
// → REGENERATE keeps the override (engine reads it back) → override 0 clears the line
// → finalized payrun rejects overrides (409) → staff locked out → audit written. Full cleanup.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873'; // HR Test Co
const YEAR = 2026, MONTH = 8;
const STAFF_ID_KEY = 'hr-test-staff';

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u(STAFF_ID_KEY).email, u(STAFF_ID_KEY).password);
  const staffId = u(STAFF_ID_KEY).id;

  let payrunId = null;
  try {
    // throwaway payrun for 2026-08
    const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    check('generate 2026-08 payrun', gen.status === 200 || gen.status === 201, `${gen.status} ${(gen.text || '').slice(0, 120)}`);
    payrunId = gen.json?.data?.id ?? null;
    check('payrun id returned', !!payrunId, payrunId);

    const { data: slips } = await svc.from('hr_payslips').select('id, user_id, gross_satang, tax_satang, total_deduction_satang, net_satang').eq('payrun_id', payrunId);
    const slip = (slips ?? []).find((s) => s.user_id === staffId);
    check('staff slip exists', !!slip, slips?.length);

    // 1) HR sets the official figure
    const OFFICIAL = 123_456; // ฿1,234.56
    const put = await req(hr, 'PUT', `/api/hr/payslips/${slip.id}/tax-override`, { tax_satang: OFFICIAL, note: 'e2e official' });
    check('override PUT 200', put.status === 200, `${put.status} ${(put.text || '').slice(0, 120)}`);

    const det1 = await req(hr, 'GET', `/api/hr/payslips/${slip.id}`);
    const p1 = det1.json?.data?.payslip;
    const expTotal = Number(slip.total_deduction_satang) - Number(slip.tax_satang) + OFFICIAL;
    check('slip tax = official', p1?.tax_satang === OFFICIAL, p1?.tax_satang);
    check('total_deduction re-derived', p1?.total_deduction_satang === expTotal, `${p1?.total_deduction_satang} vs ${expTotal}`);
    check('net = gross − new total', p1?.net_satang === Number(slip.gross_satang) - expTotal, p1?.net_satang);
    const taxLine = (det1.json?.data?.deductions ?? []).find((l) => l.type === 'tax');
    check('tax line amount = official', taxLine?.amount_satang === OFFICIAL, taxLine);
    check('detail exposes tax_override (via hr)', det1.json?.data?.tax_override?.set_via === 'hr' && det1.json?.data?.tax_override?.tax_satang === OFFICIAL, det1.json?.data?.tax_override);

    // 2) regenerate the draft → override must survive (engine reads the override table)
    const regen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    check('regenerate 200', regen.status === 200 || regen.status === 201, regen.status);
    const { data: slips2 } = await svc.from('hr_payslips').select('id, user_id, tax_satang, gross_satang, total_deduction_satang, net_satang').eq('payrun_id', payrunId);
    const slip2 = (slips2 ?? []).find((s) => s.user_id === staffId);
    check('regenerated slip keeps official tax', slip2?.tax_satang === OFFICIAL, slip2?.tax_satang);
    check('regenerated net consistent (gross − total)', Number(slip2?.gross_satang) - Number(slip2?.total_deduction_satang) === Number(slip2?.net_satang), slip2);

    // 3) override → 0 clears the tax line
    const zero = await req(hr, 'PUT', `/api/hr/payslips/${slip2.id}/tax-override`, { tax_satang: 0 });
    check('override 0 → 200', zero.status === 200, zero.status);
    const det2 = await req(hr, 'GET', `/api/hr/payslips/${slip2.id}`);
    check('tax now 0 + line removed', det2.json?.data?.payslip?.tax_satang === 0 && !(det2.json?.data?.deductions ?? []).some((l) => l.type === 'tax'), det2.json?.data?.payslip?.tax_satang);

    // 4) staff cannot override
    const sPut = await req(staff, 'PUT', `/api/hr/payslips/${slip2.id}/tax-override`, { tax_satang: 1 });
    check('staff override FORBIDDEN', sPut.status === 401 || sPut.status === 403, sPut.status);

    // 5) finalized payrun rejects overrides
    const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
    check('finalize 200', fin.status === 200, fin.status);
    const putAfter = await req(hr, 'PUT', `/api/hr/payslips/${slip2.id}/tax-override`, { tax_satang: 55 });
    check('override on finalized 409', putAfter.status === 409, putAfter.status);

    // 6) audit written
    const { data: audits } = await svc.from('hr_audit_log').select('id, reason').eq('table_name', 'hr_payslips').eq('record_id', slip.id);
    check('audit records the override', (audits ?? []).some((a) => String(a.reason || '').includes('Tax override')), audits?.length);
  } finally {
    if (payrunId) {
      await svc.from('hr_payslip_tax_overrides').delete().eq('payrun_id', payrunId);
      const { data: ps } = await svc.from('hr_payslips').select('id').eq('payrun_id', payrunId);
      const ids = (ps ?? []).map((p) => p.id);
      if (ids.length) {
        await svc.from('hr_payslip_earnings').delete().in('payslip_id', ids);
        await svc.from('hr_payslip_deductions').delete().in('payslip_id', ids);
      }
      await svc.from('hr_payslips').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payruns').delete().eq('id', payrunId);
      await svc.from('hr_audit_log').delete().eq('table_name', 'hr_payruns').eq('record_id', payrunId);
    }
  }

  process.exit(summary('HR_E2E_TAX_OVERRIDE') ? 0 : 1);
})().catch((e) => { console.error('TAX_OVERRIDE ERROR', e); process.exit(1); });
