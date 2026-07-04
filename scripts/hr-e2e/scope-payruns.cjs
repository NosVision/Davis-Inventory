// P5.5 Tier-1 per-store scope e2e for the payruns family. Proves requireHrManagerForStore:
// a manager scoped to HRTEST (hr_manager_scopes, no can_manage_hr) reaches ONLY HRTEST-scoped
// payruns — 403 on a company-wide (NULL-store) run and on another store's run; company-wide HR
// still reaches everything; staff 403. Covers detail / generate / list / finalize / reopen.
// Creates two store-scoped payruns and deletes them (cascade) in finally. Each request is issued
// exactly once (payrun generation is heavy — avoid needless churn).
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc'; // manager is scoped here
const STORE_B = 'c293344a-ffa9-4596-98fc-635ec0426f9e'; // a real store the manager is NOT scoped to
const YEAR = 2026, MONTH = 7;
const gen = (sess, storeId) => req(sess, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH, ...(storeId ? { store_id: storeId } : {}) });
const detail = (sess, id) => req(sess, 'GET', `/api/hr/payruns/${id}`);
const status = async (pr) => (await pr).status;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  let hrtestId = null, storeBId = null, companyWideId = null;
  try {
    companyWideId = (await gen(hr, null)).json?.data?.id;
    hrtestId = (await gen(hr, HRTEST)).json?.data?.id;
    storeBId = (await gen(hr, STORE_B)).json?.data?.id;
    check('HR generated company-wide + HRTEST + storeB runs', !!companyWideId && !!hrtestId && !!storeBId, { companyWideId, hrtestId, storeBId });

    // ── detail gate ──
    check('HR detail company-wide 200', (await status(detail(hr, companyWideId))) === 200, null);
    check('HR detail HRTEST 200', (await status(detail(hr, hrtestId))) === 200, null);
    check('HR detail storeB 200', (await status(detail(hr, storeBId))) === 200, null);
    const mgrHrtest = await status(detail(mgr, hrtestId));
    check('scoped mgr detail HRTEST → 200', mgrHrtest === 200, mgrHrtest);
    const mgrCompany = await status(detail(mgr, companyWideId));
    check('scoped mgr detail company-wide → 403 (NULL = full-HR only)', mgrCompany === 403, mgrCompany);
    const mgrStoreB = await status(detail(mgr, storeBId));
    check('scoped mgr detail storeB → 403 (cross-store)', mgrStoreB === 403, mgrStoreB);
    const staffHrtest = await status(detail(staff, hrtestId));
    check('staff detail HRTEST → 403', staffHrtest === 403, staffHrtest);

    // ── generate gate ──
    const mgrGenHrtest = await status(gen(mgr, HRTEST));
    check('scoped mgr generate HRTEST → 200 (allowed)', mgrGenHrtest === 200, mgrGenHrtest);
    const mgrGenB = await status(gen(mgr, STORE_B));
    check('scoped mgr generate storeB → 403 (cross-store)', mgrGenB === 403, mgrGenB);
    const mgrGenCompany = await status(gen(mgr, null));
    check('scoped mgr generate company-wide → 403', mgrGenCompany === 403, mgrGenCompany);
    const staffGen = await status(gen(staff, HRTEST));
    check('staff generate HRTEST → 403', staffGen === 403, staffGen);

    // ── list scope ──
    const mgrRuns = (await req(mgr, 'GET', '/api/hr/payruns')).json?.data || [];
    check('scoped mgr list = only HRTEST-scoped runs', mgrRuns.length > 0 && mgrRuns.every((r) => r.store_id === HRTEST), mgrRuns.map((r) => r.store_id));
    const hrRuns = (await req(hr, 'GET', '/api/hr/payruns')).json?.data || [];
    check('HR list sees beyond HRTEST (company-wide/other stores)', hrRuns.some((r) => r.store_id === null || (r.store_id && r.store_id !== HRTEST)), hrRuns.length);

    // ── finalize / reopen gate (auth fires before the empty-payrun / status logic) ──
    const mgrFinB = await status(req(mgr, 'POST', `/api/hr/payruns/${storeBId}/finalize`));
    check('scoped mgr finalize storeB → 403 (not 409)', mgrFinB === 403, mgrFinB);
    const mgrFinCompany = await status(req(mgr, 'POST', `/api/hr/payruns/${companyWideId}/finalize`));
    check('scoped mgr finalize company-wide → 403', mgrFinCompany === 403, mgrFinCompany);
    const hrFinB = await status(req(hr, 'POST', `/api/hr/payruns/${storeBId}/finalize`));
    check('HR finalize storeB passes gate → 409 empty (not 403)', hrFinB === 409, hrFinB);
    const mgrReopen = await status(req(mgr, 'POST', `/api/hr/payruns/${companyWideId}/reopen`, { reason: 'x' }));
    check('scoped mgr reopen company-wide → 403', mgrReopen === 403, mgrReopen);
  } finally {
    for (const idv of [hrtestId, storeBId]) if (idv) await svc.from('hr_payruns').delete().eq('id', idv);
  }

  process.exit(summary('HR_E2E_SCOPE_PAYRUNS') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_PAYRUNS ERROR', e); process.exit(1); });
