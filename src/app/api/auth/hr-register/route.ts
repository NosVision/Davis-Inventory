import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

// Verify an existing login (username + password) WITHOUT persisting a session — used when a
// self-registering hire matches an account that already exists, so they can link their imported
// name to it instead of creating a duplicate. A throwaway anon client checks the credentials.
async function verifyLogin(username: string, password: string): Promise<{ ok: boolean; userId?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false };
  const sb = createSbClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${username}@stockmanager.app`, password });
  if (error || !data?.user) return { ok: false };
  return { ok: true, userId: data.user.id };
}

// Public HR self-registration (owner ask 2026-07-10). Token-gated, service-role. A new hire opens
// the HR link, sets a username + password, matches an imported identity (or types name + bank),
// picks a position/company, and the app creates their account (role 'not_assign') + hr_employees.
// No session is required; the reusable link token is the only credential.

const USERNAME_RE = /^[a-z0-9_]+$/;
const USED_COUNT_CAP = 1000; // runaway backstop for a leaked link

type Link = { id: string; company_id: string | null; created_by: string | null; used_count: number };

async function loadLink(service: ReturnType<typeof createServiceClient>, token: string): Promise<Link | null> {
  if (!token || token.length < 16 || token.length > 80) return null;
  const { data } = await service
    .from('hr_registration_links')
    .select('id, company_id, created_by, used_count, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return { id: data.id as string, company_id: (data.company_id as string | null) ?? null, created_by: (data.created_by as string | null) ?? null, used_count: Number(data.used_count) || 0 };
}

async function usernameTaken(service: ReturnType<typeof createServiceClient>, username: string): Promise<boolean> {
  const { data } = await service.from('profiles').select('id').ilike('username', username).maybeSingle();
  return !!data;
}

// GET /api/auth/hr-register?token=&action=context|check-username|identities&username=&q=
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const token = sp.get('token') ?? '';
  const action = sp.get('action') ?? 'context';
  const service = createServiceClient();

  const link = await loadLink(service, token);
  if (!link) return NextResponse.json({ error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' }, { status: 410 });

  if (action === 'check-username') {
    const username = (sp.get('username') ?? '').trim().toLowerCase();
    if (username.length < 3 || !USERNAME_RE.test(username)) {
      return NextResponse.json({ data: { available: false, reason: 'invalid' } });
    }
    return NextResponse.json({ data: { available: !(await usernameTaken(service, username)) } });
  }

  if (action === 'identities') {
    const q = (sp.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ data: [] });
    const like = `%${q}%`;
    // Return every status (not just unclaimed) with `status`, so the page can warn when a name is
    // already claimed (under HR review) or linked (HR accepted) instead of letting them re-register.
    let query = service
      .from('hr_pending_identities')
      .select('id, full_name_th, full_name_en, position_text, company_id, bank_name, bank_account_no, status, store:stores(store_name)')
      .or(`full_name_th.ilike.${like},full_name_en.ilike.${like},bank_account_no.ilike.${like}`)
      .limit(15);
    if (link.company_id) query = query.eq('company_id', link.company_id);
    const { data } = await query;
    return NextResponse.json({ data: data ?? [] });
  }

  // default: context — companies + positions for the pickers.
  const [companiesRes, positionsRes] = await Promise.all([
    service.from('hr_companies').select('id, name').order('name'),
    service.from('hr_positions').select('id, name').eq('active', true).order('sort_order'),
  ]);
  const companyName = link.company_id
    ? (companiesRes.data ?? []).find((c) => c.id === link.company_id)?.name ?? null
    : null;
  return NextResponse.json({
    data: {
      valid: true,
      company_id: link.company_id,
      company_name: companyName,
      companies: companiesRes.data ?? [],
      positions: positionsRes.data ?? [],
    },
  });
}

// POST /api/auth/hr-register — create the account + hr_employees.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : '';
  const username = (typeof body.username === 'string' ? body.username : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = (typeof body.full_name === 'string' ? body.full_name : '').trim();
  const bankAccountNo = (typeof body.bank_account_no === 'string' ? body.bank_account_no : '').trim();
  const bankName = (typeof body.bank_name === 'string' ? body.bank_name : '').trim();
  const positionId = typeof body.position_id === 'string' && body.position_id ? body.position_id : null;
  const bodyCompanyId = typeof body.company_id === 'string' && body.company_id ? body.company_id : null;
  const pendingIdentityId = typeof body.pending_identity_id === 'string' && body.pending_identity_id ? body.pending_identity_id : null;

  const action = typeof body.action === 'string' ? body.action : 'create';

  const service = createServiceClient();
  const link = await loadLink(service, token);
  if (!link) return NextResponse.json({ error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' }, { status: 410 });
  if (action === 'create' && link.used_count >= USED_COUNT_CAP) {
    return NextResponse.json({ error: 'ลิงก์นี้ถูกใช้ครบจำนวนแล้ว กรุณาติดต่อ HR' }, { status: 429 });
  }

  // ── verify: the hire hit an existing username — confirm they own it (login password) so they
  // can LINK their imported name instead of creating a duplicate account. ──────────────────────
  if (action === 'verify') {
    if (!username || !password) {
      return NextResponse.json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }, { status: 400 });
    }
    const v = await verifyLogin(username, password);
    if (!v.ok || !v.userId) return NextResponse.json({ data: { ok: false } });
    const [{ data: prof }, { data: emp }] = await Promise.all([
      service.from('profiles').select('display_name, username').eq('id', v.userId).maybeSingle(),
      service.from('hr_employees').select('bank_account_no').eq('profile_id', v.userId).maybeSingle(),
    ]);
    return NextResponse.json({
      data: {
        ok: true,
        display_name: prof?.display_name || prof?.username || username,
        existing_bank_account_no: (emp?.bank_account_no as string | null) ?? null,
        has_employee: !!emp,
      },
    });
  }

  // ── link: confirmed — attach the imported name/bank to the EXISTING account (no new account). ─
  if (action === 'link') {
    if (!fullName) return NextResponse.json({ error: 'กรุณาระบุชื่อ-นามสกุล' }, { status: 400 });
    const v = await verifyLogin(username, password);
    if (!v.ok || !v.userId) return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    const userId = v.userId;

    let linkCompanyId = link.company_id ?? bodyCompanyId;
    if (linkCompanyId) {
      const { data: co } = await service.from('hr_companies').select('id').eq('id', linkCompanyId).maybeSingle();
      if (!co) linkCompanyId = null;
    }

    const { data: existingEmp } = await service.from('hr_employees').select('id').eq('profile_id', userId).maybeSingle();
    const empFields: Record<string, unknown> = { full_name: fullName };
    if (bankAccountNo) empFields.bank_account_no = bankAccountNo;
    if (bankName) empFields.bank_name = bankName;
    if (positionId) empFields.position_id = positionId;
    if (linkCompanyId) empFields.company_id = linkCompanyId;
    if (existingEmp) {
      await service.from('hr_employees').update(empFields).eq('id', existingEmp.id);
    } else {
      await service.from('hr_employees').insert({ profile_id: userId, status: 'probation', created_by: link.created_by, ...empFields });
    }

    if (pendingIdentityId) {
      await service
        .from('hr_pending_identities')
        .update({ status: 'linked', claimed_by: userId, claimed_at: new Date().toISOString() })
        .eq('id', pendingIdentityId)
        .eq('status', 'unclaimed');
    }
    await service.from('hr_registration_links').update({ used_count: link.used_count + 1 }).eq('id', link.id);
    await service.from('audit_logs').insert({
      action_type: 'HR_SELF_LINKED', table_name: 'hr_employees', record_id: userId,
      new_value: { username, full_name: fullName, via: 'hr_registration_link' }, changed_by: userId,
    });
    return NextResponse.json({ data: { success: true, linked: true, username } });
  }

  // Validate inputs (mirrors the client rules; a reason is surfaced in Thai).
  if (username.length < 3 || !USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'ชื่อผู้ใช้ต้องยาว 3 ตัวขึ้นไป (a-z, 0-9, _ เท่านั้น)' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อ-นามสกุล' }, { status: 400 });
  }
  if (await usernameTaken(service, username)) {
    return NextResponse.json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' }, { status: 409 });
  }
  // Guard: don't create a new account for a name that's already claimed (under review) or linked.
  if (pendingIdentityId) {
    const { data: pid } = await service.from('hr_pending_identities').select('status').eq('id', pendingIdentityId).maybeSingle();
    if (pid && pid.status !== 'unclaimed') {
      return NextResponse.json({ error: 'ชื่อนี้ลงทะเบียนไปแล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิม' }, { status: 409 });
    }
  }

  // A company scope on the link wins; otherwise take the picked company (validated to exist).
  let companyId = link.company_id ?? bodyCompanyId;
  if (companyId) {
    const { data: co } = await service.from('hr_companies').select('id').eq('id', companyId).maybeSingle();
    if (!co) companyId = null;
  }

  // 1. Create the auth account (email = username@stockmanager.app, like the invite flow).
  const email = `${username}@stockmanager.app`;
  const { data: authData, error: authErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, role: 'not_assign' },
  });
  if (authErr || !authData?.user) {
    if (authErr?.message?.includes('already been registered')) {
      return NextResponse.json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: 'สร้างบัญชีไม่สำเร็จ' }, { status: 500 });
  }
  const userId = authData.user.id;

  // 2. Finalize the profile (the trigger created a default row).
  await service
    .from('profiles')
    .update({ username, role: 'not_assign', display_name: fullName, active: true })
    .eq('id', userId);

  // 3. Create the linked hr_employees record (pending an HR role/salary review).
  const { error: empErr } = await service.from('hr_employees').insert({
    profile_id: userId,
    company_id: companyId,
    position_id: positionId,
    full_name: fullName,
    bank_account_no: bankAccountNo || null,
    bank_name: bankName || null,
    status: 'probation',
    created_by: link.created_by,
  });
  if (empErr) {
    // The account exists but the HR record failed — surface it so HR can complete it manually.
    console.error('[hr-register] hr_employees insert failed:', empErr.message);
  }

  // 4. Link an imported identity, if the hire matched one.
  if (pendingIdentityId) {
    await service
      .from('hr_pending_identities')
      .update({ status: 'linked', claimed_by: userId, claimed_at: new Date().toISOString() })
      .eq('id', pendingIdentityId)
      .eq('status', 'unclaimed');
  }

  // 5. Bump the link's use count + audit.
  await service.from('hr_registration_links').update({ used_count: link.used_count + 1 }).eq('id', link.id);
  await service.from('audit_logs').insert({
    action_type: 'HR_SELF_REGISTERED',
    table_name: 'profiles',
    record_id: userId,
    new_value: { username, full_name: fullName, company_id: companyId, position_id: positionId, via: 'hr_registration_link' },
    changed_by: userId,
  });

  return NextResponse.json({ data: { success: true, username } }, { status: 201 });
}
