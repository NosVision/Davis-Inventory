// Link-existing-user onboarding (owner ask 2026-07-05: imported employees must attach to the
// account the person ALREADY logs in with, since punches/schedule/payslip RLS key on profiles.id).
// Creates a throwaway auth user (never touches real staff), links it via POST /api/hr/employees
// {link_profile_id}, verifies the hr_employees row + linkable listing + guards, then cleans up.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // throwaway account that "already exists" (simulating a long-time app user)
  const uname = `linktest-${Math.floor(Math.random() * 1e6)}`;
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: `${uname}@stockmanager.app`,
    password: `Lk${Math.random().toString(36).slice(2, 10)}!x`,
    email_confirm: true,
    user_metadata: { username: uname, role: 'staff' },
  });
  check('setup: throwaway auth user created', !createErr && !!created?.user, createErr?.message);
  const uid = created.user.id;
  await svc.from('profiles').update({ username: uname, role: 'staff', display_name: 'Link Test User', active: true }).eq('id', uid);

  const { data: co } = await svc.from('hr_companies').select('id').eq('active', true).limit(1).maybeSingle();

  const empBody = {
    company_id: co?.id ?? null,
    rate_satang: 1_500_000,
    pay_type: 'full_monthly',
    work_hours_per_day: 9,
    break_hours: 1,
    ot_eligible: false,
    ot_hour_divisor: 9,
    standard_days_off: 6,
    tax_mode: 'progressive',
    sso_enrolled: true,
    status: 'active',
    storeIds: [HRTEST],
  };

  let empId = null;
  try {
    // linkable list contains the throwaway user before linking
    const lk1 = await req(hr, 'GET', `/api/hr/employees/linkable?q=${uname}`);
    check('linkable list shows the unlinked user', (lk1.json?.data ?? []).some((p) => p.id === uid), lk1.json?.data?.length);

    // staff cannot use the endpoint
    const sLk = await req(staff, 'GET', '/api/hr/employees/linkable');
    check('staff linkable 403', sLk.status === 401 || sLk.status === 403, sLk.status);

    // link → hr_employees attaches to the EXISTING profile id, no temp password
    const linked = await req(hr, 'POST', '/api/hr/employees', { link_profile_id: uid, ...empBody });
    check('link 201', linked.status === 201, `${linked.status} ${(linked.text || '').slice(0, 140)}`);
    check('response flags linked (no temp password)', linked.json?.linked === true && !linked.json?.tempPassword, linked.json);
    empId = linked.json?.id ?? null;

    const { data: empRow } = await svc.from('hr_employees').select('id, profile_id, rate_satang').eq('id', empId).maybeSingle();
    check('hr_employees.profile_id = the EXISTING profile', empRow?.profile_id === uid, empRow);

    // store membership added exactly once
    const { data: memb } = await svc.from('user_stores').select('store_id').eq('user_id', uid).eq('store_id', HRTEST);
    check('venue membership added', (memb ?? []).length === 1, memb);

    // guards: duplicate link 409; linkable list no longer offers the user
    const dup = await req(hr, 'POST', '/api/hr/employees', { link_profile_id: uid, ...empBody });
    check('duplicate link 409', dup.status === 409, dup.status);
    const lk2 = await req(hr, 'GET', `/api/hr/employees/linkable?q=${uname}`);
    check('linkable list excludes already-linked user', !(lk2.json?.data ?? []).some((p) => p.id === uid), lk2.json?.data?.length);

    // guard: cannot link an owner account
    const { data: anyOwner } = await svc.from('profiles').select('id').eq('role', 'owner').eq('active', true).limit(1).maybeSingle();
    if (anyOwner) {
      const own = await req(hr, 'POST', '/api/hr/employees', { link_profile_id: anyOwner.id, ...empBody });
      check('linking an owner account 400', own.status === 400, own.status);
    } else {
      check('linking an owner account 400 (skipped — no owner)', true, 'skip');
    }

    // audit recorded the link
    const { data: audits } = await svc
      .from('hr_audit_log')
      .select('id, reason')
      .eq('table_name', 'hr_employees')
      .eq('record_id', empId);
    check('audit records the link', (audits ?? []).some((a) => String(a.reason || '').includes('Linked existing account')), audits);
  } finally {
    if (empId) await svc.from('hr_employees').delete().eq('id', empId);
    await svc.from('user_stores').delete().eq('user_id', uid);
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  process.exit(summary('HR_E2E_EMPLOYEES_LINK') ? 0 : 1);
})().catch((e) => { console.error('EMPLOYEES_LINK ERROR', e); process.exit(1); });
