// Policy settings (owner requirement: tune rules without code) — live e2e proving the FULL
// path: PUT a knob → the engine route actually uses it. probation_days 30 → onboarding a
// throwaway link-mode employee computes probation_end = start+30; restore → 119 again.
// Guards: reason required, unknown key 400, staff 403, audit written.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // throwaway user to link (same pattern as employees-link)
  const uname = `poltest-${Math.floor(Math.random() * 1e6)}`;
  const { data: created } = await svc.auth.admin.createUser({
    email: `${uname}@stockmanager.app`,
    password: `Po${Math.random().toString(36).slice(2, 10)}!x`,
    email_confirm: true,
    user_metadata: { username: uname, role: 'staff' },
  });
  const uid = created.user.id;
  await svc.from('profiles').update({ username: uname, role: 'staff', active: true }).eq('id', uid);
  const { data: co } = await svc.from('hr_companies').select('id').eq('name', 'HR Test Co').maybeSingle();

  const empBody = {
    company_id: co.id, rate_satang: 1_000_000, pay_type: 'full_monthly', work_hours_per_day: 9,
    break_hours: 1, ot_eligible: false, ot_hour_divisor: 9, standard_days_off: 6,
    tax_mode: 'progressive', sso_enrolled: true, status: 'active', start_date: '2026-06-01', storeIds: [HRTEST],
  };

  const empIds = [];
  try {
    // baseline
    const g1 = await req(hr, 'GET', '/api/hr/policy-settings');
    check('GET effective+defaults', g1.status === 200 && g1.json?.data?.effective?.probation_days === 119 && g1.json?.data?.defaults?.probation_days === 119, g1.json?.data?.effective);

    // guards
    const noReason = await req(hr, 'PUT', '/api/hr/policy-settings', { key: 'probation_days', value: { days: 30 } });
    check('PUT without reason 400', noReason.status === 400, noReason.status);
    const badKey = await req(hr, 'PUT', '/api/hr/policy-settings', { key: 'evil_key', value: {}, reason: 'x' });
    check('unknown key 400', badKey.status === 400, badKey.status);
    const s = await req(staff, 'PUT', '/api/hr/policy-settings', { key: 'probation_days', value: { days: 1 }, reason: 'x' });
    check('staff FORBIDDEN', s.status === 401 || s.status === 403, s.status);

    // set probation 30 → onboarding uses it
    const set30 = await req(hr, 'PUT', '/api/hr/policy-settings', { key: 'probation_days', value: { days: 30 }, reason: 'e2e' });
    check('PUT probation 30 → effective', set30.status === 200 && set30.json?.data?.effective?.probation_days === 30, set30.json?.data?.effective?.probation_days);

    const link1 = await req(hr, 'POST', '/api/hr/employees', { link_profile_id: uid, ...empBody });
    check('link employee 201', link1.status === 201, link1.status);
    empIds.push(link1.json?.id);
    const { data: e1 } = await svc.from('hr_employees').select('probation_end').eq('id', link1.json?.id).maybeSingle();
    check('probation_end = start + 30 (2026-07-01)', e1?.probation_end === '2026-07-01', e1?.probation_end);

    // delete the policy row → defaults (119) apply again
    await svc.from('hr_policy_settings').delete().eq('key', 'probation_days');
    await svc.from('hr_employees').delete().eq('id', link1.json?.id);
    const link2 = await req(hr, 'POST', '/api/hr/employees', { link_profile_id: uid, ...empBody });
    check('re-link after reset 201', link2.status === 201, link2.status);
    empIds.push(link2.json?.id);
    const { data: e2 } = await svc.from('hr_employees').select('probation_end').eq('id', link2.json?.id).maybeSingle();
    check('no policy row → default 119 (2026-09-28)', e2?.probation_end === '2026-09-28', e2?.probation_end);

    // audit written for the policy change (key rides in the reason — record_id is uuid-typed)
    const { data: audits } = await svc.from('hr_audit_log').select('id, reason').eq('table_name', 'hr_policy_settings');
    check('audit records the policy change', (audits ?? []).some((a) => String(a.reason || '').includes('[probation_days]')), audits?.length);
  } finally {
    await svc.from('hr_policy_settings').delete().eq('key', 'probation_days');
    for (const id of empIds.filter(Boolean)) await svc.from('hr_employees').delete().eq('id', id);
    await svc.from('user_stores').delete().eq('user_id', uid);
    await svc.from('hr_audit_log').delete().eq('table_name', 'hr_policy_settings');
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  process.exit(summary('HR_E2E_POLICY_SETTINGS') ? 0 : 1);
})().catch((e) => { console.error('POLICY_SETTINGS ERROR', e); process.exit(1); });
