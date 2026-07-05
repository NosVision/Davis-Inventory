// GET /api/hr/attendance-index — bulk work-index for HR surfaces (eval results column).
// Seeds one on-time + one late + one absent day for hr-test-staff, asserts the endpoint's
// score matches the pure lib's expectation, staff is locked out, and unknown users are
// simply omitted. Restores/cleans everything.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';

function day(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const UID = u('hr-test-staff').id;
  const D = [day(3), day(2), day(1)];

  // shift template MUST start 18:00 — the late-minute expectations below depend on it
  let { data: tpl } = await svc.from('hr_shift_templates').select('id').eq('store_id', HRTEST).ilike('start_time', '18:00%').limit(1).maybeSingle();
  if (!tpl) {
    const ins = await svc.from('hr_shift_templates').insert({ store_id: HRTEST, label: 'IDX 18-03', start_time: '18:00', end_time: '03:00', created_by: u('hr-test-hr').id }).select('id').single();
    tpl = ins.data;
  }

  // snapshot any existing schedule rows on those dates
  const { data: schedBefore } = await svc.from('hr_schedule').select('work_date').eq('user_id', UID).in('work_date', D);
  const preexisting = new Set((schedBefore ?? []).map((r) => r.work_date));

  try {
    await svc.from('hr_schedule').upsert(
      D.map((d) => ({ user_id: UID, store_id: HRTEST, work_date: d, is_day_off: false, shift_template_id: tpl.id, status: 'acknowledged', created_by: u('hr-test-hr').id })),
      { onConflict: 'user_id,work_date' }
    );
    const punch = (biz, tsDate, hhmm, type) => ({ user_id: UID, store_id: HRTEST, type, ts: `${tsDate}T${hhmm}:00+07:00`, business_date: biz });
    await svc.from('hr_attendance').insert([
      punch(D[0], D[0], '17:55', 'in'), punch(D[0], D[1], '03:00', 'out'), // on time
      punch(D[1], D[1], '18:25', 'in'), punch(D[1], D[2], '03:05', 'out'), // late 25 min
      // D[2]: absent
    ]);

    const r = await req(hr, 'GET', `/api/hr/attendance-index?user_ids=${UID},00000000-0000-0000-0000-000000000000&from=${D[0]}&to=${day(0)}`);
    check('index 200', r.status === 200, `${r.status} ${(r.text || '').slice(0, 120)}`);
    const s = r.json?.data?.[UID];
    check('score present for seeded user', !!s, r.json?.data && Object.keys(r.json.data));
    // expected: 3 scheduled days, 1 late (25min), 1 absent →
    // punctuality 100-12-0=88 · attendance 75 · completeness 100 → 44+26.25+15 = 85.25 → 85 good
    check('score matches lib (85 good)', s?.overall === 85 && s?.band === 'good', s);
    check('components exact', s?.components?.punctuality === 88 && s?.components?.attendance === 75 && s?.components?.completeness === 100, s?.components);
    check('recommendations include absent + lateMild', ['absent', 'lateMild'].every((k) => (s?.recommendations ?? []).some((x) => x.key === k)), s?.recommendations?.map((x) => x.key));
    check('unknown user omitted', !(r.json?.data ?? {})['00000000-0000-0000-0000-000000000000'], Object.keys(r.json?.data ?? {}));

    const bad = await req(hr, 'GET', `/api/hr/attendance-index?user_ids=${UID}&from=bad&to=${day(0)}`);
    check('invalid range 400', bad.status === 400, bad.status);

    const st = await req(staff, 'GET', `/api/hr/attendance-index?user_ids=${UID}&from=${D[0]}&to=${day(0)}`);
    check('staff FORBIDDEN (401/403)', st.status === 401 || st.status === 403, st.status);
  } finally {
    await svc.from('hr_attendance').delete().eq('user_id', UID).in('business_date', D);
    await svc.from('hr_schedule').delete().eq('user_id', UID).in('work_date', D.filter((d) => !preexisting.has(d)));
  }

  process.exit(summary('HR_E2E_ATTENDANCE_INDEX') ? 0 : 1);
})().catch((e) => { console.error('ATTENDANCE_INDEX ERROR', e); process.exit(1); });
