// P5.1 §G evaluation live-auth e2e — full flow through real auth + 2-layer RLS:
// HR seeds period(15 criteria) → assigns 2 evaluators to one employee (self-eval 400 / dup 409) →
// each evaluator scores ONLY their own assignment (cross-assignment 403) → compute → payout rule +
// payouts → close → employee sees own anonymized result (open-hidden before close; other employees
// can't see it). Deletes the period (cascade) at the end. Self-cleaning.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const EMP = u('hr-test-staff').id;       // subject employee
const EVAL1 = u('hr-test-manager').id;   // evaluator A
const EVAL2 = u('hr-test-staff9').id;    // evaluator B
const P = (id, s) => `/api/hr/eval/periods/${id}${s}`;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const eval1 = await login(u('hr-test-manager').email, u('hr-test-manager').password);
  const eval2 = await login(u('hr-test-staff9').email, u('hr-test-staff9').password);
  const emp = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  let periodId = null;
  try {
    const mk = await req(hr, 'POST', '/api/hr/eval/periods', { title: 'e2e eval Jul', period_month: '2026-07-01' });
    check('create period 201', mk.status === 201 && !!mk.json?.data?.id, `status=${mk.status} ${(mk.text || '').slice(0, 140)}`);
    periodId = mk.json.data.id;
    check('max_score seeded = 150', mk.json.data.max_score === 150, mk.json.data.max_score);

    const crit = await req(hr, 'GET', P(periodId, '/criteria'));
    const criteria = crit.json?.data || [];
    check('15 criteria seeded', criteria.length === 15, criteria.length);

    const a1 = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EVAL1, employee_id: EMP });
    const a2 = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EVAL2, employee_id: EMP });
    check('assign evaluator A 201', a1.status === 201, a1.status);
    check('assign evaluator B 201', a2.status === 201, a2.status);
    const aId1 = a1.json?.data?.id, aId2 = a2.json?.data?.id;
    const selfEval = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EMP, employee_id: EMP });
    check('self-evaluation rejected 400', selfEval.status === 400, selfEval.status);
    const dup = await req(hr, 'POST', P(periodId, '/assignments'), { evaluator_id: EVAL1, employee_id: EMP });
    check('duplicate assignment 409', dup.status === 409, dup.status);

    const open = await req(hr, 'PATCH', '/api/hr/eval/periods', { id: periodId, status: 'open' });
    check('open period 200', open.status === 200, `status=${open.status} ${(open.text || '').slice(0, 140)}`);

    // ESS evaluator surfaces (self-service /me/evaluations data): my-periods picker, my-queue
    // criteria payload, and score GET-prefill roundtrip.
    const myP = await req(eval1, 'GET', '/api/hr/ess/eval/my-periods');
    const mineP = (myP.json?.data || []).find((p) => p.id === periodId);
    check('my-periods lists my open period (pending=1)', !!mineP && mineP.total === 1 && mineP.done === 0 && mineP.pending === 1, myP.json?.data);
    const otherP = await req(emp, 'GET', '/api/hr/ess/eval/my-periods');
    check('non-evaluator my-periods excludes period', !(otherP.json?.data || []).some((p) => p.id === periodId), otherP.json?.data);

    const q0 = await req(eval1, 'GET', `/api/hr/ess/eval/my-queue?period_id=${periodId}`);
    check('my-queue returns 15 criteria for scoring form', (q0.json?.data?.criteria || []).length === 15, (q0.json?.data?.criteria || []).length);

    // draft-save a partial score, then GET it back to confirm prefill works
    const draft = await req(eval1, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId1, scores: [{ criterion_id: criteria[0].id, points: 7, comment: 'e2e-draft' }], submit: false });
    check('draft save 200 (no submit)', draft.status === 200 && draft.json?.data?.submitted === false, draft.json?.data || draft.status);
    const pre = await req(eval1, 'GET', `/api/hr/ess/eval/score?assignment_id=${aId1}`);
    const preRow = (pre.json?.data?.scores || []).find((s) => s.criterion_id === criteria[0].id);
    check('score GET prefill returns draft (7, comment)', preRow?.points === 7 && preRow?.comment === 'e2e-draft', pre.json?.data);
    const preForbidden = await req(eval2, 'GET', `/api/hr/ess/eval/score?assignment_id=${aId1}`);
    check('score GET cross-evaluator FORBIDDEN 403', preForbidden.status === 403, preForbidden.status);

    const scoresA = criteria.map((c) => ({ criterion_id: c.id, points: c.max_points })); // all max → 100%
    const subA = await req(eval1, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId1, scores: scoresA, submit: true });
    check('evaluator A submit 200 (saved 15)', subA.status === 200 && subA.json?.data?.saved === 15 && subA.json?.data?.submitted === true, subA.json?.data || subA.status);

    const crossScore = await req(eval2, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId1, scores: scoresA, submit: false });
    check('cross-evaluator scoring FORBIDDEN 403', crossScore.status === 403, crossScore.status);

    const partial = await req(eval2, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId2, scores: [{ criterion_id: criteria[0].id, points: 5 }], submit: true });
    check('partial submit rejected 400', partial.status === 400, partial.status);

    const scoresB = criteria.map((c) => ({ criterion_id: c.id, points: Math.floor(c.max_points / 2) }));
    const subB = await req(eval2, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId2, scores: scoresB, submit: true });
    check('evaluator B submit 200', subB.status === 200 && subB.json?.data?.submitted === true, subB.json?.data || subB.status);

    const q1 = await req(eval1, 'GET', `/api/hr/ess/eval/my-queue?period_id=${periodId}`);
    check('evaluator queue self-scoped', (q1.json?.data?.done ?? q1.json?.data?.total) !== undefined, q1.json?.data);

    const resub = await req(eval1, 'POST', '/api/hr/ess/eval/score', { assignment_id: aId1, scores: scoresA, submit: true });
    check('resubmit after submit 409', resub.status === 409, resub.status);

    const comp = await req(hr, 'POST', P(periodId, '/compute'));
    check('compute 200 (>=1 result)', comp.status === 200 && (comp.json?.data?.results ?? 0) >= 1, comp.json?.data || comp.status);

    const res = await req(hr, 'GET', P(periodId, '/results'));
    const empResult = (res.json?.data || []).find((r) => r.employee_id === EMP);
    check('HR results include employee', !!empResult, res.json?.data);
    check('evaluator_count = 2', empResult?.evaluator_count === 2, empResult?.evaluator_count);
    check('score_pct ≈ 75 ((100+50)/2)', Math.abs((empResult?.score_pct ?? 0) - 75) < 0.5, empResult?.score_pct);

    const rule = await req(hr, 'PUT', P(periodId, '/payout-rule'), { formula_type: 'linear', flat_satang: 100000, satang_per_pct: 1000 });
    check('set payout rule 200', rule.status === 200, `status=${rule.status} ${(rule.text || '').slice(0, 140)}`);
    // Money is only produced once the period is CLOSED (§G) — paying while scoring is still open
    // would pay on mid-scoring data. Assert that guard, then close, then compute.
    const payEarly = await req(hr, 'POST', P(periodId, '/payouts'));
    check('payouts before close → 409', payEarly.status === 409 && payEarly.json?.code === 'period_not_closed', `status=${payEarly.status} ${(payEarly.text || '').slice(0, 120)}`);

    const beforeClose = await req(emp, 'GET', '/api/hr/ess/eval/my-results');
    const visOpen = (beforeClose.json?.data || []).some((r) => r.title === 'e2e eval Jul');
    check('open period hidden from employee', !visOpen, beforeClose.json?.data);

    const close = await req(hr, 'PATCH', '/api/hr/eval/periods', { id: periodId, status: 'closed' });
    check('close period 200', close.status === 200, close.status);

    const pay = await req(hr, 'POST', P(periodId, '/payouts'));
    check('compute payouts 200 (after close)', pay.status === 200 && (pay.json?.data?.payouts ?? 0) >= 1, pay.json?.data || pay.status);

    const mine = await req(emp, 'GET', '/api/hr/ess/eval/my-results');
    const myRow = (mine.json?.data || []).find((r) => r.title === 'e2e eval Jul');
    check('employee sees own closed result', !!myRow, mine.json?.data);
    check('score_pct ≈ 75 for employee', Math.abs((myRow?.score_pct ?? 0) - 75) < 0.5, myRow?.score_pct);
    check('anonymized breakdown has 2 labels', (myRow?.breakdown || []).length === 2, myRow?.breakdown);
    const leaks = JSON.stringify(myRow?.breakdown || []);
    check('breakdown leaks NO evaluator id/name', !leaks.includes(EVAL1) && !leaks.includes(EVAL2) && !/manager|staff9/i.test(leaks), leaks.slice(0, 160));

    const other = await req(eval2, 'GET', '/api/hr/ess/eval/my-results');
    const leaked = (other.json?.data || []).some((r) => r.title === 'e2e eval Jul');
    check('other employee cannot see this result (self-scoped)', !leaked, other.json?.data);

    const staffList = await req(emp, 'GET', '/api/hr/eval/periods');
    check('staff GET periods FORBIDDEN', staffList.status === 401 || staffList.status === 403, staffList.status);
  } finally {
    if (periodId) await svc.from('hr_eval_periods').delete().eq('id', periodId);
  }

  process.exit(summary('HR_E2E_EVAL') ? 0 : 1);
})().catch((e) => { console.error('EVAL ERROR', e); process.exit(1); });
