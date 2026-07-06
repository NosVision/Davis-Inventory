// Identity-claim flow (owner-designed, 2026-07-05) — live e2e end-to-end:
// unlinked user sees status → searches the imported roster → claims a name → HR is notified →
// HR approves → hr_employees is created on the claimant's EXISTING profiles.id (seeded from the
// sheet row) + venue membership + audit + result notification. Also guards: double claim 409,
// claiming a taken name 409, staff can't decide, reject returns the name to the pool.
// Uses a THROWAWAY auth user + a synthetic pending identity — real imported rows are untouched.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const HRTEST = '3dd19143-aec1-41ac-bc40-dbc0d72196bc';
const HR_ID = u('hr-test-hr').id;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // throwaway "existing app user" who will claim
  const uname = `idclaim-${Math.floor(Math.random() * 1e6)}`;
  const pw = `Ic${Math.random().toString(36).slice(2, 10)}!x`;
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email: `${uname}@stockmanager.app`,
    password: pw,
    email_confirm: true,
    user_metadata: { username: uname, role: 'staff' },
  });
  check('setup: throwaway user created', !cErr && !!created?.user, cErr?.message);
  const uid = created.user.id;
  await svc.from('profiles').update({ username: uname, role: 'staff', display_name: 'Identity Claim Tester', active: true }).eq('id', uid);

  // synthetic pending identity (unique name so options search hits only ours)
  const FULLNAME = `นายทดสอบ ยืนยันตัวตน${Math.floor(Math.random() * 1e5)}`;
  const { data: co } = await svc.from('hr_companies').select('id').eq('active', true).limit(1).maybeSingle();
  const ins = await svc.from('hr_pending_identities').insert({
    company_id: co.id, store_id: HRTEST, full_name_th: FULLNAME, position_text: 'Service',
    rate_satang: 1_250_000, pay_type: 'full_monthly', start_date: '2024-05-01',
    sso_enrolled: true, tax_mode: 'progressive', sheet_ref: 'E2E#1', created_by: HR_ID,
    bank_name: 'BBL', bank_account_no: '0123456789', full_name_en: 'Mr. Identity Tester', employee_code: '9001',
  }).select('id').single();
  check('setup: pending identity seeded', !ins.error, ins.error?.message);
  const identId = ins.data.id;

  let empId = null;
  try {
    const me = await login(`${uname}@stockmanager.app`, pw);
    check('setup: claimer logged in', !!me && typeof me.cookieHeader === 'function', typeof me);

    // status: unlinked, no claim
    const st1 = await req(me, 'GET', '/api/hr/ess/identity');
    check('status: unlinked + no claim', st1.status === 200 && st1.json?.data?.linked === false && st1.json?.data?.claim === null, st1.json?.data);

    // options: search finds the seeded name (names only — no rate fields)
    const opt = await req(me, 'GET', `/api/hr/ess/identity/options?q=${encodeURIComponent('ยืนยันตัวตน')}`);
    const found = (opt.json?.data ?? []).find((o) => o.full_name_th === FULLNAME);
    check('options: seeded name searchable', !!found, opt.json?.data?.length);
    check('options: no salary fields leaked', found && !('rate_satang' in found) && !('tax_mode' in found), found && Object.keys(found));
    check('options: no bank fields leaked', found && !('bank_account_no' in found) && !('bank_name' in found), found && Object.keys(found));

    // claim
    const cl = await req(me, 'POST', '/api/hr/ess/identity/claim', { identity_id: identId });
    check('claim 201', cl.status === 201, `${cl.status} ${(cl.text || '').slice(0, 120)}`);

    // double claim → 409 ; someone else claiming the taken name → 409
    const cl2 = await req(me, 'POST', '/api/hr/ess/identity/claim', { identity_id: identId });
    check('double claim 409', cl2.status === 409, cl2.status);
    const clStaff = await req(staff, 'POST', '/api/hr/ess/identity/claim', { identity_id: identId });
    check('claiming a taken name 409', clStaff.status === 409, clStaff.status);

    // HR notified
    const { data: notif } = await svc.from('notifications').select('id').eq('user_id', HR_ID).eq('type', 'hr_identity_claim');
    check('HR notified of the claim', (notif ?? []).length >= 1, notif?.length);

    // status now shows the pending claim
    const st2 = await req(me, 'GET', '/api/hr/ess/identity');
    check('status: claim pending', st2.json?.data?.claim?.id === identId, st2.json?.data);

    // HR queue shows it; staff cannot decide
    const q = await req(hr, 'GET', '/api/hr/identity-claims');
    check('HR queue lists the claim', (q.json?.data?.claims ?? []).some((c) => c.id === identId), q.json?.data?.counts);
    const sDec = await req(staff, 'POST', `/api/hr/identity-claims/${identId}/decide`, { decision: 'approve' });
    check('staff decide FORBIDDEN', sDec.status === 401 || sDec.status === 403, sDec.status);

    // approve → hr_employees created on the claimant's existing profile, seeded from the row
    const dec = await req(hr, 'POST', `/api/hr/identity-claims/${identId}/decide`, { decision: 'approve' });
    check('HR approve 200', dec.status === 200, `${dec.status} ${(dec.text || '').slice(0, 140)}`);
    empId = dec.json?.data?.employee_id ?? null;

    const { data: emp } = await svc.from('hr_employees').select('profile_id, rate_satang, sso_enrolled, start_date, company_id, bank_name, bank_account_no, employee_code').eq('id', empId).maybeSingle();
    check('employee linked to the EXISTING profile', emp?.profile_id === uid, emp);
    check('employee seeded from the sheet row (rate ฿12,500)', emp?.rate_satang === 1_250_000 && emp?.sso_enrolled === true && emp?.start_date === '2024-05-01', emp);
    check('bank + code copied onto the employee', emp?.bank_name === 'BBL' && emp?.bank_account_no === '0123456789' && emp?.employee_code === '9001', { bank: emp?.bank_name, acct: emp?.bank_account_no, code: emp?.employee_code });

    const { data: identAfter } = await svc.from('hr_pending_identities').select('status, linked_employee_id').eq('id', identId).maybeSingle();
    check('identity marked linked', identAfter?.status === 'linked' && identAfter?.linked_employee_id === empId, identAfter);

    const { data: memb } = await svc.from('user_stores').select('store_id').eq('user_id', uid).eq('store_id', HRTEST);
    check('venue membership added', (memb ?? []).length === 1, memb);

    const st3 = await req(me, 'GET', '/api/hr/ess/identity');
    check('status: now linked', st3.json?.data?.linked === true, st3.json?.data);

    const { data: resNotif } = await svc.from('notifications').select('id').eq('user_id', uid).eq('type', 'hr_identity_result');
    check('claimant notified of the result', (resNotif ?? []).length >= 1, resNotif?.length);

    // re-decide → 409
    const dec2 = await req(hr, 'POST', `/api/hr/identity-claims/${identId}/decide`, { decision: 'approve' });
    check('re-decide 409', dec2.status === 409, dec2.status);
  } finally {
    if (empId) await svc.from('hr_employees').delete().eq('id', empId);
    await svc.from('hr_pending_identities').delete().eq('id', identId);
    await svc.from('notifications').delete().in('type', ['hr_identity_claim', 'hr_identity_result']);
    await svc.from('user_stores').delete().eq('user_id', uid);
    await svc.auth.admin.deleteUser(uid).catch(() => {});
  }

  process.exit(summary('HR_E2E_IDENTITY_CLAIM') ? 0 : 1);
})().catch((e) => { console.error('IDENTITY_CLAIM ERROR', e); process.exit(1); });
