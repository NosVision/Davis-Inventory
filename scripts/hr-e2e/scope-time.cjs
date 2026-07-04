// P5.5 Tier-3 per-store scope e2e (attendance / timesheet-override / schedule-ack / warnings-void
// / dayoff-swaps-ack). Rows carry store_id (or key on the employee); each route gates via
// resolveHrScope / requireHrManagerForEmployeeProfile / requireHrManagerForRowStore /
// requireStoreManager. Proves a manager scoped to HRTEST acts only within HRTEST — 403 across
// stores. Fabricates minimal STORE_B/HRTEST warning + swap rows for the row-store gate; cleans up.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STORE_B = 'c293344a-ffa9-4596-98fc-635ec0426f9e';
const STAFF = u('hr-test-staff').id, STAFF9 = u('hr-test-staff9').id, HRUID = u('hr-test-hr').id;
const st = async (pr) => (await pr).status;
const not403 = (s) => s !== 403 && s !== 401;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const all = (await req(hr, 'GET', '/api/hr/employees')).json?.data || [];
  const outProfile = (all.find((e) => !(e.stores || []).some((s) => s.id === HRTEST)) || {}).profile_id;
  check('resolved out-of-scope employee profile', !!outProfile, null);

  // Fabricate warning + swap rows in each store for the row-store gate.
  const mkWarn = (store) => svc.from('hr_warnings').insert({ user_id: STAFF, issued_by: HRUID, level: 'verbal', reason: 'e2e scope', store_id: store }).select('id').single();
  const mkSwap = (store) => svc.from('hr_dayoff_swaps').insert({ store_id: store, requester_id: STAFF, requester_date: '2026-07-10', counterpart_id: STAFF9, counterpart_date: '2026-07-11', status: 'approved' }).select('id').single();
  const warnB = (await mkWarn(STORE_B)).data, warnH = (await mkWarn(HRTEST)).data;
  const swapB = (await mkSwap(STORE_B)).data, swapH = (await mkSwap(HRTEST)).data;
  check('fabricated warning + swap rows', !!warnB?.id && !!warnH?.id && !!swapB?.id && !!swapH?.id, null);
  const warnIds = [warnB?.id, warnH?.id].filter(Boolean);
  const swapIds = [swapB?.id, swapH?.id].filter(Boolean);

  try {
    // ── attendance list scope ──
    const mgrAtt = await req(mgr, 'GET', '/api/hr/attendance');
    check('mgr attendance 200 + only HRTEST punches', mgrAtt.status === 200 && (mgrAtt.json?.data || []).every((r) => r.store_id === HRTEST || r.store_id === null), mgrAtt.status);
    check('staff attendance → 403', (await st(req(staff, 'GET', '/api/hr/attendance'))) === 403, null);
    check('HR attendance → 200', (await st(req(hr, 'GET', '/api/hr/attendance'))) === 200, null);

    // ── timesheet override (gates on employee's stores) ──
    check('mgr override in-scope staff → 200', (await st(req(mgr, 'PUT', '/api/hr/timesheet/override', { user_id: STAFF, business_date: '2026-07-10', worked_min: 300, reason: 'e2e' }))) === 200, null);
    check('mgr override out-of-scope employee → 403', (await st(req(mgr, 'PUT', '/api/hr/timesheet/override', { user_id: outProfile, business_date: '2026-07-10', worked_min: 300, reason: 'e2e' }))) === 403, null);
    check('mgr delete override out-of-scope → 403', (await st(req(mgr, 'DELETE', `/api/hr/timesheet/override?user_id=${outProfile}&business_date=2026-07-10`))) === 403, null);
    check('mgr delete override in-scope staff → 200 (cleanup)', (await st(req(mgr, 'DELETE', `/api/hr/timesheet/override?user_id=${STAFF}&business_date=2026-07-10`))) === 200, null);

    // ── schedule acknowledge (per-store) ──
    check('mgr schedule-ack HRTEST → not 403', not403(await st(req(mgr, 'POST', '/api/hr/schedule/acknowledge', { store_id: HRTEST, month: '2026-07' }))), null);
    check('mgr schedule-ack storeB → 403', (await st(req(mgr, 'POST', '/api/hr/schedule/acknowledge', { store_id: STORE_B, month: '2026-07' }))) === 403, null);

    // ── warnings void (row store_id) ──
    check('mgr void HRTEST warning → not 403 (gate passes)', not403(await st(req(mgr, 'POST', `/api/hr/warnings/${warnH.id}/void`, { reason: 'e2e' }))), null);
    check('mgr void storeB warning → 403', (await st(req(mgr, 'POST', `/api/hr/warnings/${warnB.id}/void`, { reason: 'e2e' }))) === 403, null);
    check('mgr void nonexistent warning → 404', (await st(req(mgr, 'POST', '/api/hr/warnings/00000000-0000-0000-0000-000000000000/void', { reason: 'e2e' }))) === 404, null);

    // ── dayoff-swap ack (row store_id) ──
    check('mgr ack HRTEST swap → not 403 (gate passes)', not403(await st(req(mgr, 'POST', `/api/hr/dayoff-swaps/${swapH.id}/ack`))), null);
    check('mgr ack storeB swap → 403', (await st(req(mgr, 'POST', `/api/hr/dayoff-swaps/${swapB.id}/ack`))) === 403, null);
    check('staff ack HRTEST swap → 403', (await st(req(staff, 'POST', `/api/hr/dayoff-swaps/${swapH.id}/ack`))) === 403, null);
  } finally {
    await svc.from('hr_warnings').delete().in('id', warnIds);
    await svc.from('hr_dayoff_swaps').delete().in('id', swapIds);
    await svc.from('hr_timesheet_overrides').delete().eq('user_id', STAFF).eq('business_date', '2026-07-10');
  }

  process.exit(summary('HR_E2E_SCOPE_TIME') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_TIME ERROR', e); process.exit(1); });
