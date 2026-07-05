// Company payroll parameters (owner ask 2026-07-05: "ปรับได้เกือบทุกจุด") — live e2e:
// GET exposes the engine knobs; PUT edits them; changing a MONEY field without a reason is 400;
// with a reason it persists + audits; bad tax_id 400; staff 403. Uses HR Test Co and restores.
const { login, req, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const { data: co } = await svc.from('hr_companies').select('*').eq('name', 'HR Test Co').maybeSingle();
  check('setup: HR Test Co exists', !!co, co?.id);
  const id = co.id;

  try {
    const list = await req(hr, 'GET', '/api/hr/companies');
    const row = (list.json?.data ?? []).find((c) => c.id === id);
    check('GET exposes payroll knobs', row && 'sso_rate' in row && 'day_divisor' in row && 'ot_multipliers' in row, row && Object.keys(row));

    // money change without reason → 400
    const noReason = await req(hr, 'PUT', `/api/hr/companies/${id}`, { day_divisor: 26 });
    check('money change without reason 400', noReason.status === 400, noReason.status);

    // with reason → persists
    const ok = await req(hr, 'PUT', `/api/hr/companies/${id}`, { day_divisor: 26, ot1_multiplier: 2, reason: 'e2e test' });
    check('money change with reason 200', ok.status === 200, `${ok.status} ${(ok.text || '').slice(0, 100)}`);
    const { data: after } = await svc.from('hr_companies').select('day_divisor, ot_multipliers').eq('id', id).maybeSingle();
    check('persisted (÷26, OT ×2)', after?.day_divisor === 26 && after?.ot_multipliers?.ot1 === 2, after);

    // non-money edit needs no reason
    const addr = await req(hr, 'PUT', `/api/hr/companies/${id}`, { address: '99 Test Ave' });
    check('address edit without reason 200', addr.status === 200, addr.status);

    // validations
    const badTax = await req(hr, 'PUT', `/api/hr/companies/${id}`, { tax_id: '12345' });
    check('bad tax_id 400', badTax.status === 400, badTax.status);
    const badDiv = await req(hr, 'PUT', `/api/hr/companies/${id}`, { day_divisor: 0, reason: 'x' });
    check('day_divisor 0 → 400', badDiv.status === 400, badDiv.status);

    // audit written
    const { data: audits } = await svc.from('hr_audit_log').select('id').eq('table_name', 'hr_companies').eq('record_id', id).eq('reason', 'e2e test');
    check('audit records the money change', (audits ?? []).length >= 1, audits?.length);

    // staff locked out
    const s = await req(staff, 'PUT', `/api/hr/companies/${id}`, { address: 'nope' });
    check('staff PUT FORBIDDEN', s.status === 401 || s.status === 403, s.status);
  } finally {
    await svc.from('hr_companies').update({
      day_divisor: co.day_divisor, ot_multipliers: co.ot_multipliers, address: co.address, tax_id: co.tax_id,
    }).eq('id', id);
    await svc.from('hr_audit_log').delete().eq('table_name', 'hr_companies').eq('record_id', id);
  }

  process.exit(summary('HR_E2E_COMPANIES') ? 0 : 1);
})().catch((e) => { console.error('COMPANIES ERROR', e); process.exit(1); });
