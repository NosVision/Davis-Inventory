// ④ Paper-slip queue — live e2e on a THROWAWAY payrun (2026-11, HR Test Co):
// staff requests paper on their finalized slip → HR notified → queue shows source 'request';
// staff9 turns ON the standing preference → queue shows 'standing' with no request row;
// HR marks both printed → rows upserted printed + employees notified; guards: request on a
// draft 409, someone else's slip 404, duplicate request idempotent, staff can't read queue.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 11;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const staff9 = await login(u('hr-test-staff9').email, u('hr-test-staff9').password);
  const staffId = u('hr-test-staff').id;
  const staff9Id = u('hr-test-staff9').id;

  let payrunId = null;
  try {
    const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    check('generate 2026-11 payrun', gen.status === 200 || gen.status === 201, gen.status);
    payrunId = gen.json?.data?.id;

    const { data: slips } = await svc.from('hr_payslips').select('id, user_id').eq('payrun_id', payrunId);
    const staffSlip = (slips ?? []).find((s) => s.user_id === staffId);
    const staff9Slip = (slips ?? []).find((s) => s.user_id === staff9Id);
    check('both slips exist', !!staffSlip && !!staff9Slip, slips?.length);

    // request on DRAFT → 409
    const draftReq = await req(staff, 'POST', `/api/hr/ess/payslips/${staffSlip.id}/request-paper`, {});
    check('request on draft 409', draftReq.status === 409, draftReq.status);

    // finalize → request works
    const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
    check('finalize 200', fin.status === 200, fin.status);
    const r1 = await req(staff, 'POST', `/api/hr/ess/payslips/${staffSlip.id}/request-paper`, {});
    check('paper request 201', r1.status === 201, `${r1.status} ${(r1.text || '').slice(0, 100)}`);
    const r2 = await req(staff, 'POST', `/api/hr/ess/payslips/${staffSlip.id}/request-paper`, {});
    check('duplicate request idempotent', r2.status === 200 && r2.json?.data?.already === true, r2.status);

    // someone else's slip → 404
    const other = await req(staff, 'POST', `/api/hr/ess/payslips/${staff9Slip.id}/request-paper`, {});
    check("other's slip 404", other.status === 404, other.status);

    // HR notified of the request
    const { data: reqNotif } = await svc.from('notifications').select('id').eq('user_id', u('hr-test-hr').id).eq('type', 'hr_paper_request');
    check('HR notified of paper request', (reqNotif ?? []).length >= 1, reqNotif?.length);

    // staff9 standing preference via ESS
    const pref = await req(staff9, 'PUT', '/api/hr/ess/paper-slip-preference', { standing: true });
    check('standing preference 200', pref.status === 200, pref.status);

    // ESS list reflects request status + standing flag
    const list9 = await req(staff9, 'GET', '/api/hr/ess/payslips');
    check('ESS list exposes standing flag', list9.json?.paper_slip_standing === true, list9.json?.paper_slip_standing);
    const listS = await req(staff, 'GET', '/api/hr/ess/payslips');
    const mine = (listS.json?.data ?? []).find((x) => x.id === staffSlip.id);
    check('ESS list shows paper_status requested', mine?.paper_status === 'requested', mine?.paper_status);

    // queue: staff via request, staff9 via standing
    const q1 = await req(hr, 'GET', `/api/hr/payruns/${payrunId}/print-queue`);
    check('queue 200', q1.status === 200, q1.status);
    const qRows = q1.json?.data ?? [];
    const qStaff = qRows.find((r) => r.payslip_id === staffSlip.id);
    const qStaff9 = qRows.find((r) => r.payslip_id === staff9Slip.id);
    check("staff in queue as 'request'", qStaff?.source === 'request' && qStaff?.status === 'requested', qStaff);
    check("staff9 in queue as 'standing'", qStaff9?.source === 'standing', qStaff9);

    // staff cannot read the queue
    const sQ = await req(staff, 'GET', `/api/hr/payruns/${payrunId}/print-queue`);
    check('staff queue FORBIDDEN', sQ.status === 401 || sQ.status === 403, sQ.status);

    // mark both printed
    const mark = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/print-queue`, { payslip_ids: [staffSlip.id, staff9Slip.id] });
    check('mark-printed 200 (2)', mark.status === 200 && mark.json?.data?.printed === 2, mark.json?.data);
    const q2 = await req(hr, 'GET', `/api/hr/payruns/${payrunId}/print-queue`);
    check('queue shows both printed', (q2.json?.data ?? []).filter((r) => r.status === 'printed').length === 2, q2.json?.data);

    // employees notified pickup
    const { data: readyNotif } = await svc.from('notifications').select('user_id').eq('type', 'hr_paper_ready');
    const readyUsers = new Set((readyNotif ?? []).map((n) => n.user_id));
    check('both employees notified pickup', readyUsers.has(staffId) && readyUsers.has(staff9Id), [...readyUsers].length);

    // foreign slip in mark-printed → 400
    const { data: foreign } = await svc.from('hr_payslips').select('id').neq('payrun_id', payrunId).limit(1).maybeSingle();
    if (foreign) {
      const bad = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/print-queue`, { payslip_ids: [foreign.id] });
      check('foreign slip 400', bad.status === 400, bad.status);
    } else {
      check('foreign slip 400 (skipped)', true, 'skip');
    }
  } finally {
    if (payrunId) {
      const { data: ps } = await svc.from('hr_payslips').select('id').eq('payrun_id', payrunId);
      const ids = (ps ?? []).map((p) => p.id);
      if (ids.length) {
        await svc.from('hr_payslip_print_requests').delete().in('payslip_id', ids);
        await svc.from('hr_payslip_earnings').delete().in('payslip_id', ids);
        await svc.from('hr_payslip_deductions').delete().in('payslip_id', ids);
      }
      await svc.from('hr_payslip_tax_overrides').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payslips').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payruns').delete().eq('id', payrunId);
    }
    await svc.from('hr_employees').update({ paper_slip_standing: false }).eq('profile_id', staff9Id);
    await svc.from('notifications').delete().in('type', ['hr_paper_request', 'hr_paper_ready']);
  }

  process.exit(summary('HR_E2E_PRINT_QUEUE') ? 0 : 1);
})().catch((e) => { console.error('PRINT_QUEUE ERROR', e); process.exit(1); });
