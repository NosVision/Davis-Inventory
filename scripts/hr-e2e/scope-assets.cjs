// P5.5 Tier-4 per-store scope e2e for locations (per-store geofence) + assets (holder's stores).
// locations: list→resolveHrScope filter, PUT→requireStoreManager. assets: list→holder-in-scope
// filter, [id] PUT→holder's stores (unassigned=company-HR). Proves a manager scoped to HRTEST
// acts only within HRTEST. Fabricates assets via service client; restores the HRTEST geofence.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STORE_B = 'c293344a-ffa9-4596-98fc-635ec0426f9e';
const STAFF = u('hr-test-staff').id;
const st = async (pr) => (await pr).status;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const all = (await req(hr, 'GET', '/api/hr/employees?limit=200')).json?.data || [];
  const outProfile = (all.find((e) => !(e.stores || []).some((s) => s.id === HRTEST)) || {}).profile_id;
  check('resolved out-of-scope employee', !!outProfile, null);

  // Fabricate assets: held by HRTEST staff, held by out-of-scope employee, unassigned (pool).
  await svc.from('hr_assets').delete().ilike('name', 'e2e-scope-%');
  const mk = (name, holder, status) => svc.from('hr_assets').insert({ name, holder_id: holder, status, value_satang: 100000 }).select('id').single();
  const aH = (await mk('e2e-scope-hrtest', STAFF, 'issued')).data;
  const aO = (await mk('e2e-scope-out', outProfile, 'issued')).data;
  const aU = (await mk('e2e-scope-unassigned', null, 'in_stock')).data;
  check('fabricated 3 assets', !!aH?.id && !!aO?.id && !!aU?.id, null);

  // Snapshot HRTEST geofence for restore.
  const geo0 = ((await req(hr, 'GET', '/api/hr/locations')).json?.data || []).find((l) => l.store_id === HRTEST) || {};

  try {
    // ── locations list ──
    const mgrLoc = await req(mgr, 'GET', '/api/hr/locations');
    check('mgr locations 200 + only HRTEST', mgrLoc.status === 200 && (mgrLoc.json?.data || []).every((l) => l.store_id === HRTEST) && (mgrLoc.json?.data || []).length >= 1, mgrLoc.status);
    const hrLoc = (await req(hr, 'GET', '/api/hr/locations')).json?.data || [];
    check('HR locations sees > 1 store', hrLoc.length > 1, hrLoc.length);
    check('staff locations → 403', (await st(req(staff, 'GET', '/api/hr/locations'))) === 403, null);

    // ── locations PUT ──
    check('mgr PUT geofence HRTEST → 200', (await st(req(mgr, 'PUT', '/api/hr/locations', { store_id: HRTEST, lat: 13.7, lng: 100.5, radius_m: 150 }))) === 200, null);
    check('mgr PUT geofence storeB → 403', (await st(req(mgr, 'PUT', '/api/hr/locations', { store_id: STORE_B, lat: 13.7, lng: 100.5, radius_m: 150 }))) === 403, null);

    // ── assets list ──
    const mgrAssets = (await req(mgr, 'GET', '/api/hr/assets')).json?.data || [];
    check('mgr assets = only HRTEST-held (incl fabricated H, not O/U)', mgrAssets.some((a) => a.id === aH.id) && !mgrAssets.some((a) => a.id === aO.id) && !mgrAssets.some((a) => a.id === aU.id), null);
    const hrAssets = (await req(hr, 'GET', '/api/hr/assets')).json?.data || [];
    check('HR assets includes all three', ['e2e-scope-hrtest', 'e2e-scope-out', 'e2e-scope-unassigned'].every((n) => hrAssets.some((a) => a.name === n)), null);
    check('staff assets → 403', (await st(req(staff, 'GET', '/api/hr/assets'))) === 403, null);

    // ── assets [id] PUT ──
    check('mgr PUT HRTEST-held asset → 200', (await st(req(mgr, 'PUT', `/api/hr/assets/${aH.id}`, { notes: 'e2e' }))) === 200, null);
    check('mgr PUT out-of-scope-held asset → 403', (await st(req(mgr, 'PUT', `/api/hr/assets/${aO.id}`, { notes: 'e2e' }))) === 403, null);
    check('mgr PUT unassigned (pool) asset → 403', (await st(req(mgr, 'PUT', `/api/hr/assets/${aU.id}`, { notes: 'e2e' }))) === 403, null);
    check('HR PUT unassigned asset → 200', (await st(req(hr, 'PUT', `/api/hr/assets/${aU.id}`, { notes: 'e2e' }))) === 200, null);
  } finally {
    await svc.from('hr_assets').delete().ilike('name', 'e2e-scope-%');
    // Restore the HRTEST geofence if it had one.
    if (geo0.lat != null) await req(hr, 'PUT', '/api/hr/locations', { store_id: HRTEST, lat: geo0.lat, lng: geo0.lng, radius_m: geo0.radius_m });
  }

  process.exit(summary('HR_E2E_SCOPE_ASSETS') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_ASSETS ERROR', e); process.exit(1); });
