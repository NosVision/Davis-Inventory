// SC recompute correctness fixes (audit bugs 1-3), live through the recompute route:
//  1) recompute must PRESERVE an applied evaluation SC deduction (source_type='eval') instead of
//     wiping it (it previously deleted ALL auto lines and rebuilt only warning/leave).
//  2) an eval SC penalty larger than one month's SC must CARRY to next month (eval_carry line).
//  3) a leave day that falls on the employee's scheduled day-off must NOT dock SC.
// Uses the service client to seed rows, then drives the real recompute route as HR.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STAFF = u('hr-test-staff').id;
const MONTH_A = '2026-11-01';
const MONTH_B = '2026-12-01';
const ALLOC = 1_000_000; // ฿10,000

const dedsOf = (allocs) => ((allocs || []).find((a) => a.user_id === STAFF)?.deductions) || [];
const line = (allocs, src) => dedsOf(allocs).find((d) => d.source_type === src);
const netOf = (allocs) => (allocs || []).find((a) => a.user_id === STAFF)?.net_satang;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const { data: emp } = await svc.from('hr_employees').select('company_id').eq('profile_id', STAFF).maybeSingle();
  const { data: ltype } = await svc
    .from('hr_leave_types').select('id, code, paid').eq('company_id', emp?.company_id).eq('code', 'personal').maybeSingle();

  // clean baseline
  await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).in('period_month', [MONTH_A, MONTH_B]);
  await svc.from('hr_leaves').delete().eq('user_id', STAFF).eq('reason', 'sc-recompute-e2e');
  await svc.from('hr_schedule').delete().eq('user_id', STAFF).eq('store_id', HRTEST).in('work_date', ['2026-11-20', '2026-11-21']);
  let leaveId = null;

  try {
    // ── Month A: pool + alloc ──
    const poolA = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH_A, total_satang: 5_000_000 })).json?.data;
    const allocA = ((await req(hr, 'PUT', `/api/hr/service-charge/${poolA.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: ALLOC }] })).json?.data || [])[0];

    // Seed an applied EVAL deduction that exceeds one month (amount = full alloc, carry = ฿3,000),
    // as apply-sc would for a large negative eval payout.
    await svc.from('hr_sc_deductions').insert({
      allocation_id: allocA.id, source_type: 'eval', source_ref: null, label: 'Eval penalty',
      amount_satang: ALLOC, carry_satang: 300_000, auto: true, created_by: u('hr-test-hr').id,
    });

    // ── BUG 1: recompute must NOT wipe the eval line ──
    const recA = (await req(hr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`)).json?.data;
    const evalA = line(recA?.allocations, 'eval');
    check('bug1: eval SC line survives recompute', !!evalA, dedsOf(recA?.allocations).map((d) => d.source_type));
    check('bug1: eval line amount intact', evalA?.amount_satang === ALLOC, evalA?.amount_satang);
    check('bug1: net wiped to 0 by eval', netOf(recA?.allocations) === 0, netOf(recA?.allocations));

    // ── BUG 2: eval overflow carries to month B ──
    const poolB = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH_B, total_satang: 5_000_000 })).json?.data;
    await req(hr, 'PUT', `/api/hr/service-charge/${poolB.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: ALLOC }] });
    const recB = (await req(hr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`)).json?.data;
    const evalCarryB = line(recB?.allocations, 'eval_carry');
    check('bug2: eval_carry line auto-created next month', !!evalCarryB, dedsOf(recB?.allocations).map((d) => d.source_type));
    check('bug2: eval_carry amount = prior overflow (฿3,000)', evalCarryB?.amount_satang === 300_000, evalCarryB?.amount_satang);
    check('bug2: month B net reduced by carry', netOf(recB?.allocations) === ALLOC - 300_000, netOf(recB?.allocations));

    // idempotent: recompute B twice → still one eval_carry, eval line on A still intact
    await req(hr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`);
    const recA2 = (await req(hr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`)).json?.data;
    check('bug1: eval line still intact after re-recompute', !!line(recA2?.allocations, 'eval'), null);

    // ── BUG 3: a leave day on a scheduled day-off must not dock SC ──
    if (ltype?.id) {
      // Nov 21 = scheduled day off (Nov 20 has no schedule row → counts as a working day); file a
      // 2-day personal (SC-docking) leave spanning both.
      const schedIns = await svc.from('hr_schedule').insert([
        { user_id: STAFF, store_id: HRTEST, work_date: '2026-11-21', is_day_off: true, status: 'acknowledged', created_by: u('hr-test-hr').id },
      ]);
      check('bug3 setup: day-off schedule row inserted', !schedIns.error, schedIns.error?.message);
      const lv = await svc.from('hr_leaves').insert({
        user_id: STAFF, store_id: HRTEST, company_id: emp?.company_id, leave_type_id: ltype.id,
        from_date: '2026-11-20', to_date: '2026-11-21', days: 2, reason: 'sc-recompute-e2e', status: 'approved',
      }).select('id').single();
      leaveId = lv.data?.id;
      const recA3 = (await req(hr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`)).json?.data;
      const leaveLine = line(recA3?.allocations, 'leave');
      check('bug3: leave SC line counts only the worked day (1), not the day-off', /\(1d\)/.test(leaveLine?.label || ''), leaveLine?.label);
    } else {
      check('bug3: (skipped — no personal leave type seeded)', true, 'skip');
    }
  } finally {
    if (leaveId) await svc.from('hr_leaves').delete().eq('id', leaveId);
    await svc.from('hr_leaves').delete().eq('user_id', STAFF).eq('reason', 'sc-recompute-e2e');
    await svc.from('hr_schedule').delete().eq('user_id', STAFF).eq('store_id', HRTEST).in('work_date', ['2026-11-20', '2026-11-21']);
    await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).in('period_month', [MONTH_A, MONTH_B]);
  }

  process.exit(summary('HR_E2E_SC_RECOMPUTE_FIXES') ? 0 : 1);
})().catch((e) => { console.error('SC_RECOMPUTE_FIXES ERROR', e); process.exit(1); });
