// P1.5 org chart — live e2e: flat reporting feed from hr_employees.supervisor_id.
// Sets staff9's supervisor = staff (profiles.id), asserts the API reflects it, then restores.
// Staff is locked out (resolveHrScope).
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const staffId = u('hr-test-staff').id;
  const staff9Id = u('hr-test-staff9').id;

  const { data: orig } = await svc.from('hr_employees').select('supervisor_id').eq('profile_id', staff9Id).maybeSingle();
  let restored = false;
  const restore = async () => {
    await svc.from('hr_employees').update({ supervisor_id: orig?.supervisor_id ?? null }).eq('profile_id', staff9Id);
    restored = true;
  };

  try {
    await svc.from('hr_employees').update({ supervisor_id: staffId }).eq('profile_id', staff9Id);

    const r = await req(hr, 'GET', '/api/hr/org-chart');
    check('org-chart 200', r.status === 200, r.status);
    const rows = r.json?.data ?? [];
    check('returns employees', rows.length >= 2, rows.length);

    const nStaff = rows.find((x) => x.id === staffId);
    const nStaff9 = rows.find((x) => x.id === staff9Id);
    check('staff node present with name', !!nStaff && typeof nStaff.name === 'string' && nStaff.name.length > 0, nStaff);
    check('staff9 reports to staff', nStaff9?.supervisor_id === staffId, nStaff9?.supervisor_id);
    check('node carries position/department/avatar fields', nStaff9 && 'position' in nStaff9 && 'department' in nStaff9 && 'avatar_url' in nStaff9, nStaff9 && Object.keys(nStaff9));

    const s = await req(staff, 'GET', '/api/hr/org-chart');
    check('staff FORBIDDEN (401/403)', s.status === 401 || s.status === 403, s.status);

    await restore();
    const r2 = await req(hr, 'GET', '/api/hr/org-chart');
    const after = (r2.json?.data ?? []).find((x) => x.id === staff9Id);
    check('restored supervisor', after?.supervisor_id === (orig?.supervisor_id ?? null), after?.supervisor_id);
  } finally {
    if (!restored) await restore();
  }

  process.exit(summary('HR_E2E_ORG_CHART') ? 0 : 1);
})().catch((e) => { console.error('ORG_CHART ERROR', e); process.exit(1); });
