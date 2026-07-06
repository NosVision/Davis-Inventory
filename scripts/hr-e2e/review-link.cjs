// Accountant review link — live e2e on a THROWAWAY payrun (2026-09, HR Test Co):
// HR mints link (raw token shown once) → ANONYMOUS GET sees the payrun rows → anonymous PUT
// writes the official tax (via the shared override path, set_via 'link') → HR notified →
// export .xlsx works → revoke kills the link → finalized payrun turns the link read-only (409).
const { login, req, creds, serviceClient, makeCounter, BASE } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 9;
const HR_ID = () => u('hr-test-hr').id;

const anon = (path, init) => fetch(`${BASE}${path}`, { redirect: 'manual', ...init });

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const staffId = u('hr-test-staff').id;

  let payrunId = null;
  try {
    const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
    check('generate 2026-09 payrun', gen.status === 200 || gen.status === 201, gen.status);
    payrunId = gen.json?.data?.id;

    // staff cannot mint a link
    const sMint = await req(staff, 'POST', `/api/hr/payruns/${payrunId}/review-link`, {});
    check('staff mint FORBIDDEN', sMint.status === 401 || sMint.status === 403, sMint.status);

    // HR mints
    const mint = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/review-link`, {});
    check('mint 201 + url', mint.status === 201 && typeof mint.json?.data?.url === 'string', mint.status);
    const url = mint.json.data.url;
    const token = url.split('/review/')[1];
    check('token in url', !!token && token.length >= 20, token?.length);

    // token hashed at rest (raw token never stored)
    const { data: linkRow } = await svc.from('hr_payrun_review_links').select('token_hash').eq('payrun_id', payrunId).is('revoked_at', null).maybeSingle();
    check('DB stores hash, not raw token', !!linkRow && linkRow.token_hash !== token && linkRow.token_hash.length === 64, linkRow?.token_hash?.slice(0, 8));

    // anonymous GET (no cookies!)
    const g = await anon(`/api/hr/payrun-review/${token}`);
    check('anon GET 200', g.status === 200, g.status);
    const gj = await g.json();
    const rows = gj?.data?.rows ?? [];
    const staffRow = rows.find((r) => r.name && r.payslip_id);
    check('rows include payslips + money fields', rows.length > 0 && 'gross_satang' in (staffRow ?? {}) && 'tax_satang' in (staffRow ?? {}), rows.length);
    check('anon page route also public', (await anon(`/review/${token}`)).status === 200, 'page');

    // bad token 401
    const bad = await anon('/api/hr/payrun-review/AAAAAAAAAAAAAAAAAAAAAAAA');
    check('bad token 401', bad.status === 401, bad.status);

    // anonymous PUT taxes on the staff slip
    const { data: slips } = await svc.from('hr_payslips').select('id, user_id, gross_satang, tax_satang, total_deduction_satang').eq('payrun_id', payrunId);
    const slip = (slips ?? []).find((s) => s.user_id === staffId);
    const OFFICIAL = 155_387; // ฿1,553.87 — a real accountant figure
    const put = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ payslip_id: slip.id, tax_satang: OFFICIAL, note: 'จากสำนักงานบัญชี' }] }),
    });
    check('anon PUT taxes 200', put.status === 200, put.status);
    const { data: after } = await svc.from('hr_payslips').select('tax_satang, net_satang, gross_satang, total_deduction_satang').eq('id', slip.id).maybeSingle();
    check('slip tax = official via link', after?.tax_satang === OFFICIAL, after?.tax_satang);
    check('net re-derived', Number(after?.gross_satang) - Number(after?.total_deduction_satang) === Number(after?.net_satang), after);
    const { data: ovr } = await svc.from('hr_payslip_tax_overrides').select('set_via, set_by').eq('payrun_id', payrunId).eq('profile_id', staffId).maybeSingle();
    check("override set_via 'link', set_by null", ovr?.set_via === 'link' && ovr?.set_by === null, ovr);

    // cross-payrun guard: a slip from another payrun is rejected
    const { data: foreign } = await svc.from('hr_payslips').select('id').neq('payrun_id', payrunId).limit(1).maybeSingle();
    if (foreign) {
      const cross = await anon(`/api/hr/payrun-review/${token}/taxes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ payslip_id: foreign.id, tax_satang: 1 }] }),
      });
      check('cross-payrun slip 400', cross.status === 400, cross.status);
    } else {
      check('cross-payrun slip 400 (skipped — no other slips)', true, 'skip');
    }

    // HR notified
    const { data: notif } = await svc.from('notifications').select('id').eq('user_id', HR_ID()).eq('type', 'hr_tax_submitted');
    check('HR notified of submission', (notif ?? []).length >= 1, notif?.length);

    // export xlsx
    const exp = await anon(`/api/hr/payrun-review/${token}/export`);
    const ctype = exp.headers.get('content-type') || '';
    const bytes = Buffer.from(await exp.arrayBuffer());
    check('export 200 xlsx', exp.status === 200 && ctype.includes('spreadsheetml'), `${exp.status} ${ctype}`);
    check('export is a zip (PK) with content', bytes.length > 500 && bytes[0] === 0x50 && bytes[1] === 0x4b, bytes.length);

    // finalize → link becomes read-only
    const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, {});
    check('finalize 200', fin.status === 200, fin.status);
    const putAfterFin = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ payslip_id: slip.id, tax_satang: 1 }] }),
    });
    check('PUT on finalized 409', putAfterFin.status === 409, putAfterFin.status);
    check('GET on finalized still 200 (read-only)', (await anon(`/api/hr/payrun-review/${token}`)).status === 200, 'ro');

    // revoke → dead link
    const rev = await req(hr, 'DELETE', `/api/hr/payruns/${payrunId}/review-link`);
    check('revoke 200', rev.status === 200, rev.status);
    const deadGet = await anon(`/api/hr/payrun-review/${token}`);
    check('revoked token 410', deadGet.status === 410, deadGet.status);
  } finally {
    if (payrunId) {
      await svc.from('hr_payrun_review_links').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payslip_tax_overrides').delete().eq('payrun_id', payrunId);
      const { data: ps } = await svc.from('hr_payslips').select('id').eq('payrun_id', payrunId);
      const ids = (ps ?? []).map((p) => p.id);
      if (ids.length) {
        await svc.from('hr_payslip_earnings').delete().in('payslip_id', ids);
        await svc.from('hr_payslip_deductions').delete().in('payslip_id', ids);
      }
      await svc.from('hr_payslips').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payruns').delete().eq('id', payrunId);
      await svc.from('notifications').delete().eq('type', 'hr_tax_submitted');
    }
  }

  process.exit(summary('HR_E2E_REVIEW_LINK') ? 0 : 1);
})().catch((e) => { console.error('REVIEW_LINK ERROR', e); process.exit(1); });
