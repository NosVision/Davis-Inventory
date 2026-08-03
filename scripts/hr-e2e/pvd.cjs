// PVD (provident fund) e2e — enrolling staff at 3% adds a provident_fund deduction line on the
// regenerated slip; net drops by exactly that amount (staff owes no tax, so no tax interaction);
// disenrolling removes it. Restores original PVD state in finally. Throwaway.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 7;
const SUBJ_UID = u('hr-test-staff').id;

const genSubjSlip = async (hr) => {
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  const detail = await req(hr, 'GET', `/api/hr/payruns/${gen.json?.data?.id}`);
  const summ = (detail.json?.data?.payslips || []).find((s) => s.user_id === SUBJ_UID) || {};
  const full = summ.id ? (await req(hr, 'GET', `/api/hr/payslips/${summ.id}`)).json?.data : null;
  return { summ, deductions: full?.deductions || [] };
};

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);

  const empList = await req(hr, 'GET', '/api/hr/employees?limit=200');
  const subjEmp = (empList.json?.data || []).find((e) => e.profile_id === SUBJ_UID);
  const empId = subjEmp?.id;
  check('resolved staff hr_employees.id', !!empId, null);
  const origEnrolled = !!subjEmp?.pvd_enrolled;
  const origRate = subjEmp?.pvd_employee_rate ?? 0;

  try {
    // Disenroll first for a clean baseline.
    await req(hr, 'PUT', `/api/hr/employees/${empId}`, { pvd_enrolled: false, pvd_employee_rate: 0 });
    const base = await genSubjSlip(hr);
    check('baseline has no provident_fund line', !base.deductions.some((d) => d.type === 'provident_fund'), base.deductions.map((d) => d.type));

    // Enroll at 3%.
    const put = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { pvd_enrolled: true, pvd_employee_rate: 0.03 });
    check('PUT enroll PVD 3% 200', put.status === 200, `status=${put.status} ${(put.text || '').slice(0, 160)}`);

    const withPvd = await genSubjSlip(hr);
    const pvdLine = withPvd.deductions.find((d) => d.type === 'provident_fund');
    check('provident_fund deduction line present', !!pvdLine, withPvd.deductions.map((d) => d.type));
    check('PVD amount > 0', (pvdLine?.amount_satang ?? 0) > 0, pvdLine);
    check('PVD ref shows 3.00%', (pvdLine?.ref || '').includes('3.00'), pvdLine?.ref);
    check('net drops by exactly the PVD amount (no tax interaction)',
      base.summ.net_satang - withPvd.summ.net_satang === pvdLine.amount_satang,
      { baseNet: base.summ.net_satang, pvdNet: withPvd.summ.net_satang, pvd: pvdLine.amount_satang });
    check('total_deduction rises by the PVD amount',
      withPvd.summ.total_deduction_satang - base.summ.total_deduction_satang === pvdLine.amount_satang,
      { base: base.summ.total_deduction_satang, withPvd: withPvd.summ.total_deduction_satang });

    // Disenroll → line gone again.
    await req(hr, 'PUT', `/api/hr/employees/${empId}`, { pvd_enrolled: false, pvd_employee_rate: 0 });
    const off = await genSubjSlip(hr);
    check('disenroll removes provident_fund line', !off.deductions.some((d) => d.type === 'provident_fund'), off.deductions.map((d) => d.type));
    check('net restored to baseline after disenroll', off.summ.net_satang === base.summ.net_satang, { base: base.summ.net_satang, off: off.summ.net_satang });
  } finally {
    await req(hr, 'PUT', `/api/hr/employees/${empId}`, { pvd_enrolled: origEnrolled, pvd_employee_rate: origRate });
    await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  }

  process.exit(summary('HR_E2E_PVD') ? 0 : 1);
})().catch((e) => { console.error('PVD ERROR', e); process.exit(1); });
