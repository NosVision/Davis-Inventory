// Self-service profile (owner ask 2026-07-05): own phone + own photo + identity status on
// /me/profile. Live e2e: GET exposes avatar_url/phone; PUT contact validates + persists +
// audits; POST /ess/avatar sets own profiles.avatar_url (bucket cleaned on replace); 401s
// without a session. Restores everything.
const { login, req, creds, serviceClient, makeCounter, BASE } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const svc = await serviceClient();
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);
  const uid = u('hr-test-staff').id;

  const { data: orig } = await svc.from('profiles').select('phone, avatar_url').eq('id', uid).maybeSingle();
  const uploaded = [];
  try {
    // GET exposes the new self-service fields
    const g1 = await req(staff, 'GET', '/api/hr/ess/profile');
    check('profile GET 200 + has avatar_url/phone fields', g1.status === 200 && 'avatar_url' in (g1.json?.data ?? {}) && 'phone' in (g1.json?.data ?? {}), g1.json?.data && Object.keys(g1.json.data));

    // phone: invalid rejected, valid persists
    const bad = await req(staff, 'PUT', '/api/hr/ess/profile/contact', { phone: 'abc!!' });
    check('invalid phone 400', bad.status === 400, bad.status);
    const ok = await req(staff, 'PUT', '/api/hr/ess/profile/contact', { phone: '081-234-5678' });
    check('phone update 200', ok.status === 200, ok.status);
    const g2 = await req(staff, 'GET', '/api/hr/ess/profile');
    check('phone persisted', g2.json?.data?.phone === '081-234-5678', g2.json?.data?.phone);

    // self avatar upload
    const fd = new FormData();
    fd.append('file', new File([PNG], 'me.png', { type: 'image/png' }));
    const av = await fetch(`${BASE}/api/hr/ess/avatar`, { method: 'POST', headers: { cookie: staff.cookieHeader() }, body: fd });
    const avJson = await av.json().catch(() => ({}));
    check('self avatar 201', av.status === 201, av.status);
    const url = avJson?.data?.avatar_url ?? '';
    check('avatar url in public bucket under own id', url.includes(`/object/public/avatars/${uid}/`), url);
    uploaded.push(url);
    const { data: p } = await svc.from('profiles').select('avatar_url').eq('id', uid).maybeSingle();
    check('profiles.avatar_url set to own upload', p?.avatar_url === url, p?.avatar_url);

    // audits written for both self-service actions
    const { data: audits } = await svc
      .from('hr_audit_log')
      .select('reason')
      .eq('table_name', 'profiles')
      .eq('record_id', uid)
      .in('reason', ['Self-service phone update', 'Self-service avatar update']);
    check('both actions audited', new Set((audits ?? []).map((a) => a.reason)).size === 2, audits?.map((a) => a.reason));

    // no session → 401
    const anon = await fetch(`${BASE}/api/hr/ess/profile/contact`, { method: 'PUT', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '02' }) });
    check('anon contact blocked (401/403/redirect)', anon.status === 401 || anon.status === 403 || (anon.status >= 300 && anon.status < 400), anon.status);
  } finally {
    await svc.from('profiles').update({ phone: orig?.phone ?? null, avatar_url: orig?.avatar_url ?? null }).eq('id', uid);
    const marker = '/object/public/avatars/';
    const paths = uploaded.filter((x) => x.includes(marker)).map((x) => decodeURIComponent(x.split(marker)[1]));
    if (paths.length) await svc.storage.from('avatars').remove(paths).catch(() => {});
    await svc.from('hr_audit_log').delete().eq('table_name', 'profiles').eq('record_id', uid).in('reason', ['Self-service phone update', 'Self-service avatar update']);
  }

  process.exit(summary('HR_E2E_ESS_PROFILE') ? 0 : 1);
})().catch((e) => { console.error('ESS_PROFILE ERROR', e); process.exit(1); });
