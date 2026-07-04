// tax-allowance CRUD → payslip tax-impact e2e. Temporarily raises staff9 to a taxable rate so
// the ล.ย.01 spouse allowance visibly lowers progressive PND1 tax through the real payrun
// generation path, then restores rate + deletes the allowance in finally. Throwaway.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 7;
const SUBJ_UID = u('hr-test-staff9').id;
const TAXABLE_RATE = 6_000_000; // ฿60,000/mo → clearly above the PND1 threshold

const genSubjSlip = async (hr) => {
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  const detail = await req(hr, 'GET', `/api/hr/payruns/${gen.json?.data?.id}`);
  return (detail.json?.data?.payslips || []).find((s) => s.user_id === SUBJ_UID) || {};
};

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const empList = await req(hr, 'GET', '/api/hr/employees');
  const subjEmp = (empList.json?.data || []).find((e) => e.profile_id === SUBJ_UID);
  check('resolved staff9 hr_employees.id', !!subjEmp?.id, empList.json?.data?.length);
  const empId = subjEmp?.id;
  const origRate = subjEmp?.rate_satang;

  let itemId = null;
  try {
    // Sensitive-edit guard: rate change without a reason → 400.
    const noReason = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: TAXABLE_RATE });
    check('rate edit without reason → 400', noReason.status === 400, noReason.status);

    // Raise to a taxable rate.
    const raise = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: TAXABLE_RATE, reason: 'e2e temp taxable rate' });
    check('raise rate 200', raise.status === 200, `status=${raise.status} ${(raise.text || '').slice(0, 160)}`);

    // Clean leftover allowances for a deterministic baseline.
    const pre = await req(hr, 'GET', `/api/hr/employees/${empId}/tax-allowances?tax_year=${YEAR}`);
    for (const it of pre.json?.data || []) await req(hr, 'DELETE', `/api/hr/employees/${empId}/tax-allowances?item_id=${it.id}`);

    const base = await genSubjSlip(hr);
    check('baseline tax > 0 at taxable rate', base.tax_satang > 0, base.tax_satang);

    // POST spouse allowance ฿60,000 annual.
    const post = await req(hr, 'POST', `/api/hr/employees/${empId}/tax-allowances`, { kind: 'spouse', amount_satang: 6_000_000, label: 'คู่สมรส' });
    check('POST allowance 201', post.status === 201, `status=${post.status} ${(post.text || '').slice(0, 160)}`);
    itemId = post.json?.data?.id;

    const withAllow = await genSubjSlip(hr);
    check('allowance LOWERS tax', withAllow.tax_satang < base.tax_satang, { base: base.tax_satang, withAllowance: withAllow.tax_satang });
    check('allowance RAISES net', withAllow.net_satang > base.net_satang, { base: base.net_satang, withAllowance: withAllow.net_satang });

    const list = await req(hr, 'GET', `/api/hr/employees/${empId}/tax-allowances?tax_year=${YEAR}`);
    check('GET lists the allowance', (list.json?.data || []).some((x) => x.id === itemId), null);

    // PATCH active=false → tax returns to baseline.
    const patch = await req(hr, 'PATCH', `/api/hr/employees/${empId}/tax-allowances`, { item_id: itemId, active: false });
    check('PATCH deactivate 200', patch.status === 200, patch.status);
    const deact = await genSubjSlip(hr);
    check('deactivated → tax back to baseline', deact.tax_satang === base.tax_satang, { base: base.tax_satang, now: deact.tax_satang });

    const del = await req(hr, 'DELETE', `/api/hr/employees/${empId}/tax-allowances?item_id=${itemId}`);
    check('DELETE allowance 200', del.status === 200, del.status);
    itemId = null;

    const staffGet = await req(staff, 'GET', `/api/hr/employees/${empId}/tax-allowances`);
    check('staff GET tax-allowances FORBIDDEN', staffGet.status === 401 || staffGet.status === 403, staffGet.status);
  } finally {
    // Restore original rate + remove any leftover allowance + rebuild slips at original rate.
    if (itemId) await req(hr, 'DELETE', `/api/hr/employees/${empId}/tax-allowances?item_id=${itemId}`);
    if (origRate != null) {
      const restore = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: origRate, reason: 'e2e restore original rate' });
      check('restored original rate', restore.status === 200, restore.status);
      await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    }
  }

  process.exit(summary('HR_E2E_TAXALLOW') ? 0 : 1);
})().catch((e) => { console.error('TAXALLOW ERROR', e); process.exit(1); });
