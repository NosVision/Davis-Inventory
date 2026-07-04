// §P1.5 HR reminders — live-auth e2e for /api/hr/dashboard/alerts. Seed a probation-ending and a
// work-anniversary case via the service client, assert the endpoint surfaces them (with days_left /
// years), that the window filters them out when narrowed, and that staff is locked out. Restores.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

function bkkToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()); }
function plusDaysISO(baseIso, n) { return new Date(Date.parse(`${baseIso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const today = bkkToday();
  const probStaff = u('hr-test-staff').id;    // → probation ending in 7d
  const annivStaff = u('hr-test-staff9').id;  // → 2-year anniversary in 5d

  // snapshot originals
  const orig = {};
  for (const pid of [probStaff, annivStaff]) {
    const { data } = await svc.from('hr_employees').select('status, probation_end, start_date').eq('profile_id', pid).maybeSingle();
    orig[pid] = data;
  }

  let restored = false;
  const restore = async () => {
    for (const pid of [probStaff, annivStaff]) {
      if (orig[pid]) await svc.from('hr_employees').update({ status: orig[pid].status, probation_end: orig[pid].probation_end, start_date: orig[pid].start_date }).eq('profile_id', pid);
    }
    restored = true;
  };

  try {
    const probEnd = plusDaysISO(today, 7);
    const annivDay = plusDaysISO(today, 5);          // same month-day, 2 years ago → anniversary in 5d
    const annivStart = `${Number(annivDay.slice(0, 4)) - 2}${annivDay.slice(4)}`;
    await svc.from('hr_employees').update({ status: 'probation', probation_end: probEnd }).eq('profile_id', probStaff);
    await svc.from('hr_employees').update({ start_date: annivStart }).eq('profile_id', annivStaff);

    const r = await req(hr, 'GET', '/api/hr/dashboard/alerts?window_days=14');
    check('alerts 200', r.status === 200, r.status);
    const d = r.json?.data;
    check('has probation_ending + anniversaries + window', d && Array.isArray(d.probation_ending) && Array.isArray(d.anniversaries) && d.window_days === 14, d);

    const prob = (d?.probation_ending || []).find((x) => x.user_id === probStaff);
    check('probation-ending employee surfaced', !!prob, d?.probation_ending);
    check('probation days_left = 7', prob?.days_left === 7, prob?.days_left);
    check('probation date = probation_end', prob?.date === probEnd, `${prob?.date} vs ${probEnd}`);

    const ann = (d?.anniversaries || []).find((x) => x.user_id === annivStaff);
    check('anniversary employee surfaced', !!ann, d?.anniversaries);
    check('anniversary years = 2', ann?.years === 2, ann?.years);
    check('anniversary days_left = 5', ann?.days_left === 5, ann?.days_left);

    // narrow window → both fall outside (7d and 5d > 3d? 5>3 and 7>3 → both excluded)
    const narrow = await req(hr, 'GET', '/api/hr/dashboard/alerts?window_days=3');
    const nd = narrow.json?.data;
    check('window=3 excludes 7d probation', !(nd?.probation_ending || []).some((x) => x.user_id === probStaff), nd?.probation_ending);
    check('window=3 excludes 5d anniversary', !(nd?.anniversaries || []).some((x) => x.user_id === annivStaff), nd?.anniversaries);

    const s = await req(staff, 'GET', '/api/hr/dashboard/alerts');
    check('staff alerts FORBIDDEN (401/403)', s.status === 401 || s.status === 403, s.status);

    await restore();
    check('restored originals', restored, restored);
  } finally {
    if (!restored) await restore();
  }

  process.exit(summary('HR_E2E_DASHBOARD_ALERTS') ? 0 : 1);
})().catch((e) => { console.error('DASHBOARD_ALERTS ERROR', e); process.exit(1); });
