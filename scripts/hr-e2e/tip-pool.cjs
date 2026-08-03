// Tip-pool e2e — pool → alloc → deduction (net = allocated − deduction) → payrun generation adds
// a 'tip' earning line to the slip → finalize locks pool (409) → staff 403. Deletes the pool
// (cascade) + regenerates at the end so no tip leaks into later runs. Throwaway.
const path = require('path');
const repo = 'F:/Davis-Inventory';
require(path.join(repo, 'node_modules/dotenv')).config({ path: path.join(repo, '.env.local') });
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const STORE = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
// The payslip carries the PREVIOUS month's tip pool (payruns read N-1, same timing as SV), so a
// pool meant to land on the 7/2026 slip must be June's.
const MONTH = '2026-06-01';
const STAFF = u('hr-test-staff').id;
const ALLOCATED = 3_000_000, DEDUCT = 500_000, NET = ALLOCATED - DEDUCT; // 2,500,000

const genStaffSlip = async (hr) => {
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2026, period_month: 7 });
  const det = await req(hr, 'GET', `/api/hr/payruns/${gen.json.data.id}`);
  const s = (det.json.data.payslips || []).find((x) => x.user_id === STAFF) || {};
  const full = s.id ? (await req(hr, 'GET', `/api/hr/payslips/${s.id}`)).json?.data : null;
  return { summ: s, earnings: full?.earnings || [] };
};

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // Clean any pre-existing pool for a deterministic baseline.
  await svc.from('hr_tip_pools').delete().eq('store_id', STORE).eq('period_month', MONTH);

  try {
    const base = await genStaffSlip(hr);
    check('baseline has no tip earning', !base.earnings.some((e) => e.type === 'tip'), base.earnings.map((e) => e.type));

    // Create pool.
    const put = await req(hr, 'PUT', '/api/hr/tip-pool', { store_id: STORE, period_month: MONTH, total_satang: 5_000_000, pay_date: '2026-07-31' });
    check('PUT pool 200', put.status === 200 && !!put.json?.data?.id, `status=${put.status} ${(put.text || '').slice(0, 140)}`);
    const poolId = put.json.data.id;

    // Allocate to staff.
    const alloc = await req(hr, 'PUT', `/api/hr/tip-pool/${poolId}/allocations`, { allocations: [{ user_id: STAFF, allocated_satang: ALLOCATED }] });
    check('PUT allocations 200', alloc.status === 200, alloc.status);
    const allocId = (alloc.json?.data || []).find((a) => a.user_id === STAFF)?.id;
    check('staff allocation id returned', !!allocId, alloc.json?.data);

    // Deduction → net = 2,500,000.
    const ded = await req(hr, 'POST', `/api/hr/tip-pool/allocations/${allocId}/deductions`, { label: 'ปรับยอด', amount_satang: DEDUCT });
    check('POST deduction 201', ded.status === 201, ded.status);

    // GET pool reflects net.
    const get = await req(hr, 'GET', `/api/hr/tip-pool?store_id=${STORE}&period_month=${MONTH}`);
    const staffAlloc = (get.json?.data?.allocations || []).find((a) => a.user_id === STAFF);
    check('GET staff net = allocated − deduction (2.5M)', staffAlloc?.net_satang === NET, { net: staffAlloc?.net_satang, expected: NET });

    // Generate → slip carries the tip earning.
    const withTip = await genStaffSlip(hr);
    const tipLine = withTip.earnings.find((e) => e.type === 'tip');
    check('tip earning line present on slip', !!tipLine, withTip.earnings.map((e) => e.type));
    check('tip earning = net tip (2.5M)', tipLine?.amount_satang === NET, { tip: tipLine?.amount_satang, expected: NET });
    check('gross rises by exactly the net tip', withTip.summ.gross_satang - base.summ.gross_satang === NET,
      { base: base.summ.gross_satang, withTip: withTip.summ.gross_satang });
    // Tips follow the SV model: they show on the slip but are transferred separately, so the
    // salary net must NOT move.
    check('salary net unchanged (tip paid separately)', withTip.summ.net_satang === base.summ.net_satang, { base: base.summ.net_satang, withTip: withTip.summ.net_satang });

    // Finalize locks the pool.
    const fin = await req(hr, 'POST', `/api/hr/tip-pool/${poolId}/finalize`);
    check('finalize pool 200', fin.status === 200, fin.status);
    const reput = await req(hr, 'PUT', '/api/hr/tip-pool', { store_id: STORE, period_month: MONTH, total_satang: 9_000_000 });
    check('editing finalized pool → 409', reput.status === 409, reput.status);

    // Staff cannot read the tip pool.
    const staffGet = await req(staff, 'GET', `/api/hr/tip-pool?store_id=${STORE}&period_month=${MONTH}`);
    check('staff GET tip-pool FORBIDDEN', staffGet.status === 401 || staffGet.status === 403, staffGet.status);
  } finally {
    // Delete pool (cascade allocs+deductions) + rebuild slips so no tip leaks forward.
    await svc.from('hr_tip_pools').delete().eq('store_id', STORE).eq('period_month', MONTH);
    await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2026, period_month: 7 });
  }

  process.exit(summary('HR_E2E_TIP') ? 0 : 1);
})().catch((e) => { console.error('TIP ERROR', e); process.exit(1); });
