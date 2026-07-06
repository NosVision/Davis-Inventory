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

    // bad passcode format 400
    const badPc = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/review-link`, { passcode: 'a' });
    check('bad passcode format 400', badPc.status === 400, badPc.status);

    // HR mints (custom passcode)
    const mint = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/review-link`, { passcode: '9911' });
    check('mint 201 + url + passcode', mint.status === 201 && typeof mint.json?.data?.url === 'string' && mint.json?.data?.passcode === '9911', mint.status);
    const url = mint.json.data.url;
    const token = url.split('/review/')[1];
    const PC = '9911';
    check('token in url', !!token && token.length >= 20, token?.length);

    // token hashed at rest (raw token never stored)
    const { data: linkRow } = await svc.from('hr_payrun_review_links').select('token_hash, passcode').eq('payrun_id', payrunId).is('revoked_at', null).maybeSingle();
    check('DB stores hash, not raw token', !!linkRow && linkRow.token_hash !== token && linkRow.token_hash.length === 64, linkRow?.token_hash?.slice(0, 8));

    // passcode gate: GET without passcode → 401 locked
    const noPc = await anon(`/api/hr/payrun-review/${token}`);
    check('GET without passcode 401 locked', noPc.status === 401 && (await noPc.json())?.locked === true, noPc.status);
    // wrong passcode → 401
    const wrongPc = await anon(`/api/hr/payrun-review/${token}?passcode=0000`);
    check('wrong passcode 401', wrongPc.status === 401, wrongPc.status);

    // anonymous GET with passcode (no cookies!)
    const g = await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`);
    check('anon GET 200 (with passcode)', g.status === 200, g.status);
    const gj = await g.json();
    const rows = gj?.data?.rows ?? [];
    const staffRow = rows.find((r) => r.name && r.payslip_id);
    check('rows include payslips + money fields', rows.length > 0 && 'gross_satang' in (staffRow ?? {}) && 'tax_satang' in (staffRow ?? {}), rows.length);
    check('rows carry YTD fields (fresh run = 0)', 'ytd_gross_satang' in (staffRow ?? {}) && rows.every((r) => r.ytd_gross_satang === 0), staffRow?.ytd_gross_satang);
    check('link starts unconfirmed', gj?.data?.link?.confirmed_at === null, gj?.data?.link?.confirmed_at);
    check('anon page route also public', (await anon(`/review/${token}`)).status === 200, 'page');

    // YTD opening balance flows into the rows (keyed once at onboarding)
    const OPENING = 12_345_600; // ฿123,456.00 accumulated pre-system
    const { data: prForYtd } = await svc.from('hr_payruns').select('company_id, period_year').eq('id', payrunId).maybeSingle();
    await svc.from('hr_ytd_opening').insert({
      company_id: prForYtd.company_id, profile_id: staffId, year: prForYtd.period_year, gross_satang: OPENING, tax_satang: 50_000,
    });
    const gy = await (await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`)).json();
    const staffYtd = (gy?.data?.rows ?? []).find((r) => {
      // staff slip row — match via slip lookup below (payslip ids are per-user)
      return r.ytd_gross_satang === OPENING;
    });
    check('YTD opening reflected in a row', !!staffYtd && staffYtd.ytd_tax_satang === 50_000, staffYtd?.ytd_gross_satang);

    // bad token 401
    const bad = await anon('/api/hr/payrun-review/AAAAAAAAAAAAAAAAAAAAAAAA?passcode=9911');
    check('bad token 401', bad.status === 401, bad.status);

    // PUT without passcode → 401
    const { data: slips } = await svc.from('hr_payslips').select('id, user_id, gross_satang, tax_satang, total_deduction_satang').eq('payrun_id', payrunId);
    const slip = (slips ?? []).find((s) => s.user_id === staffId);
    const OFFICIAL = 155_387; // ฿1,553.87 — a real accountant figure
    const putNoPc = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ payslip_id: slip.id, tax_satang: OFFICIAL }] }),
    });
    check('PUT without passcode 401', putNoPc.status === 401, putNoPc.status);

    // anonymous PUT taxes on the staff slip (with passcode)
    const put = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: PC, entries: [{ payslip_id: slip.id, tax_satang: OFFICIAL, note: 'จากสำนักงานบัญชี' }] }),
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
        body: JSON.stringify({ passcode: PC, entries: [{ payslip_id: foreign.id, tax_satang: 1 }] }),
      });
      check('cross-payrun slip 400', cross.status === 400, cross.status);
    } else {
      check('cross-payrun slip 400 (skipped — no other slips)', true, 'skip');
    }

    // HR notified
    const { data: notif } = await svc.from('notifications').select('id').eq('user_id', HR_ID()).eq('type', 'hr_tax_submitted');
    check('HR notified of submission', (notif ?? []).length >= 1, notif?.length);

    // ── confirm "ตรวจครบแล้ว" ──
    // without passcode → 401
    const cNoPc = await anon(`/api/hr/payrun-review/${token}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    check('confirm without passcode 401', cNoPc.status === 401, cNoPc.status);
    const cOk = await anon(`/api/hr/payrun-review/${token}/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: PC }),
    });
    check('confirm 200 + timestamp', cOk.status === 200 && typeof (await cOk.json())?.data?.confirmed_at === 'string', cOk.status);
    const gAfterC = await (await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`)).json();
    check('GET shows confirmed_at', typeof gAfterC?.data?.link?.confirmed_at === 'string', gAfterC?.data?.link?.confirmed_at);
    // HR status endpoint sees it too
    const hrStatus = await req(hr, 'GET', `/api/hr/payruns/${payrunId}/review-link`);
    check('HR status shows confirmed_at', hrStatus.status === 200 && typeof hrStatus.json?.data?.confirmed_at === 'string', hrStatus.json?.data?.confirmed_at);
    const { data: cNotif } = await svc.from('notifications').select('id').eq('user_id', HR_ID()).eq('type', 'hr_review_confirmed');
    check('HR notified of confirmation', (cNotif ?? []).length >= 1, cNotif?.length);
    // saving taxes again clears the confirmation (data changed → re-confirm)
    const putAgain = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: PC, entries: [{ payslip_id: slip.id, tax_satang: OFFICIAL }] }),
    });
    check('re-save taxes 200', putAgain.status === 200, putAgain.status);
    const gAfterResave = await (await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`)).json();
    check('re-save clears confirmed_at', gAfterResave?.data?.link?.confirmed_at === null, gAfterResave?.data?.link?.confirmed_at);

    // export xlsx (with passcode) + export without passcode 401
    check('export without passcode 401', (await anon(`/api/hr/payrun-review/${token}/export`)).status === 401, 'noPc');
    const exp = await anon(`/api/hr/payrun-review/${token}/export?passcode=${PC}`);
    const ctype = exp.headers.get('content-type') || '';
    const bytes = Buffer.from(await exp.arrayBuffer());
    check('export 200 xlsx', exp.status === 200 && ctype.includes('spreadsheetml'), `${exp.status} ${ctype}`);
    check('export is a zip (PK) with content', bytes.length > 500 && bytes[0] === 0x50 && bytes[1] === 0x4b, bytes.length);

    // finalize → link becomes read-only
    const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, {});
    check('finalize 200', fin.status === 200, fin.status);
    const putAfterFin = await anon(`/api/hr/payrun-review/${token}/taxes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: PC, entries: [{ payslip_id: slip.id, tax_satang: 1 }] }),
    });
    check('PUT on finalized 409', putAfterFin.status === 409, putAfterFin.status);
    check('GET on finalized still 200 (read-only)', (await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`)).status === 200, 'ro');

    // revoke → dead link
    const rev = await req(hr, 'DELETE', `/api/hr/payruns/${payrunId}/review-link`);
    check('revoke 200', rev.status === 200, rev.status);
    const deadGet = await anon(`/api/hr/payrun-review/${token}?passcode=${PC}`);
    check('revoked token 410', deadGet.status === 410, deadGet.status);
  } finally {
    if (payrunId) {
      await svc.from('hr_ytd_opening').delete().eq('profile_id', staffId);
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
      await svc.from('notifications').delete().eq('type', 'hr_review_confirmed');
    }
  }

  process.exit(summary('HR_E2E_REVIEW_LINK') ? 0 : 1);
})().catch((e) => { console.error('REVIEW_LINK ERROR', e); process.exit(1); });
