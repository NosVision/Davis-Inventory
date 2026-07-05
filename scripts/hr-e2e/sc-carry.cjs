// Cross-period SC carry (200% warning = 2 months) — live e2e through the recompute route.
// Month A: issue a deduct_200 warning + ฿10,000 SC → recompute wipes month A's SC and records a
// full-month carry. Month B (no new warning): recompute must AUTO lay down a 'warning_carry' line
// equal to the prior carry, wiping month B's SC too — proving the 2nd month is now applied
// automatically instead of needing a manual line. Cleans up both pools + the warning.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STAFF = u('hr-test-staff').id;
const MONTH_A = '2026-11-01';
const MONTH_B = '2026-12-01';
const ALLOC = 1_000_000; // ฿10,000

const lineOf = (allocs, srcType) => {
  const a = (allocs || []).find((x) => x.user_id === STAFF);
  const d = (a?.deductions || []).find((x) => x.source_type === srcType);
  return { alloc: a, ded: d };
};

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);

  // deterministic baseline
  await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).in('period_month', [MONTH_A, MONTH_B]);
  await svc.from('hr_warnings').delete().eq('user_id', STAFF).eq('reason', 'sc-carry-e2e');

  const { data: emp } = await svc.from('hr_employees').select('company_id').eq('profile_id', STAFF).maybeSingle();
  let warnId = null;

  try {
    // ── Month A: pool + alloc + a 200% warning issued in November ──
    const poolA = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH_A, total_satang: 5_000_000 })).json?.data;
    await req(hr, 'PUT', `/api/hr/service-charge/${poolA.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: ALLOC }] });

    const ins = await svc.from('hr_warnings').insert({
      user_id: STAFF, issued_by: u('hr-test-hr').id, store_id: HRTEST, company_id: emp?.company_id ?? null,
      level: 'deduct_200', sc_deduct_percent: 200, sc_deduct_cycles: 2, amount_satang: null,
      reason: 'sc-carry-e2e', detail: 'test', issued_at: '2026-11-15T10:00:00+07:00',
      expires_at: '2027-11-15T10:00:00+07:00', status: 'acknowledged',
    }).select('id').single();
    warnId = ins.data?.id;
    check('200% warning issued in month A', !!warnId, ins.error?.message);

    const recA = (await req(hr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`)).json?.data;
    const A = lineOf(recA?.allocations, 'warning');
    check('month A: warning line amount = full alloc', A.ded?.amount_satang === ALLOC, A.ded);
    check('month A: warning line carry = full month', A.ded?.carry_satang === ALLOC, A.ded?.carry_satang);
    check('month A: net SC wiped to 0', A.alloc?.net_satang === 0, A.alloc?.net_satang);

    // ── Month B: pool + alloc, NO new warning — recompute must auto-carry ──
    const poolB = (await req(hr, 'PUT', '/api/hr/service-charge', { store_id: HRTEST, period_month: MONTH_B, total_satang: 5_000_000 })).json?.data;
    await req(hr, 'PUT', `/api/hr/service-charge/${poolB.id}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: ALLOC }] });

    const recB = (await req(hr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`)).json?.data;
    const Bcarry = lineOf(recB?.allocations, 'warning_carry');
    const Bwarn = lineOf(recB?.allocations, 'warning');
    check('month B: NO fresh warning line (none issued in Dec)', !Bwarn.ded, Bwarn.ded);
    check('month B: warning_carry line auto-created', !!Bcarry.ded, Bcarry.ded);
    check('month B: carry amount = prior full month', Bcarry.ded?.amount_satang === ALLOC, Bcarry.ded?.amount_satang);
    check('month B: carry line has no further carry', Bcarry.ded?.carry_satang === 0, Bcarry.ded?.carry_satang);
    check('month B: net SC wiped to 0 by carry', Bcarry.alloc?.net_satang === 0, Bcarry.alloc?.net_satang);

    // ── idempotency: recompute B again → still exactly one carry line ──
    const recB2 = (await req(hr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`)).json?.data;
    const b2 = (recB2?.allocations || []).find((x) => x.user_id === STAFF);
    const carryCount = (b2?.deductions || []).filter((d) => d.source_type === 'warning_carry').length;
    check('recompute idempotent: still exactly one carry line', carryCount === 1, carryCount);

    // ── control: a month with no prior carry gets no carry line (delete A's warning, recompute B) ──
    await svc.from('hr_warnings').delete().eq('id', warnId);
    warnId = null;
    await req(hr, 'POST', `/api/hr/service-charge/${poolA.id}/recompute`); // A now has no warning → carry gone
    const recB3 = (await req(hr, 'POST', `/api/hr/service-charge/${poolB.id}/recompute`)).json?.data;
    const b3carry = lineOf(recB3?.allocations, 'warning_carry');
    check('control: prior carry removed → month B carry line gone', !b3carry.ded, b3carry.ded);
    check('control: month B net restored to full alloc', b3carry.alloc?.net_satang === ALLOC, b3carry.alloc?.net_satang);
  } finally {
    if (warnId) await svc.from('hr_warnings').delete().eq('id', warnId);
    await svc.from('hr_warnings').delete().eq('user_id', STAFF).eq('reason', 'sc-carry-e2e');
    await svc.from('hr_sc_pools').delete().eq('store_id', HRTEST).in('period_month', [MONTH_A, MONTH_B]);
  }

  process.exit(summary('HR_E2E_SC_CARRY') ? 0 : 1);
})().catch((e) => { console.error('SC_CARRY ERROR', e); process.exit(1); });
