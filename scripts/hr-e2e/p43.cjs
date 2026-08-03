// P4.3 payrun lifecycle e2e — generate → detail → ESS draft-hidden → finalize → ESS self-scoped
// → staff 403 → already-finalized 409 → reopen (restores draft for downstream e2e). Throwaway.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 7;

const findPeriod = (list) => (list || []).find((s) => s.period_year === YEAR && s.period_month === MONTH);

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const staff9 = await login(u('hr-test-staff9').email, u('hr-test-staff9').password);

  // 1. HR generates the 7/2026 payrun.
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  check('HR generate payrun 200', gen.status === 200, `status=${gen.status} ${(gen.text || '').slice(0, 160)}`);
  const payrunId = gen.json?.data?.id;
  check('payrun id returned', !!payrunId, gen.json);
  check('payslips generated (>=2)', (gen.json?.data?.payslips ?? 0) >= 2, gen.json?.data);

  // 2. HR detail — totals + per-employee slips with staff/staff9 present.
  const detail = await req(hr, 'GET', `/api/hr/payruns/${payrunId}`);
  check('HR detail 200', detail.status === 200, detail.status);
  const slips = detail.json?.data?.payslips || [];
  const staffSlip = slips.find((s) => s.user_id === u('hr-test-staff').id);
  const staff9Slip = slips.find((s) => s.user_id === u('hr-test-staff9').id);
  check('detail includes staff slip', !!staffSlip, slips.map((s) => s.user_id));
  check('detail includes staff9 slip', !!staff9Slip, null);
  check('detail totals.net > 0', (detail.json?.data?.totals?.net ?? 0) > 0, detail.json?.data?.totals);
  check('staff & staff9 nets differ (distinct rates)', staffSlip && staff9Slip && staffSlip.net_satang !== staff9Slip.net_satang,
    { s: staffSlip?.net_satang, s9: staff9Slip?.net_satang });

  // 3. Draft is HIDDEN from ESS (payrun not finalized yet). Ensure a clean baseline first.
  const preHr = await req(hr, 'GET', `/api/hr/payruns/${payrunId}`);
  if (preHr.json?.data?.payrun?.status === 'finalized') {
    await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, { reason: 'e2e reset to draft' });
  }
  const essDraft = await req(staff, 'GET', '/api/hr/ess/payslips');
  check('staff ESS 200', essDraft.status === 200, essDraft.status);
  check('draft payrun HIDDEN from staff ESS', !findPeriod(essDraft.json?.data), findPeriod(essDraft.json?.data));

  // 4. HR finalizes. Since 2026-07-10 a run cannot lock until the ACCOUNTANT confirms the review
  // link; HR may proceed anyway with an audited override_reason (the real HR escape hatch, and the
  // only one available here — this throwaway run has no accountant link). The gate itself (409
  // without a reason) is asserted first so the override can never mask a broken gate.
  const finNoReason = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`);
  check('finalize without accountant confirm → 409', finNoReason.status === 409 && finNoReason.json?.code === 'accountant_not_confirmed', `status=${finNoReason.status} ${(finNoReason.text || '').slice(0, 120)}`);
  const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
  check('HR finalize 200 (with override)', fin.status === 200 && fin.json?.data?.status === 'finalized', `status=${fin.status} ${(fin.text || '').slice(0, 160)}`);

  // 5. After finalize, staff sees their OWN slip; self-scoped (net equals HR-detail net for that user).
  const essStaff = await req(staff, 'GET', '/api/hr/ess/payslips');
  const staffOwn = findPeriod(essStaff.json?.data);
  check('staff sees own 7/2026 slip after finalize', !!staffOwn, essStaff.json?.data);
  check('staff ESS net == HR-detail net (self-scoped)', staffOwn && staffOwn.net_satang === staffSlip.net_satang,
    { ess: staffOwn?.net_satang, detail: staffSlip?.net_satang });

  const essStaff9 = await req(staff9, 'GET', '/api/hr/ess/payslips');
  const staff9Own = findPeriod(essStaff9.json?.data);
  check('staff9 sees own 7/2026 slip', !!staff9Own, null);
  check('staff9 ESS net == staff9 net, NOT staff net (self-scoped)',
    staff9Own && staff9Own.net_satang === staff9Slip.net_satang && staff9Own.net_satang !== staffSlip.net_satang,
    { ess9: staff9Own?.net_satang, detail9: staff9Slip?.net_satang, staff: staffSlip?.net_satang });

  // 6. Staff cannot generate a payrun.
  const staffGen = await req(staff, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  check('staff generate FORBIDDEN (401/403)', staffGen.status === 401 || staffGen.status === 403, staffGen.status);

  // 7. Finalizing an already-finalized payrun → 409 (CAS guard).
  const refin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`);
  check('re-finalize already-finalized → 409', refin.status === 409, refin.status);

  // 8. Reopen requires a reason (400 without).
  const reopenNoReason = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, {});
  check('reopen without reason → 400', reopenNoReason.status === 400, reopenNoReason.status);

  // 9. Reopen restores draft (leaves state clean for downstream e2e).
  const reopen = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, { reason: 'e2e P4.3 restore draft' });
  check('reopen → draft 200', reopen.status === 200 && reopen.json?.data?.status === 'draft', `status=${reopen.status}`);

  process.exit(summary('HR_E2E_P43') ? 0 : 1);
})().catch((e) => { console.error('P43 ERROR', e); process.exit(1); });
