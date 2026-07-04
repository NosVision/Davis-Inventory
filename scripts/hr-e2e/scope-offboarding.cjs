// P5.5 Tier-2 per-store scope e2e for the offboarding family + documents. Offboarding rows carry
// a store_id (the employee's first membership); [id] routes gate via requireHrManagerForRowStore,
// init via requireHrManagerForEmployeeProfile, list via resolveHrScope. documents gates via the
// employee-folder id. Proves a manager scoped to HRTEST acts only on HRTEST-store cases — 403 on
// an out-of-store case across init/detail/sign/cancel/complete/list + document read. Cleans up.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STAFF = u('hr-test-staff').id;
const st = async (pr) => (await pr).status;
const initBody = (userId) => ({ user_id: userId, kind: 'resignation', last_working_date: '2026-08-31' });

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const all = (await req(hr, 'GET', '/api/hr/employees')).json?.data || [];
  const inEmp = all.find((e) => e.profile_id === STAFF);
  const outEmp = all.find((e) => !(e.stores || []).some((s) => s.id === HRTEST));
  check('resolved in-scope + out-of-scope employees', !!inEmp?.id && !!outEmp?.id && !!outEmp?.profile_id, null);

  // Clean any open offboarding for these two.
  await svc.from('hr_offboarding').delete().in('user_id', [STAFF, outEmp.profile_id]);

  let hrtestOffbId = null, outOffbId = null;
  try {
    // ── init gate ──
    const mgrInit = await req(mgr, 'POST', '/api/hr/offboarding', initBody(STAFF));
    check('scoped mgr init HRTEST employee → 201', mgrInit.status === 201, `status=${mgrInit.status} ${(mgrInit.text || '').slice(0, 140)}`);
    hrtestOffbId = mgrInit.json?.data?.id;
    check('scoped mgr init out-of-scope employee → 403', (await st(req(mgr, 'POST', '/api/hr/offboarding', initBody(outEmp.profile_id)))) === 403, null);
    check('staff init → 403', (await st(req(staff, 'POST', '/api/hr/offboarding', initBody(outEmp.profile_id)))) === 403, null);
    const hrInit = await req(hr, 'POST', '/api/hr/offboarding', initBody(outEmp.profile_id));
    check('HR init out-of-scope employee → 201', hrInit.status === 201, `status=${hrInit.status} ${(hrInit.text || '').slice(0, 140)}`);
    outOffbId = hrInit.json?.data?.id;

    // ── list scope ──
    const mgrList = (await req(mgr, 'GET', '/api/hr/offboarding')).json?.data || [];
    check('scoped mgr list = only HRTEST-store cases', mgrList.every((r) => r.store_id === HRTEST) && mgrList.some((r) => r.id === hrtestOffbId), mgrList.map((r) => r.store_id));
    check('scoped mgr list EXCLUDES out-of-scope case', !mgrList.some((r) => r.id === outOffbId), null);
    const hrList = (await req(hr, 'GET', '/api/hr/offboarding')).json?.data || [];
    check('HR list INCLUDES both', hrList.some((r) => r.id === hrtestOffbId) && hrList.some((r) => r.id === outOffbId), null);

    // ── [id] detail ──
    check('mgr GET HRTEST case → 200', (await st(req(mgr, 'GET', `/api/hr/offboarding/${hrtestOffbId}`))) === 200, null);
    check('mgr GET out-of-scope case → 403', (await st(req(mgr, 'GET', `/api/hr/offboarding/${outOffbId}`))) === 403, null);
    check('staff GET case → 403', (await st(req(staff, 'GET', `/api/hr/offboarding/${hrtestOffbId}`))) === 403, null);

    // ── sign / cancel / complete gate (auth fires before body/status logic) ──
    check('mgr sign out-of-scope → 403', (await st(req(mgr, 'POST', `/api/hr/offboarding/${outOffbId}/sign`, { signature: 'x' }))) === 403, null);
    check('mgr sign HRTEST passes gate → 400 (bad signature, not 403)', (await st(req(mgr, 'POST', `/api/hr/offboarding/${hrtestOffbId}/sign`, { signature: 'not-a-png' }))) === 400, null);
    check('mgr complete out-of-scope → 403', (await st(req(mgr, 'POST', `/api/hr/offboarding/${outOffbId}/complete`))) === 403, null);
    check('mgr cancel out-of-scope → 403', (await st(req(mgr, 'POST', `/api/hr/offboarding/${outOffbId}/cancel`))) === 403, null);

    // ── documents read gate (folder = hr_employees.id) ──
    check('mgr doc read in-scope folder → not 403 (gate passes, 404 missing)', (await st(req(mgr, 'GET', `/api/hr/documents?path=${inEmp.id}/nope.pdf`))) === 404, null);
    check('mgr doc read out-of-scope folder → 403', (await st(req(mgr, 'GET', `/api/hr/documents?path=${outEmp.id}/nope.pdf`))) === 403, null);
  } finally {
    await svc.from('hr_offboarding').delete().in('user_id', [STAFF, outEmp.profile_id]);
  }

  process.exit(summary('HR_E2E_SCOPE_OFFBOARDING') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_OFFBOARDING ERROR', e); process.exit(1); });
