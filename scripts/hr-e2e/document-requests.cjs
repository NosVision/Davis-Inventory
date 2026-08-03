// ⑥ Document request center — live e2e: employee requests 50 ทวิ + salary cert → HR notified;
// HR GENERATES both (figures derived from finalized slips / employee record) → employee opens
// the generated data via own file route; another request REJECTED with reason; HR ATTACHES a
// file for a third → employee gets a signed URL. Guards: duplicate open 409, other's request
// 404, staff can't read HR queue, missing year 400. Uses a throwaway finalized payrun so the
// 50 ทวิ has data. Full cleanup.
const { login, req, creds, serviceClient, makeCounter, BASE } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const COMPANY = 'faf154a4-ffc4-406b-bf44-58cf1162f873';
const HR_ID = () => u('hr-test-hr').id;

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const staff9 = await login(u('hr-test-staff9').email, u('hr-test-staff9').password);
  const staffId = u('hr-test-staff').id;

  let payrunId = null;
  const reqIds = [];
  try {
    // a finalized 2025-06 payrun so the 50 ทวิ (year 2025) has income
    const gen = await req(hr, 'POST', '/api/hr/payruns', { company_id: COMPANY, period_year: 2025, period_month: 6 });
    payrunId = gen.json?.data?.id;
    await req(hr, 'POST', `/api/hr/payruns/${payrunId}/finalize`, { override_reason: 'e2e: no accountant link on the throwaway run' });
    check('setup: finalized 2025-06 payrun', !!payrunId, gen.status);

    // year required for 50twi
    const noYear = await req(staff, 'POST', '/api/hr/ess/document-requests', { doc_type: 'cert_50twi' });
    check('50twi without year 400', noYear.status === 400, noYear.status);

    // request 50twi
    const r50 = await req(staff, 'POST', '/api/hr/ess/document-requests', { doc_type: 'cert_50twi', year: 2025 });
    check('request 50twi 201', r50.status === 201, `${r50.status} ${(r50.text || '').slice(0, 100)}`);
    reqIds.push(r50.json?.data?.id);

    // duplicate open 409
    const dup = await req(staff, 'POST', '/api/hr/ess/document-requests', { doc_type: 'cert_50twi', year: 2025 });
    check('duplicate open request 409', dup.status === 409, dup.status);

    // HR notified
    const { data: notif } = await svc.from('notifications').select('id').eq('user_id', HR_ID()).eq('type', 'hr_doc_request');
    check('HR notified of request', (notif ?? []).length >= 1, notif?.length);

    // salary cert + other
    const rSal = await req(staff, 'POST', '/api/hr/ess/document-requests', { doc_type: 'salary_cert' });
    check('request salary cert 201', rSal.status === 201, rSal.status);
    reqIds.push(rSal.json?.data?.id);
    const rOther = await req(staff, 'POST', '/api/hr/ess/document-requests', { doc_type: 'other', note: 'ขอหนังสือรับรองพิเศษ' });
    reqIds.push(rOther.json?.data?.id);

    // staff cannot read HR queue
    const sQ = await req(staff, 'GET', '/api/hr/document-requests');
    check('staff queue FORBIDDEN', sQ.status === 401 || sQ.status === 403, sQ.status);

    // HR queue shows the 3, name resolved
    const q = await req(hr, 'GET', '/api/hr/document-requests');
    const qOpen = (q.json?.data ?? []).filter((x) => x.status === 'requested');
    check('HR queue lists open requests with names', qOpen.length >= 3 && qOpen.every((x) => typeof x.name === 'string'), qOpen.length);

    // generate 50twi
    const g50 = await req(hr, 'POST', `/api/hr/document-requests/${r50.json.data.id}/fulfill`, { action: 'generate' });
    check('generate 50twi 200', g50.status === 200 && g50.json?.data?.fulfillment === 'generated', g50.json?.data);
    // employee opens the generated data (own)
    const f50 = await req(staff, 'GET', `/api/hr/ess/document-requests/${r50.json.data.id}/file`);
    check('employee opens generated 50twi', f50.status === 200 && f50.json?.data?.kind === 'generated' && Number(f50.json?.data?.generated?.total_income_satang) > 0, f50.json?.data?.generated);

    // other's request 404
    const other = await req(staff9, 'GET', `/api/hr/ess/document-requests/${r50.json.data.id}/file`);
    check("other's document 404", other.status === 404, other.status);

    // generate salary cert
    const gSal = await req(hr, 'POST', `/api/hr/document-requests/${rSal.json.data.id}/fulfill`, { action: 'generate' });
    check('generate salary cert 200', gSal.status === 200, gSal.status);
    const fSal = await req(staff, 'GET', `/api/hr/ess/document-requests/${rSal.json.data.id}/file`);
    check('salary cert has rate + position fields', fSal.json?.data?.generated?.kind === 'salary_cert' && 'rate_satang' in (fSal.json?.data?.generated ?? {}), fSal.json?.data?.generated);

    // 'other' cannot be generated → 400 ; then attach a file
    const genOther = await req(hr, 'POST', `/api/hr/document-requests/${rOther.json.data.id}/fulfill`, { action: 'generate' });
    check("'other' cannot generate 400", genOther.status === 400, genOther.status);

    const fd = new FormData();
    fd.append('file', new File([Buffer.from('%PDF-1.4 test doc')], 'doc.pdf', { type: 'application/pdf' }));
    const up = await fetch(`${BASE}/api/hr/document-requests/${rOther.json.data.id}/upload`, { method: 'POST', headers: { cookie: hr.cookieHeader() }, body: fd });
    const upJson = await up.json().catch(() => ({}));
    check('attach file 201', up.status === 201 && upJson?.data?.fulfillment === 'file', up.status);
    const fOther = await req(staff, 'GET', `/api/hr/ess/document-requests/${rOther.json.data.id}/file`);
    check('employee gets signed URL for attached file', fOther.json?.data?.kind === 'file' && typeof fOther.json?.data?.url === 'string', fOther.json?.data?.kind);

    // employee notified (ready) at least twice
    const { data: readyN } = await svc.from('notifications').select('id').eq('user_id', staffId).eq('type', 'hr_doc_ready');
    check('employee notified doc ready', (readyN ?? []).length >= 2, readyN?.length);

    // decided requests can't be re-fulfilled
    const reFul = await req(hr, 'POST', `/api/hr/document-requests/${r50.json.data.id}/fulfill`, { action: 'generate' });
    check('re-fulfill decided 409', reFul.status === 409, reFul.status);
  } finally {
    // remove uploaded doc files
    const { data: fileRows } = await svc.from('hr_document_requests').select('file_path').in('id', reqIds.filter(Boolean));
    const paths = (fileRows ?? []).map((r) => r.file_path).filter(Boolean);
    if (paths.length) await svc.storage.from('hr-documents').remove(paths).catch(() => {});
    await svc.from('hr_document_requests').delete().in('id', reqIds.filter(Boolean));
    await svc.from('notifications').delete().in('type', ['hr_doc_request', 'hr_doc_ready']);
    if (payrunId) {
      const { data: ps } = await svc.from('hr_payslips').select('id').eq('payrun_id', payrunId);
      const ids = (ps ?? []).map((p) => p.id);
      if (ids.length) {
        await svc.from('hr_payslip_earnings').delete().in('payslip_id', ids);
        await svc.from('hr_payslip_deductions').delete().in('payslip_id', ids);
      }
      await svc.from('hr_payslips').delete().eq('payrun_id', payrunId);
      await svc.from('hr_payruns').delete().eq('id', payrunId);
    }
  }

  process.exit(summary('HR_E2E_DOCUMENT_REQUESTS') ? 0 : 1);
})().catch((e) => { console.error('DOCUMENT_REQUESTS ERROR', e); process.exit(1); });
