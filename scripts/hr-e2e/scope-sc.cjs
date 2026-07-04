// P5.5 Tier-1 per-store scope e2e for the Service Charge family (§H). SC pools always carry a
// store_id, so every route gates via requireStoreManager(pool.store_id). Proves a manager scoped
// to HRTEST reaches ONLY HRTEST pools — 403 on another store's pool across read/pool-write/
// allocations/recompute/deductions/finalize; company HR reaches both; staff 403. Deletes both
// pools (cascade) in finally.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc'; // manager scoped here
const STORE_B = 'c293344a-ffa9-4596-98fc-635ec0426f9e'; // manager NOT scoped here
const MONTH = '2026-07-01';
const STAFF = u('hr-test-staff').id;
const st = async (pr) => (await pr).status;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const mgr = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // Clean any pre-existing pools for a deterministic baseline.
  await svc.from('hr_sc_pools').delete().in('store_id', [HRTEST, STORE_B]).eq('period_month', MONTH);

  try {
    // HR (company-wide) creates a pool for each store + one allocation each.
    const poolA = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH, total_satang: 5_000_000 })).json?.data;
    const poolB = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: STORE_B, period_month: MONTH, total_satang: 5_000_000 })).json?.data;
    check('HR created both store pools', !!poolA?.id && !!poolB?.id, { a: poolA?.id, b: poolB?.id });
    const allocA = ((await req(hr, 'PUT', `/api/hr/service-charge/${poolA.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: 1_000_000 }] })).json?.data || [])[0];
    const allocB = ((await req(hr, 'PUT', `/api/hr/service-charge/${poolB.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: 1_000_000 }] })).json?.data || [])[0];
    check('HR allocated in both pools', !!allocA?.id && !!allocB?.id, null);

    // ── GET read ──
    check('mgr GET HRTEST → 200', (await st(req(mgr, 'GET', `/api/hr/service-charge?store_id=${HRTEST}&period_month=${MONTH}`))) === 200, null);
    check('mgr GET storeB → 403', (await st(req(mgr, 'GET', `/api/hr/service-charge?store_id=${STORE_B}&period_month=${MONTH}`))) === 403, null);
    check('staff GET HRTEST → 403', (await st(req(staff, 'GET', `/api/hr/service-charge?store_id=${HRTEST}&period_month=${MONTH}`))) === 403, null);
    check('HR GET storeB → 200', (await st(req(hr, 'GET', `/api/hr/service-charge?store_id=${STORE_B}&period_month=${MONTH}`))) === 200, null);

    // ── PUT pool ──
    check('mgr PUT pool HRTEST → 200', (await st(req(mgr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH, total_satang: 6_000_000 }))) === 200, null);
    check('mgr PUT pool storeB → 403', (await st(req(mgr, 'PUT', '/api/hr/service-charge', { store_id: STORE_B, period_month: MONTH, total_satang: 6_000_000 }))) === 403, null);

    // ── allocations ──
    check('mgr PUT alloc HRTEST → 200', (await st(req(mgr, 'PUT', `/api/hr/service-charge/${poolA.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: 900_000 }] }))) === 200, null);
    check('mgr PUT alloc storeB → 403', (await st(req(mgr, 'PUT', `/api/hr/service-charge/${poolB.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: 900_000 }] }))) === 403, null);

    // ── recompute ──
    check('mgr recompute HRTEST → 200', (await st(req(mgr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`))) === 200, null);
    check('mgr recompute storeB → 403', (await st(req(mgr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`))) === 403, null);

    // ── add manual deduction ──
    check('mgr add deduction HRTEST alloc → 201', (await st(req(mgr, 'POST', `/api/hr/service-charge/allocations/${allocA.id}/deductions`, { label: 'x', amount_satang: 1000 }))) === 201, null);
    check('mgr add deduction storeB alloc → 403', (await st(req(mgr, 'POST', `/api/hr/service-charge/allocations/${allocB.id}/deductions`, { label: 'x', amount_satang: 1000 }))) === 403, null);

    // ── delete deduction ── (create one in each pool as HR, then mgr tries to delete)
    const dedA = (await req(hr, 'POST', `/api/hr/service-charge/allocations/${allocA.id}/deductions`, { label: 'del-A', amount_satang: 500 })).json?.data;
    const dedB = (await req(hr, 'POST', `/api/hr/service-charge/allocations/${allocB.id}/deductions`, { label: 'del-B', amount_satang: 500 })).json?.data;
    check('mgr delete HRTEST deduction → 200', (await st(req(mgr, 'DELETE', `/api/hr/service-charge/deductions/${dedA.id}`))) === 200, null);
    check('mgr delete storeB deduction → 403', (await st(req(mgr, 'DELETE', `/api/hr/service-charge/deductions/${dedB.id}`))) === 403, null);

    // ── finalize ──
    check('mgr finalize storeB pool → 403', (await st(req(mgr, 'POST', `/api/hr/service-charge/${poolB.id}/finalize`))) === 403, null);
    check('mgr finalize HRTEST pool → 200 (allowed)', (await st(req(mgr, 'POST', `/api/hr/service-charge/${poolA.id}/finalize`))) === 200, null);
  } finally {
    await svc.from('hr_sc_pools').delete().in('store_id', [HRTEST, STORE_B]).eq('period_month', MONTH);
  }

  process.exit(summary('HR_E2E_SCOPE_SC') ? 0 : 1);
})().catch((e) => { console.error('SCOPE_SC ERROR', e); process.exit(1); });
