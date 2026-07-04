// §P5.3 daily dashboard endpoint — live-auth e2e. HR sees company-wide headcount; a store manager
// sees only their scope (subset); buckets partition the headcount; validation + staff lockout.
const { login, req, creds, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // HR company-wide
  const r = await req(hr, 'GET', '/api/hr/dashboard/daily');
  check('HR daily 200', r.status === 200, `status=${r.status} ${(r.text || '').slice(0, 120)}`);
  const d = r.json?.data;
  check('has buckets + headcount', d && Array.isArray(d.checked_in) && Array.isArray(d.on_leave) && Array.isArray(d.not_in) && typeof d.headcount === 'number', d);
  check('headcount > 0 (active employees exist)', (d?.headcount ?? 0) > 0, d?.headcount);
  const sum = (d?.checked_in.length ?? 0) + (d?.on_leave.length ?? 0) + (d?.not_in.length ?? 0);
  check('buckets partition headcount (in+leave+notin == headcount)', sum === d?.headcount, `sum=${sum} headcount=${d?.headcount}`);
  check('business_date echoed (YYYY-MM-DD)', /^\d{4}-\d{2}-\d{2}$/.test(d?.business_date || ''), d?.business_date);

  // explicit past date still valid
  const past = await req(hr, 'GET', '/api/hr/dashboard/daily?business_date=2026-01-15');
  check('HR daily past date 200', past.status === 200, past.status);

  // validation
  const bad = await req(hr, 'GET', '/api/hr/dashboard/daily?business_date=15-01-2026');
  check('invalid business_date 400', bad.status === 400, bad.status);

  // scoped manager: subset of company headcount, still a valid partition
  const m = await req(mgr, 'GET', '/api/hr/dashboard/daily');
  check('manager daily 200', m.status === 200, m.status);
  const md = m.json?.data;
  check('manager headcount <= company headcount (scoped)', (md?.headcount ?? 0) <= (d?.headcount ?? 0), `mgr=${md?.headcount} co=${d?.headcount}`);
  const msum = (md?.checked_in.length ?? 0) + (md?.on_leave.length ?? 0) + (md?.not_in.length ?? 0);
  check('manager buckets partition headcount', msum === md?.headcount, `sum=${msum} headcount=${md?.headcount}`);

  // staff has no HR scope → blocked
  const s = await req(staff, 'GET', '/api/hr/dashboard/daily');
  check('staff daily FORBIDDEN (401/403)', s.status === 401 || s.status === 403, s.status);

  process.exit(summary('HR_E2E_DASHBOARD') ? 0 : 1);
})().catch((e) => { console.error('DASHBOARD ERROR', e); process.exit(1); });
