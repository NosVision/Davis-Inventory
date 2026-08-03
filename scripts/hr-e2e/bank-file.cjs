// bank-file (BBL direct-credit CSV) e2e — draft rejected (409), finalized exports CSV with
// transfer-count/total/skipped headers, total matches non-skipped net sum, staff 403.
// Restores draft at end. Throwaway.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const YEAR = 2026, MONTH = 7;

(async () => {
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  // Ensure a DRAFT payrun exists. Order matters: a finalized run makes generate 409 (no id in the
  // response), so the existing run is looked up via the list first and rewound — with force,
  // because a previous export stamps bank_exported_at (§Phase 0B rail). Reopening before
  // generating is what keeps this suite re-runnable after an interrupted run.
  const list = await req(hr, 'GET', `/api/hr/payruns?company_id=${COMPANY}`);
  const existing = (list.json?.data || []).find((p) => p.period_year === YEAR && p.period_month === MONTH);
  if (existing && existing.status === 'finalized') {
    await req(hr, 'POST', `/api/hr/payruns/${existing.id}/reopen`, { reason: 'e2e bank-file reset', force: true });
  }
  const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: YEAR, period_month: MONTH });
  const payrunId = gen.json?.data?.id ?? existing?.id;
  check('draft payrun ready', !!payrunId, `gen=${gen.status} ${(gen.text || '').slice(0, 120)}`);
  const detail = await req(hr, 'GET', `/api/hr/payruns/${payrunId}`);
  const slips = detail.json?.data?.payslips || [];
  const netTotal = slips.reduce((s, x) => s + x.net_satang, 0);

  // 1. Draft cannot be exported.
  const draftExport = await req(hr, 'GET', `/api/hr/payruns/${payrunId}/bank-file`);
  check('draft bank-file → 409', draftExport.status === 409, draftExport.status);

  // 2. Finalize, then export. The accountant-confirmation gate (2026-07-10) blocks a plain
  // finalize on this throwaway run — HR's audited override is the legitimate path here.
  const fin = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
  check('finalize 200', fin.status === 200, `status=${fin.status} ${(fin.text || '').slice(0, 120)}`);

  const exp = await req(hr, 'GET', `/api/hr/payruns/${payrunId}/bank-file`);
  check('bank-file 200', exp.status === 200, `status=${exp.status} ${(exp.text || '').slice(0, 120)}`);
  check('content-type is text/csv', (exp.headers['content-type'] || '').includes('text/csv'), exp.headers['content-type']);
  const count = Number(exp.headers['x-transfer-count']);
  const skipped = Number(exp.headers['x-transfer-skipped']);
  const total = Number(exp.headers['x-transfer-total-satang']);
  check('transfer headers present + numeric', Number.isFinite(count) && Number.isFinite(skipped) && Number.isFinite(total),
    { count, skipped, total });
  check('count + skipped == slip count', count + skipped === slips.length, { count, skipped, slips: slips.length });
  check('CSV body non-empty (has header row)', (exp.text || '').split('\n').filter(Boolean).length >= 1, (exp.text || '').length);
  // When every employee has a bank account, total == netTotal; when some are skipped, total <= netTotal.
  check('exported total <= net total (skipped excluded)', total <= netTotal && total >= 0, { total, netTotal });
  check('if nobody skipped, total == net total', skipped > 0 || total === netTotal, { skipped, total, netTotal });

  // 3. Staff cannot export.
  const staffExport = await req(staff, 'GET', `/api/hr/payruns/${payrunId}/bank-file`);
  check('staff bank-file FORBIDDEN', staffExport.status === 401 || staffExport.status === 403, staffExport.status);

  // Restore draft. A payrun whose bank file was exported (money may have moved) refuses a plain
  // reopen since §Phase 0B — assert that rail, then rewind with the audited force flag.
  const reopenNoForce = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, { reason: 'e2e bank-file restore draft' });
  check('reopen after bank export → 409 requires_force', reopenNoForce.status === 409 && reopenNoForce.json?.requires_force === true, `status=${reopenNoForce.status} ${(reopenNoForce.text || '').slice(0, 120)}`);
  const reopen = await req(hr, 'POST', `/api/hr/payruns/${payrunId}/reopen`, { reason: 'e2e bank-file restore draft', force: true });
  check('reopen → draft (forced)', reopen.status === 200, `status=${reopen.status} ${(reopen.text || '').slice(0, 120)}`);

  process.exit(summary('HR_E2E_BANKFILE') ? 0 : 1);
})().catch((e) => { console.error('BANKFILE ERROR', e); process.exit(1); });
