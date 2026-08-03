// Day-off swap flow per the owner's confirmed spec (2026-07-05): staff files a swap → HR gets an
// in-app notification → HR approves → BOTH schedules exchange immediately + hr_audit_log records
// the decision → both employees get a result notification. Live e2e through the real routes.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const STAFF = u('hr-test-staff').id; // requester
const STAFF9 = u('hr-test-staff9').id; // counterpart
const HR_ID = u('hr-test-hr').id; // has can_manage_hr → must be notified
const D1 = '2026-12-20'; // requester's day off
const D2 = '2026-12-22'; // counterpart's day off

(async () => {
  const svc = await serviceClient();
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);

  const cleanup = async () => {
    await svc.from('hr_dayoff_swaps').delete().eq('requester_id', STAFF).eq('requester_date', D1);
    await svc.from('hr_schedule').delete().in('user_id', [STAFF, STAFF9]).in('work_date', [D1, D2]);
    await svc.from('notifications').delete().in('type', ['hr_swap_request', 'hr_swap_result']).eq('store_id', HRTEST);
  };
  await cleanup();

  try {
    // A working cell must carry a shift template (CHECK hr_schedule_shift_or_dayoff) — reuse the
    // store's first template or create a throwaway one.
    let { data: tpl } = await svc
      .from('hr_shift_templates')
      .select('id')
      .eq('store_id', HRTEST)
      .limit(1)
      .maybeSingle();
    if (!tpl) {
      const created = await svc
        .from('hr_shift_templates')
        .insert({ store_id: HRTEST, label: 'swap-e2e', start_time: '18:00', end_time: '03:00', created_by: HR_ID })
        .select('id')
        .single();
      tpl = created.data;
    }

    // Seed: requester OFF on D1, counterpart WORKING on D2 — both at HRTEST.
    const ins = await svc.from('hr_schedule').insert([
      { user_id: STAFF, store_id: HRTEST, work_date: D1, is_day_off: true, shift_template_id: null, status: 'acknowledged', created_by: HR_ID },
      { user_id: STAFF9, store_id: HRTEST, work_date: D2, is_day_off: false, shift_template_id: tpl.id, status: 'acknowledged', created_by: HR_ID },
    ]);
    check('setup: schedule cells seeded', !ins.error, ins.error?.message);

    // 1) staff files the swap (own date ↔ counterpart+date)
    const filed = await req(staff, 'POST', '/api/hr/ess/dayoff-swaps', {
      counterpart_id: STAFF9,
      requester_date: D1,
      counterpart_date: D2,
      note: 'swap-notify-e2e',
    });
    check('file swap 201', filed.status === 201, `${filed.status} ${(filed.text || '').slice(0, 120)}`);
    const swapId = filed.json?.data?.id;

    // 2) HR got an in-app notification about the new request
    const { data: hrNotif } = await svc
      .from('notifications')
      .select('id, title, type')
      .eq('user_id', HR_ID)
      .eq('type', 'hr_swap_request')
      .eq('store_id', HRTEST);
    check('HR notified of new swap request', (hrNotif ?? []).length >= 1, hrNotif);

    // 3) HR approves → schedules exchange atomically
    const decided = await req(hr, 'POST', `/api/hr/dayoff-swaps/${swapId}/decide`, { decision: 'approved' });
    check('HR approve 200', decided.status === 200, `${decided.status} ${(decided.text || '').slice(0, 120)}`);

    const { data: cells } = await svc
      .from('hr_schedule')
      .select('user_id, work_date, is_day_off')
      .in('user_id', [STAFF, STAFF9])
      .in('work_date', [D1, D2]);
    const cell = (uid, d) => (cells ?? []).find((c) => c.user_id === uid && c.work_date === d);
    check('schedules exchanged: requester D1 now WORKING', cell(STAFF, D1)?.is_day_off === false, cell(STAFF, D1));
    check('schedules exchanged: counterpart D2 now DAY OFF', cell(STAFF9, D2)?.is_day_off === true, cell(STAFF9, D2));

    // 4) audit log recorded the decision + the exchange
    const { data: audits } = await svc
      .from('hr_audit_log')
      .select('id, action, after')
      .eq('table_name', 'hr_dayoff_swaps')
      .eq('record_id', swapId);
    const approvedAudit = (audits ?? []).find((a) => a.after?.status === 'approved');
    check('hr_audit_log has the approval', !!approvedAudit, audits);
    check('audit captures the schedule exchange', approvedAudit?.after?.schedule_swapped?.requester_id === STAFF, approvedAudit?.after);

    // 5) both employees notified of the result
    const { data: resultNotifs } = await svc
      .from('notifications')
      .select('user_id')
      .eq('type', 'hr_swap_result')
      .eq('store_id', HRTEST);
    const notifiedIds = new Set((resultNotifs ?? []).map((n) => n.user_id));
    check('requester notified of result', notifiedIds.has(STAFF), [...notifiedIds]);
    check('counterpart notified of result', notifiedIds.has(STAFF9), [...notifiedIds]);
  } finally {
    await cleanup();
  }

  process.exit(summary('HR_E2E_SWAP_NOTIFY') ? 0 : 1);
})().catch((e) => { console.error('SWAP_NOTIFY ERROR', e); process.exit(1); });
