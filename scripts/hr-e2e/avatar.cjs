// P1.5 employee avatar — live e2e: HR uploads a real PNG via multipart to the scoped avatar
// route → profiles.avatar_url points at the public avatars bucket; re-upload replaces the file
// and deletes the old one; bad type 400; staff 403. Restores the original avatar_url.
const { login, creds, serviceClient, makeCounter, BASE } = require('./lib.cjs');
const { check, summary } = makeCounter();
const u = (n) => creds.users.find((x) => x.username === n);

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function uploadAvatar(session, empId, buf, type, name) {
  const fd = new FormData();
  fd.append('file', new File([buf], name, { type }));
  const res = await fetch(`${BASE}/api/hr/employees/${empId}/avatar`, {
    method: 'POST',
    headers: { cookie: session.cookieHeader() },
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  const svc = await serviceClient();
  const hr = await login(u('hr-test-hr').email, u('hr-test-hr').password);
  const staff = await login(u('hr-test-staff').email, u('hr-test-staff').password);

  const staffProfileId = u('hr-test-staff').id;
  const { data: emp } = await svc.from('hr_employees').select('id').eq('profile_id', staffProfileId).maybeSingle();
  check('setup: staff employee exists', !!emp, emp);

  const { data: origProf } = await svc.from('profiles').select('avatar_url').eq('id', staffProfileId).maybeSingle();
  const origUrl = origProf?.avatar_url ?? null;

  const uploaded = [];
  try {
    // upload #1
    const r1 = await uploadAvatar(hr, emp.id, PNG, 'image/png', 'a.png');
    check('upload 201', r1.status === 201, `${r1.status} ${JSON.stringify(r1.json).slice(0, 120)}`);
    const url1 = r1.json?.data?.avatar_url ?? '';
    check('url points at public avatars bucket', url1.includes('/object/public/avatars/'), url1);
    uploaded.push(url1);

    const { data: p1 } = await svc.from('profiles').select('avatar_url').eq('id', staffProfileId).maybeSingle();
    check('profiles.avatar_url updated', p1?.avatar_url === url1, p1?.avatar_url);

    // the file is actually served
    const head1 = await fetch(url1);
    check('avatar publicly fetchable', head1.ok, head1.status);

    // upload #2 replaces + old file removed
    const r2 = await uploadAvatar(hr, emp.id, PNG, 'image/png', 'b.png');
    check('re-upload 201', r2.status === 201, r2.status);
    const url2 = r2.json?.data?.avatar_url ?? '';
    uploaded.push(url2);
    check('new url differs', url2 !== url1 && url2.includes('/object/public/avatars/'), url2);
    // old file gone from STORAGE (HTTP would hit the CDN cache and still 200 for a while)
    const oldPath = decodeURIComponent(url1.split('/object/public/avatars/')[1]);
    const { data: folder } = await svc.storage.from('avatars').list(oldPath.split('/')[0]);
    check('old file removed from bucket', !(folder ?? []).some((f) => `${oldPath.split('/')[0]}/${f.name}` === oldPath), folder?.map((f) => f.name));

    // guards
    const bad = await uploadAvatar(hr, emp.id, Buffer.from('hello'), 'text/plain', 'x.txt');
    check('bad type 400', bad.status === 400, bad.status);
    const s = await uploadAvatar(staff, emp.id, PNG, 'image/png', 'c.png');
    check('staff upload FORBIDDEN', s.status === 401 || s.status === 403, s.status);

    // audit written
    const { data: audits } = await svc
      .from('hr_audit_log')
      .select('id')
      .eq('table_name', 'profiles')
      .eq('record_id', staffProfileId)
      .eq('reason', 'Employee avatar updated');
    check('audit records the change', (audits ?? []).length >= 2, audits?.length);
  } finally {
    // restore original avatar_url + clean uploaded files
    await svc.from('profiles').update({ avatar_url: origUrl }).eq('id', staffProfileId);
    const marker = '/object/public/avatars/';
    const paths = uploaded.filter((x) => x.includes(marker)).map((x) => decodeURIComponent(x.split(marker)[1]));
    if (paths.length) await svc.storage.from('avatars').remove(paths).catch(() => {});
    await svc.from('hr_audit_log').delete().eq('table_name', 'profiles').eq('record_id', staffProfileId).eq('reason', 'Employee avatar updated');
  }

  process.exit(summary('HR_E2E_AVATAR') ? 0 : 1);
})().catch((e) => { console.error('AVATAR ERROR', e); process.exit(1); });
