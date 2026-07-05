// hr_leave_types.requires_reason wiring (audit gap #8) — live e2e. A type with
// requires_reason=false accepts a leave filed WITHOUT a reason; with the flag back on, the same
// reasonless filing is rejected 400. Files multipart directly (lib's req() is JSON-only).
const { login, creds, serviceClient, makeCounter } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);
const STAFF = u('hr-test-staff').id;
const BASE = process.env.HR_E2E_BASE || 'http://localhost:3000';

async function fileNoReason(session, leaveTypeId, date) {
  const fd = new FormData();
  fd.append('leave_type_id', leaveTypeId);
  fd.append('from_date', date);
  fd.append('to_date', date);
  const res = await fetch(`${BASE}/api/hr/ess/leaves`, {
    method: 'POST',
    headers: { cookie: session.cookieHeader() },
    body: fd,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

(async () => {
  const svc = await serviceClient();
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const { data: emp } = await svc.from('hr_employees').select('company_id').eq('profile_id', STAFF).maybeSingle();
  const { data: lt } = await svc
    .from('hr_leave_types')
    .select('id, requires_reason')
    .eq('company_id', emp?.company_id)
    .eq('code', 'personal')
    .maybeSingle();
  if (!lt) { console.log('SKIP: no personal leave type'); process.exit(0); }
  const orig = lt.requires_reason;

  // far enough ahead to clear any advance-notice rule
  const d = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  let leaveId = null;

  try {
    // requires_reason = true (default) → reasonless filing rejected
    await svc.from('hr_leave_types').update({ requires_reason: true }).eq('id', lt.id);
    const r1 = await fileNoReason(staff, lt.id, d);
    check('requires_reason=true → no-reason filing 400', r1.status === 400, `${r1.status} ${(r1.text || '').slice(0, 100)}`);

    // requires_reason = false → same filing accepted
    await svc.from('hr_leave_types').update({ requires_reason: false }).eq('id', lt.id);
    const r2 = await fileNoReason(staff, lt.id, d);
    check('requires_reason=false → no-reason filing accepted', r2.status === 201 || r2.status === 200, `${r2.status} ${(r2.text || '').slice(0, 120)}`);
    leaveId = r2.json?.data?.id ?? null;
    check('filed leave stored with empty reason', (r2.json?.data?.reason ?? '') === '', r2.json?.data?.reason);
  } finally {
    if (leaveId) await svc.from('hr_leaves').delete().eq('id', leaveId);
    await svc.from('hr_leaves').delete().eq('user_id', STAFF).eq('from_date', d);
    await svc.from('hr_leave_types').update({ requires_reason: orig }).eq('id', lt.id);
  }

  process.exit(summary('HR_E2E_LEAVE_REASON') ? 0 : 1);
})().catch((e) => { console.error('LEAVE_REASON ERROR', e); process.exit(1); });
