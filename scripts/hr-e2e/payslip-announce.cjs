// ⑤ "เงินเดือนออกแล้ว" — live e2e on a THROWAWAY payrun (2026-12, HR Test Co):
// default mode = manual → finalize sends nothing → POST announce notifies every slip owner +
// stamps announced_at → repeat 409 → resend works; draft announce 409; staff 403;
// then policy immediate → NEW payrun (2027-01) finalize auto-announces. Full cleanup.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';

async function cleanupPayrun(svc, payrunId) {
  if (!payrunId) return;
  const { data: ps } = await svc.from('hr_payslips').select('id').eq('payrun_id', payrunId);
  const ids = (ps ?? []).map((p) => p.id);
  if (ids.length) {
    await svc.from('hr_payslip_print_requests').delete().in('payslip_id', ids);
    await svc.from('hr_payslip_earnings').delete().in('payslip_id', ids);
    await svc.from('hr_payslip_deductions').delete().in('payslip_id', ids);
  }
  await svc.from('hr_payslip_tax_overrides').delete().eq('payrun_id', payrunId);
  await svc.from('hr_payslips').delete().eq('payrun_id', payrunId);
  await svc.from('hr_payruns').delete().eq('id', payrunId);
}

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const staffId = u('hr-test-staff').id;

  let run1 = null, run2 = null;
  try {
    // ── manual mode (default) ──
    const gen1 = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2026, period_month: 12 });
    run1 = gen1.json?.data?.id;
    check('generate 2026-12', !!run1, gen1.status);

    // announce on DRAFT → 409
    const draftAnn = await req(hr, 'POST', `/api/hr/payruns/${run1}/announce`, {});
    check('announce on draft 409', draftAnn.status === 409, draftAnn.status);

    const fin1 = await req(hr, 'POST', `/api/hr/payruns/${run1}/finalize`, {});
    check('finalize 200 (manual mode: announced=false)', fin1.status === 200 && fin1.json?.data?.announced === false, fin1.json?.data);
    const { data: n0 } = await svc.from('notifications').select('id').eq('type', 'hr_payslip_ready');
    check('manual mode: finalize sends nothing', (n0 ?? []).length === 0, n0?.length);

    // staff cannot announce
    const sAnn = await req(staff, 'POST', `/api/hr/payruns/${run1}/announce`, {});
    check('staff announce FORBIDDEN', sAnn.status === 401 || sAnn.status === 403, sAnn.status);

    // manual announce → everyone with a slip notified + stamped
    const ann = await req(hr, 'POST', `/api/hr/payruns/${run1}/announce`, {});
    check('announce 200 + notified count', ann.status === 200 && (ann.json?.data?.notified ?? 0) >= 2, ann.json?.data);
    const { data: n1 } = await svc.from('notifications').select('user_id').eq('type', 'hr_payslip_ready');
    check('staff got the payslip-ready push', (n1 ?? []).some((x) => x.user_id === staffId), n1?.length);
    const { data: pr1 } = await svc.from('hr_payruns').select('announced_at, announced_by').eq('id', run1).maybeSingle();
    check('announced_at/by stamped', !!pr1?.announced_at && pr1?.announced_by === u('hr-test-hr').id, pr1);

    // repeat without resend → 409 ; with resend → 200
    const dup = await req(hr, 'POST', `/api/hr/payruns/${run1}/announce`, {});
    check('re-announce without resend 409', dup.status === 409, dup.status);
    const resend = await req(hr, 'POST', `/api/hr/payruns/${run1}/announce`, { resend: true });
    check('resend 200', resend.status === 200, resend.status);

    // ── immediate mode ──
    await svc.from('hr_policy_settings').upsert({ key: 'payslip_announce', value: { mode: 'immediate' } }, { onConflict: 'key' });
    const gen2 = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2027, period_month: 1 });
    run2 = gen2.json?.data?.id;
    const before = (await svc.from('notifications').select('id').eq('type', 'hr_payslip_ready')).data?.length ?? 0;
    const fin2 = await req(hr, 'POST', `/api/hr/payruns/${run2}/finalize`, {});
    check('immediate mode: finalize announces', fin2.status === 200 && fin2.json?.data?.announced === true, fin2.json?.data);
    const after = (await svc.from('notifications').select('id').eq('type', 'hr_payslip_ready')).data?.length ?? 0;
    check('notifications sent on finalize', after > before, `${before} → ${after}`);
    const { data: pr2 } = await svc.from('hr_payruns').select('announced_at').eq('id', run2).maybeSingle();
    check('immediate: announced_at stamped', !!pr2?.announced_at, pr2);
  } finally {
    await svc.from('hr_policy_settings').delete().eq('key', 'payslip_announce');
    await cleanupPayrun(svc, run1);
    await cleanupPayrun(svc, run2);
    await svc.from('notifications').delete().eq('type', 'hr_payslip_ready');
  }

  process.exit(summary('HR_E2E_PAYSLIP_ANNOUNCE') ? 0 : 1);
})().catch((e) => { console.error('PAYSLIP_ANNOUNCE ERROR', e); process.exit(1); });
