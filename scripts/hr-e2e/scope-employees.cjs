// P5.5 Tier-2 per-store scope e2e for the employee family. Employees relate to stores via
// user_stores (not a direct store_id), so routes gate via requireHrManagerForEmployeeId /
// resolveHrScope. Proves a manager scoped to HRTEST reaches only employees whose user_stores
// include HRTEST — 403 on an out-of-store employee across detail/PUT/tax-allowances/recurring,
// and the list is store-filtered. Read-only except one no-op PUT. Company HR reaches all.
const { login, req, creds, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STAFF = u('hr-test-staff').id;
const st = async (pr) => (await pr).status;

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // HR view = all company employees (enriched with .stores). Pick one in HRTEST + one not.
  const all = (await req(hr, 'GET', '/api/hr/employees?limit=200')).json?.data || [];
  const inScope = all.find((e) => e.profile_id === STAFF);
  const outScope = all.find((e) => !(e.stores || []).some((s) => s.id === HRTEST));
  check('resolved in-scope (staff) + out-of-scope employees', !!inScope?.id && !!outScope?.id, { in: inScope?.id, out: outScope?.id });

  // ── employees/[id] detail ──
  check('mgr GET in-scope employee → 200', (await st(req(mgr, 'GET', `/api/hr/employees/${inScope.id}`))) === 200, null);
  check('mgr GET out-of-scope employee → 403', (await st(req(mgr, 'GET', `/api/hr/employees/${outScope.id}`))) === 403, null);
  check('staff GET employee detail → 403', (await st(req(staff, 'GET', `/api/hr/employees/${inScope.id}`))) === 403, null);
  check('HR GET out-of-scope employee → 200', (await st(req(hr, 'GET', `/api/hr/employees/${outScope.id}`))) === 200, null);

  // ── employees/[id] PUT (no-op value on an in-scope employee; 403 on out-of-scope) ──
  const curHours = inScope.work_hours_per_day ?? 8;
  check('mgr PUT in-scope employee → 200', (await st(req(mgr, 'PUT', `/api/hr/employees/${inScope.id}`, { work_hours_per_day: curHours }))) === 200, null);
  check('mgr PUT out-of-scope employee → 403', (await st(req(mgr, 'PUT', `/api/hr/employees/${outScope.id}`, { work_hours_per_day: 8 }))) === 403, null);

  // ── tax-allowances (employee-level PII) ──
  check('mgr GET in-scope tax-allowances → 200', (await st(req(mgr, 'GET', `/api/hr/employees/${inScope.id}/tax-allowances`))) === 200, null);
  check('mgr GET out-of-scope tax-allowances → 403', (await st(req(mgr, 'GET', `/api/hr/employees/${outScope.id}/tax-allowances`))) === 403, null);

  // ── recurring pay items ──
  check('mgr GET in-scope recurring → 200', (await st(req(mgr, 'GET', `/api/hr/employees/${inScope.id}/recurring`))) === 200, null);
  check('mgr GET out-of-scope recurring → 403', (await st(req(mgr, 'GET', `/api/hr/employees/${outScope.id}/recurring`))) === 403, null);

  // ── list scope ──
  const mgrList = (await req(mgr, 'GET', '/api/hr/employees?limit=200')).json?.data || [];
  check('scoped mgr list = only HRTEST employees', mgrList.length > 0 && mgrList.every((e) => (e.stores || []).some((s) => s.id === HRTEST)), mgrList.length);
  check('scoped mgr list EXCLUDES out-of-scope employee', !mgrList.some((e) => e.id === outScope.id), null);
  check('HR list INCLUDES out-of-scope employee', all.some((e) => e.id === outScope.id) && all.length > mgrList.length, { all: all.length, mgr: mgrList.length });
  check('staff GET employees list → 403', (await st(req(staff, 'GET', '/api/hr/employees'))) === 403, null);

  process.exit(summary('HR_E2E_SCOPE_EMPLOYEES') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_EMPLOYEES ERROR', e); process.exit(1); });
