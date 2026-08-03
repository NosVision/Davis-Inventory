// P5.2 statutory report routes e2e (/api/hr/reports). Temporarily raises staff9 to a taxable rate
// and FINALIZES the 7/2026 payrun so ภ.ง.ด.1 / สปส / 50ทวิ / 1ก / register aggregate real slips,
// asserts each report reconciles to the baht, checks the e-filing CSV + validations + HR-only guard,
// then reopens the payrun and restores the rate in finally. Self-restoring.
const { login, req, creds, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 7;
const SUBJ_UID = u('hr-test-staff9').id;
const TAXABLE_RATE = 6_000_000; // ฿60,000/mo → above the PND1 threshold
const R = (qs) => `/api/hr/reports?${qs}`;

const ensureDraft = async (hr) => {
  const list = await req(hr, 'GET', `/api/hr/payruns?company_id=${COMPANY}`);
  const run = (list.json?.data || []).find((r) => r.period_year === YEAR && r.period_month === MONTH);
  if (run?.status === 'finalized') await req(hr, 'POST', `/api/hr/payruns/${run.id}/reopen`, { reason: 'e2e reports reset' });
};

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const empList = await req(hr, 'GET', '/api/hr/employees?limit=200');
  const subjEmp = (empList.json?.data || []).find((e) => e.profile_id === SUBJ_UID);
  check('resolved staff9 hr_employees.id', !!subjEmp?.id, empList.json?.data?.length);
  const empId9 = subjEmp?.id;
  const origRate = subjEmp?.rate_satang;

  let payrunId = null;
  try {
    // Raise staff9 to a taxable rate, (re)generate the draft, and finalize.
    await req(hr, 'PUT', `/api/hr/employees/${empId9}`, { rate_satang: TAXABLE_RATE, reason: 'e2e reports taxable rate' });
    await ensureDraft(hr);
    const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    payrunId = gen.json?.data?.id;
    check('generate payrun ok', gen.status === 200 && !!payrunId, gen.status);
    const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
    check('finalize payrun 200', fin.status === 200, `status=${fin.status} ${(fin.text || '').slice(0, 140)}`);

    // ── ภ.ง.ด.1 (monthly withholding) ──
    const pnd1 = await req(hr, 'GET', R(`type=pnd1&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}`));
    check('pnd1 200', pnd1.status === 200, `status=${pnd1.status} ${(pnd1.text || '').slice(0, 140)}`);
    const p1 = pnd1.json?.data?.report;
    const staff9Line = (p1?.lines || []).find((l) => l.employee_id === empId9);
    check('pnd1 includes staff9 with tax>0', !!staff9Line && staff9Line.tax_satang > 0, staff9Line);
    check('pnd1 only lists withheld employees (staff tax=0 excluded)', !(p1?.lines || []).some((l) => l.tax_satang <= 0), (p1?.lines || []).map((l) => l.tax_satang));
    check('pnd1 total_tax reconciles to Σ lines', p1?.total_tax_satang === (p1?.lines || []).reduce((s, l) => s + l.tax_satang, 0), p1?.total_tax_satang);
    check('pnd1 employee_count == lines.length', p1?.employee_count === (p1?.lines || []).length, p1?.employee_count);

    // ── สปส.1-10 (SSO) ──
    const sso = await req(hr, 'GET', R(`type=sso&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}`));
    const s1 = sso.json?.data?.report;
    check('sso 200 + has enrolled lines', sso.status === 200 && (s1?.lines || []).length >= 1, sso.status);
    check('sso employer matches employee (symmetric 5/5)', s1?.total_employer_satang === s1?.total_employee_satang, { er: s1?.total_employer_satang, ee: s1?.total_employee_satang });
    check('sso remit == employee + employer', s1?.total_remit_satang === (s1?.total_employee_satang + s1?.total_employer_satang), s1?.total_remit_satang);
    check('sso per-line employer==employee', (s1?.lines || []).every((l) => l.employer_satang === l.employee_satang), null);

    // ── ทะเบียนเงินเดือน (register / labor cost) ──
    const reg = await req(hr, 'GET', R(`type=register&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}`));
    const rg = reg.json?.data?.report;
    check('register 200 + gross>0', reg.status === 200 && rg?.total_gross_satang > 0, reg.status);
    check('register labor cost = gross + employer SSO', rg?.total_labor_cost_satang === rg?.total_gross_satang + rg?.employer_sso_satang, { labor: rg?.total_labor_cost_satang, gross: rg?.total_gross_satang, erSso: rg?.employer_sso_satang });
    check('register employer SSO == total employee SSO', rg?.employer_sso_satang === rg?.total_sso_satang, null);

    // ── ภ.ง.ด.1ก (annual) — includes ALL employees with income, even 0-tax ──
    const pnd1k = await req(hr, 'GET', R(`type=pnd1k&company_id=${COMPANY}&year=${YEAR}`));
    const pk = pnd1k.json?.data?.report;
    check('pnd1k 200 includes staff9', pnd1k.status === 200 && (pk?.lines || []).some((l) => l.employee_id === empId9), pnd1k.status);
    check('pnd1k reports 0-tax employees too (≥ pnd1 lines)', (pk?.lines || []).length >= (p1?.lines || []).length, { pnd1k: (pk?.lines || []).length, pnd1: (p1?.lines || []).length });

    // ── 50 ทวิ (annual per-employee certificate) ──
    const cert = await req(hr, 'GET', R(`type=cert50twi&company_id=${COMPANY}&year=${YEAR}&employee_id=${empId9}`));
    const certs = cert.json?.data?.certificates || [];
    check('cert50twi 200 single employee', cert.status === 200 && certs.length === 1, { status: cert.status, n: certs.length });
    check('cert50twi income>0 and tax>0 for staff9', certs[0]?.total_income_satang > 0 && certs[0]?.total_tax_satang > 0, certs[0]);

    // ── e-filing CSV ──
    const csv = await req(hr, 'GET', R(`type=pnd1&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}&format=csv`));
    check('pnd1 csv content-type', (csv.headers['content-type'] || '').includes('text/csv'), csv.headers['content-type']);
    check('pnd1 csv has header + a data row', (csv.text || '').split('\n').filter(Boolean).length >= 2 && (csv.text || '').startsWith('tax_id,employee_name'), (csv.text || '').slice(0, 80));

    // ── validation + authz ──
    const badType = await req(hr, 'GET', R(`type=nope&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}`));
    check('invalid type → 400', badType.status === 400, badType.status);
    const noMonth = await req(hr, 'GET', R(`type=pnd1&company_id=${COMPANY}&year=${YEAR}`));
    check('pnd1 without month → 400', noMonth.status === 400, noMonth.status);
    const noCompany = await req(hr, 'GET', R(`type=pnd1&year=${YEAR}&month=${MONTH}`));
    check('missing company_id → 400', noCompany.status === 400, noCompany.status);
    const staffReport = await req(staff, 'GET', R(`type=pnd1&company_id=${COMPANY}&year=${YEAR}&month=${MONTH}`));
    check('staff GET report FORBIDDEN', staffReport.status === 401 || staffReport.status === 403, staffReport.status);
  } finally {
    if (payrunId) await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, { reason: 'e2e reports restore draft' });
    if (origRate != null) {
      await req(hr, 'PUT', `/api/hr/employees/${empId9}`, { rate_satang: origRate, reason: 'e2e reports restore rate' });
      await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    }
  }

  process.exit(summary('HR_E2E_REPORTS') ? 0 : 1);
})().catch((e) => { console.error('REPORTS ERROR', e); process.exit(1); });
