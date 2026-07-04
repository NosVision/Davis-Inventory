// eval→SC bridge live e2e (§G↔§H): a NEGATIVE eval payout becomes an auto SC deduction via
// POST /api/hr/eval/periods/[id]/apply-sc. Scores an employee LOW → tiered rule yields a negative
// payout → apply-sc inserts an hr_sc_deductions row (source_type='eval') against that month's SC
// allocation, reducing net SC. Verifies value + idempotency + guard. Deletes period + pool.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const MONTH = '2026-07-01';
const EMP = u('hr-test-staff').id;      // scored employee (SC allocation holder)
const EVAL1 = u('hr-test-manager').id;  // evaluator
const ALLOC = 1_000_000, DED = 20_000;  // negative payout 20k ≤ allocation → deduction 20k, net 980k
const P = (id, s) => `/api/hr/eval/periods/${id}${s}`;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const eval1 = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // Clean any prior SC pool / eval period for a deterministic baseline.
  await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).eq('period_month', MONTH);
  await svc.from('hr_eval_periods').delete().eq('title', 'e2e apply-sc');

  let periodId = null;
  try {
    // SC pool + allocation for the employee.
    const pool = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH, total_satang: 5_000_000 })).json?.data;
    await req(hr, 'PUT', `/api/hr/service-charge/${pool.id}/allocations`, { allocations: [{ user_id: EMP, allocated_satang: ALLOC }] });
    check('SC pool + allocation created', !!pool?.id, null);

    // Eval period → score LOW (20%) → compute.
    const mk = await req(hr, 'POST', '/api/hr/eval/periods', { title: 'e2e apply-sc', period_month: MONTH });
    periodId = mk.json?.data?.id;
    const criteria = (await req(hr, 'GET', P(periodId, '/criteria'))).json?.data || [];
    const asg = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EVAL1, employee_id: EMP });
    await req(hr, 'PATCH', '/api/hr/eval/periods', { id: periodId, status: 'open' });
    await req(eval1, 'POST', '/api/hr/ess/eval/score', { assignment_id: asg.json?.data?.id, scores: criteria.map((c) => ({ criterion_id: c.id, points: Math.round(c.max_points * 0.2) })), submit: true });
    check('compute 200', (await req(hr, 'POST', P(periodId, '/compute'))).status === 200, null);

    // Tiered payout rule: low band (0–50%) = −20,000 (a deduction).
    const rule = await req(hr, 'PUT', P(periodId, '/payout-rule'), { formula_type: 'tiered', tiers: [
      { min_pct: 0, max_pct: 50, amount_satang: -DED, label: 'low', sort_order: 0 },
      { min_pct: 51, max_pct: 100, amount_satang: 0, label: 'ok', sort_order: 1 },
    ] });
    check('tiered payout rule 200', rule.status === 200, `status=${rule.status} ${(rule.text || '').slice(0, 140)}`);
    const pay = await req(hr, 'POST', P(periodId, '/payouts'));
    check('compute payouts 200', pay.status === 200, pay.status);
    const payout = (await req(hr, 'GET', P(periodId, '/payouts'))).json?.data?.find((x) => x.result?.employee_id === EMP);
    check('payout is negative (−20k)', payout?.amount_satang === -DED, payout?.amount_satang);

    // Apply → SC deduction.
    const apply = await req(hr, 'POST', P(periodId, '/apply-sc'));
    check('apply-sc 200 applied=1', apply.status === 200 && apply.json?.data?.applied === 1, apply.json?.data || apply.status);

    // Verify the SC allocation now carries an 'eval' deduction reducing net.
    const sc = await req(hr, 'GET', `/api/hr/service-charge?store_id=${HRTEST}&period_month=${MONTH}`);
    const alloc = (sc.json?.data?.allocations || []).find((a) => a.user_id === EMP);
    const evalDed = (alloc?.deductions || []).filter((d) => d.source_type === 'eval');
    check('one eval SC deduction on the allocation', evalDed.length === 1, evalDed.map((d) => d.source_type));
    check('eval deduction amount = 20k', evalDed[0]?.amount_satang === DED, evalDed[0]?.amount_satang);
    check('net SC reduced to allocated − 20k (980k)', alloc?.net_satang === ALLOC - DED, alloc?.net_satang);

    // Idempotent: applying again clears + re-inserts (still exactly one eval deduction).
    const apply2 = await req(hr, 'POST', P(periodId, '/apply-sc'));
    check('re-apply-sc 200 applied=1 (idempotent)', apply2.status === 200 && apply2.json?.data?.applied === 1, apply2.json?.data);
    const sc2 = await req(hr, 'GET', `/api/hr/service-charge?store_id=${HRTEST}&period_month=${MONTH}`);
    const alloc2 = (sc2.json?.data?.allocations || []).find((a) => a.user_id === EMP);
    check('still exactly one eval deduction after re-apply', (alloc2?.deductions || []).filter((d) => d.source_type === 'eval').length === 1, null);

    // Guard: staff cannot apply-sc.
    check('staff apply-sc FORBIDDEN', (await req(staff, 'POST', P(periodId, '/apply-sc'))).status === 403 || (await req(staff, 'POST', P(periodId, '/apply-sc'))).status === 401, null);
  } finally {
    if (periodId) await svc.from('hr_eval_periods').delete().eq('id', periodId);
    await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).eq('period_month', MONTH);
  }

  process.exit(summary('HR_E2E_EVAL_APPLY_SC') ? 0 : 1);
})().catch((e) => { console.error('EVAL_APPLY_SC ERROR', e); process.exit(1); });
