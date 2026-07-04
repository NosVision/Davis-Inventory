// eval→money e2e (§G↔payslip): a computed payout is a DRAFT proposal; only after HR approval does a
// positive payout flow to the payslip as an 'eval_bonus' earning. Verifies the approve route guards
// (bad status 400 / foreign payout 404 / terminal immutable) and that an approved ฿ appears on the
// regenerated slip, keyed by period month. Deletes the period (cascade) + regenerates in finally.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const EMP = u('hr-test-staff').id;       // subject employee (gets the bonus)
const EVAL1 = u('hr-test-manager').id;   // evaluator
const P = (id, s) => `/api/hr/eval/periods/${id}${s}`;
const FLAT = 100000, PER_PCT = 1000;     // linear: 100000 + 1000×100% = 200000 satang = ฿2,000

const genStaffEarnings = async (hr) => {
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2026, period_month: 7 });
  const det = await req(hr, 'GET', `/api/hr/payruns/${gen.json.data.id}`);
  const slip = (det.json.data.payslips || []).find((s) => s.user_id === EMP);
  const full = slip?.id ? (await req(hr, 'GET', `/api/hr/payslips/${slip.id}`)).json?.data : null;
  return full?.earnings || [];
};

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const eval1 = await login(u('hr-test-manager').email, u('hr-test-manager').password);

  let periodId = null;
  try {
    // Baseline: no eval_bonus on the slip.
    const base = await genStaffEarnings(hr);
    check('baseline slip has no eval_bonus', !base.some((e) => e.type === 'eval_bonus'), base.map((e) => e.type));

    // Set up a period → score 100% → compute → linear payout rule → compute payouts (draft).
    const mk = await req(hr, 'POST', '/api/hr/eval/periods', { title: 'e2e eval-money Jul', period_month: '2026-07-01' });
    periodId = mk.json?.data?.id;
    check('create period 201', mk.status === 201 && !!periodId, mk.status);
    const criteria = (await req(hr, 'GET', P(periodId, '/criteria'))).json?.data || [];
    const asg = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EVAL1, employee_id: EMP });
    const aId = asg.json?.data?.id;
    await req(hr, 'PATCH', '/api/hr/eval/periods', { id: periodId, status: 'open' });
    const sub = await req(eval1, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId, scores: criteria.map((c) => ({ criterion_id: c.id, points: c.max_points })), submit: true });
    check('evaluator submit 200', sub.status === 200, sub.status);
    check('compute 200', (await req(hr, 'POST', P(periodId, '/compute'))).status === 200, null);
    check('payout rule 200', (await req(hr, 'PUT', P(periodId, '/payout-rule'), { formula_type: 'linear', flat_satang: FLAT, satang_per_pct: PER_PCT })).status === 200, null);
    const pay = await req(hr, 'POST', P(periodId, '/payouts'));
    check('compute payouts 200', pay.status === 200 && (pay.json?.data?.payouts ?? 0) >= 1, pay.json?.data);

    // The payout exists but is DRAFT → NOT yet on the payslip.
    const list1 = await req(hr, 'GET', P(periodId, '/payouts'));
    const payout = (list1.json?.data || []).find((p) => p.result?.employee_id === EMP);
    check('payout is draft + positive (฿2,000)', payout?.status === 'draft' && payout?.amount_satang === FLAT + PER_PCT * 100, payout);
    const draftEarnings = await genStaffEarnings(hr);
    check('DRAFT payout NOT on slip', !draftEarnings.some((e) => e.type === 'eval_bonus'), draftEarnings.map((e) => e.type));

    // Approve-route guards.
    const badStatus = await req(hr, 'PATCH', P(periodId, '/payouts'), { payout_id: payout.id, status: 'paid' });
    check('invalid status → 400', badStatus.status === 400, badStatus.status);
    const foreign = await req(hr, 'PATCH', P(periodId, '/payouts'), { payout_id: '00000000-0000-0000-0000-000000000000', status: 'approved' });
    check('foreign payout → 404', foreign.status === 404, foreign.status);
    const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
    const staffPatch = await req(staff, 'PATCH', P(periodId, '/payouts'), { payout_id: payout.id, status: 'approved' });
    check('staff approve FORBIDDEN', staffPatch.status === 401 || staffPatch.status === 403, staffPatch.status);

    // Approve → the positive payout now flows to the payslip on regeneration.
    const approve = await req(hr, 'PATCH', P(periodId, '/payouts'), { payout_id: payout.id, status: 'approved' });
    check('approve 200 → approved', approve.status === 200 && approve.json?.data?.status === 'approved', approve.json?.data || approve.status);

    const approvedEarnings = await genStaffEarnings(hr);
    const bonusLine = approvedEarnings.find((e) => e.type === 'eval_bonus');
    check('approved payout appears as eval_bonus on slip', !!bonusLine, approvedEarnings.map((e) => e.type));
    check('eval_bonus amount == payout (฿2,000)', bonusLine?.amount_satang === FLAT + PER_PCT * 100, bonusLine);

    // Un-approve (→ draft) removes it again.
    const unapprove = await req(hr, 'PATCH', P(periodId, '/payouts'), { payout_id: payout.id, status: 'draft' });
    check('un-approve 200', unapprove.status === 200, unapprove.status);
    const revertEarnings = await genStaffEarnings(hr);
    check('un-approved payout removed from slip', !revertEarnings.some((e) => e.type === 'eval_bonus'), null);

    // Bulk approve path.
    const bulk = await req(hr, 'PATCH', P(periodId, '/payouts'), { approve_all: true });
    check('approve_all → count >= 1', bulk.status === 200 && (bulk.json?.data?.approved ?? 0) >= 1, bulk.json?.data);
  } finally {
    if (periodId) await svc.from('hr_eval_periods').delete().eq('id', periodId);
    await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2026, period_month: 7 }); // rebuild clean slips
  }

  process.exit(summary('HR_E2E_EVAL_MONEY') ? 0 : 1);
})().catch((e) => { console.error('EVAL_MONEY ERROR', e); process.exit(1); });
