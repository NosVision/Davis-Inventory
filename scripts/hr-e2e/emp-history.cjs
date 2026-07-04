// P1.5 employee salary/position history — live-auth e2e. Edit an employee's rate (with reason) →
// the history endpoint surfaces the from→to change, actor, and reason. Staff is locked out.
// Self-restoring: puts the original rate back at the end.
const { login, req, creds, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // Find hr-test-staff's employee row (has id = hr_employees.id).
  const list = await req(hr, 'GET', `/api/hr/employees?limit=200`);
  const emp = (list.json?.data || []).find((e) => e.profile_id === u('hr-test-staff').id);
  check('found employee row', !!emp && !!emp.id, emp && emp.id);
  const empId = emp.id;
  const origRate = emp.rate_satang;

  let restored = false;
  try {
    const newRate = origRate + 100000; // +1,000 THB
    const put = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: newRate, reason: 'e2e-history-raise' });
    check('edit rate 200', put.status === 200, `status=${put.status} ${(put.text || '').slice(0, 120)}`);

    const hist = await req(hr, 'GET', `/api/hr/employees/${empId}/history`);
    check('history 200', hist.status === 200, hist.status);
    const events = hist.json?.data || [];
    check('history has >=1 event', events.length >= 1, events.length);
    const latest = events[0];
    const rateChange = (latest?.changes || []).find((c) => c.field === 'rate_satang');
    check('latest event has rate_satang change', !!rateChange, latest?.changes);
    check('change from = original rate', String(rateChange?.from) === String(origRate), `from=${rateChange?.from} orig=${origRate}`);
    check('change to = new rate', String(rateChange?.to) === String(newRate), `to=${rateChange?.to} new=${newRate}`);
    check('event carries reason', latest?.reason === 'e2e-history-raise', latest?.reason);
    check('event carries actor name', typeof latest?.actor_name === 'string' && latest.actor_name !== '', latest?.actor_name);

    const staffTry = await req(staff, 'GET', `/api/hr/employees/${empId}/history`);
    check('staff history FORBIDDEN (401/403)', staffTry.status === 401 || staffTry.status === 403, staffTry.status);

    // restore
    const back = await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: origRate, reason: 'e2e-history-restore' });
    restored = back.status === 200;
    check('restore original rate 200', restored, back.status);
  } finally {
    if (!restored) await req(hr, 'PUT', `/api/hr/employees/${empId}`, { rate_satang: origRate, reason: 'e2e-history-restore' });
  }

  process.exit(summary('HR_E2E_EMP_HISTORY') ? 0 : 1);
})().catch((e) => { console.error('EMP_HISTORY ERROR', e); process.exit(1); });
