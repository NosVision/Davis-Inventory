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

  const ssoStaff = u('hr-test-parttime').id;  // → repurposed: past-probation full-time w/o SSO

  // snapshot originals
  const orig = {};
  for (const pid of [probStaff, annivStaff, ssoStaff]) {
    const { data } = await svc.from('hr_employees').select('status, probation_end, start_date, birth_date, pay_type, sso_enrolled, tax_mode, ot_eligible, work_hours_per_day, ot_hour_divisor').eq('profile_id', pid).maybeSingle();
    orig[pid] = data;
  }

  let restored = false;
  const restore = async () => {
    for (const pid of [probStaff, annivStaff, ssoStaff]) {
      if (orig[pid]) {
        const o = orig[pid];
        await svc.from('hr_employees').update({ status: o.status, probation_end: o.probation_end, start_date: o.start_date, birth_date: o.birth_date, pay_type: o.pay_type, sso_enrolled: o.sso_enrolled, tax_mode: o.tax_mode, ot_eligible: o.ot_eligible, work_hours_per_day: o.work_hours_per_day, ot_hour_divisor: o.ot_hour_divisor }).eq('profile_id', pid);
      }
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

    // Birthday in 6d (born 1995, same month-day) → surfaced with days_left, no age leaked
    const bdayNext = plusDaysISO(today, 6);
    await svc.from('hr_employees').update({ birth_date: `1995${bdayNext.slice(4)}` }).eq('profile_id', annivStaff);
    const rb = await req(hr, 'GET', '/api/hr/dashboard/alerts?window_days=14');
    const bd = (rb.json?.data?.birthdays || []).find((x) => x.user_id === annivStaff);
    check('birthday surfaced', !!bd, rb.json?.data?.birthdays);
    check('birthday days_left = 6, no age field', bd?.days_left === 6 && !('years' in (bd || {})), bd);
    const rbNarrow = await req(hr, 'GET', '/api/hr/dashboard/alerts?window_days=3');
    check('window=3 excludes 6d birthday', !(rbNarrow.json?.data?.birthdays || []).some((x) => x.user_id === annivStaff), rbNarrow.json?.data?.birthdays);

    // SSO-pending nudge: full-time, probation passed 10d ago, sso_enrolled=false → surfaced
    const passedEnd = plusDaysISO(today, -10);
    await svc.from('hr_employees').update({ status: 'active', pay_type: 'full_monthly', probation_end: passedEnd, sso_enrolled: false }).eq('profile_id', ssoStaff);
    const r2 = await req(hr, 'GET', '/api/hr/dashboard/alerts');
    const sp = (r2.json?.data?.sso_pending || []).find((x) => x.user_id === ssoStaff);
    check('sso_pending surfaced (past probation, not enrolled)', !!sp, r2.json?.data?.sso_pending);
    check('sso_pending days_over = 10', sp?.days_over === 10, sp?.days_over);

    // enrolling clears the nudge
    await svc.from('hr_employees').update({ sso_enrolled: true }).eq('profile_id', ssoStaff);
    const r3 = await req(hr, 'GET', '/api/hr/dashboard/alerts');
    check('enrolled → sso_pending cleared', !(r3.json?.data?.sso_pending || []).some((x) => x.user_id === ssoStaff), r3.json?.data?.sso_pending);

    // part-time never nudges (no SSO by policy)
    await svc.from('hr_employees').update({ pay_type: 'pt_hourly', sso_enrolled: false }).eq('profile_id', ssoStaff);
    const r4 = await req(hr, 'GET', '/api/hr/dashboard/alerts');
    check('part-time excluded from sso_pending', !(r4.json?.data?.sso_pending || []).some((x) => x.user_id === ssoStaff), r4.json?.data?.sso_pending);

    const s = await req(staff, 'GET', '/api/hr/dashboard/alerts');
    check('staff alerts FORBIDDEN (401/403)', s.status === 401 || s.status === 403, s.status);

    await restore();
    check('restored originals', restored, restored);
  } finally {
    if (!restored) await restore();
  }

  process.exit(summary('HR_E2E_DASHBOARD_ALERTS') ? 0 : 1);
})().catch((e) => { console.error('DASHBOARD_ALERTS ERROR', e); process.exit(1); });
