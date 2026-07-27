import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager, resolveHrScope } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import {
  pickEmployeeFields,
  applyPartTimeProfile,
  validatePartTimeDocs,
  computeProbationEnd,
} from '@/lib/hr/employees';
import { getHrPolicies } from '@/lib/hr/policy';
import { applyPendingLeaveBalances } from '@/lib/hr/leave-balance-link';
import {
  type EmployeeDocument,
} from '@/lib/hr/employees';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Consume an imported (unclaimed) roster row for a just-created employee record: flip it to
 * 'linked' so the same person cannot also self-claim that name, back-link their historical
 * payslips, materialize staged sheet leave balances, and stamp the formal payroll full name
 * onto hr_employees (mirrors the identity-claim approve flow). Shared by BOTH onboarding
 * modes — create-new-account and link-existing-account (client report 2026-07-21: linking a
 * sheet identity to an existing login was impossible). Best-effort: problems land in
 * `warnings`, never a 500 (the employee row is already committed).
 */
async function consumePendingIdentity(
  service: ReturnType<typeof createServiceClient>,
  opts: { pendingIdentityId: string; employeeId: string; companyId: string | null; note: string; actorId: string },
  warnings: string[]
): Promise<void> {
  const { data: flipped } = await service
    .from('hr_pending_identities')
    .update({
      status: 'linked',
      reviewed_by: opts.actorId,
      reviewed_at: new Date().toISOString(),
      linked_employee_id: opts.employeeId,
      review_note: opts.note,
    })
    .eq('id', opts.pendingIdentityId)
    .eq('status', 'unclaimed')
    .select('id, full_name_th');
  if (!flipped?.length) {
    warnings.push('Imported identity was already taken — check for a duplicate record');
    return;
  }

  // Formal payroll name (slips/accountant review print this) — only fill a blank, never
  // overwrite a name HR already maintains.
  const fullName = (flipped[0].full_name_th as string | null)?.trim();
  if (fullName) {
    await service
      .from('hr_employees')
      .update({ full_name: fullName })
      .eq('id', opts.employeeId)
      .is('full_name', null);
  }

  const { error: histErr } = await service
    .from('hr_imported_payslips')
    .update({ employee_id: opts.employeeId })
    .eq('pending_identity_id', opts.pendingIdentityId);
  if (histErr) warnings.push('Historical payslips were not back-linked — link them manually');

  // Materialize staged sheet-imported leave balances for this identity (00166) — best-effort.
  try {
    await applyPendingLeaveBalances(service, {
      pendingIdentityId: opts.pendingIdentityId,
      employeeId: opts.employeeId,
      companyId: opts.companyId,
    });
  } catch (e) {
    console.error('hr onboarding: staged leave balances failed', e);
  }
}
// Valid employee roles for onboarding (never 'owner'/'customer'). HR may mint any of
// these — the elevated owner-only gate was removed 2026-07-23 (owner ask).
const ALLOWED_NEW_ROLES = ['staff', 'bar', 'head_bar', 'manager', 'accountant', 'hq', 'technician', 'hr', 'cashier', 'housekeeping_staff', 'boh_staff', 'not_assign'];
const SEARCH_CAP = 500;

const LIST_SELECT =
  'id, profile_id, employee_code, full_name, rate_satang, pay_type, work_hours_per_day, ot_eligible, ' +
  'ot_hour_divisor, standard_days_off, tax_mode, sso_enrolled, status, start_date, probation_end, ' +
  'bank_name, bank_account_no, ' + // for the printable register (HR-gated route)
  'company_id, position_id, department_id, created_at, ' +
  'profile:profiles!hr_employees_profile_id_fkey(id, username, display_name, active, avatar_url, role), ' + // role → สิทธิ์ระบบ column

  'position:hr_positions(id, name), department:hr_departments(id, name), company:hr_companies(id, name)';

// GET /api/hr/employees — list with filters: q, store_id, position_id, department_id, company_id, pay_type, status, limit, offset
export async function GET(request: NextRequest) {
  // §P5.5: company-wide HR sees all employees; a store-scoped manager sees only employees whose
  // user_stores intersect their scope.
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const storeId = sp.get('store_id');
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  const service = createServiceClient();

  // Optional profile_id filter from the (safe, parameterized) search + store filters.
  const idSets: string[][] = [];
  if (q) {
    const like = `%${q}%`;
    const [n1, n2, ec, fn] = await Promise.all([
      service.from('profiles').select('id').ilike('display_name', like).limit(SEARCH_CAP),
      service.from('profiles').select('id').ilike('username', like).limit(SEARCH_CAP),
      service.from('hr_employees').select('profile_id').ilike('employee_code', like).limit(SEARCH_CAP),
      // The registry shows the employee's real full name, so let HR search by it too.
      service.from('hr_employees').select('profile_id').ilike('full_name', like).limit(SEARCH_CAP),
    ]);
    if (n1.error || n2.error || ec.error || fn.error) {
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
    const set = new Set<string>();
    (n1.data ?? []).forEach((r) => set.add(r.id as string));
    (n2.data ?? []).forEach((r) => set.add(r.id as string));
    (ec.data ?? []).forEach((r) => set.add(r.profile_id as string));
    (fn.data ?? []).forEach((r) => set.add(r.profile_id as string));
    idSets.push([...set]);
  }
  if (storeId) {
    const { data: us, error: usErr } = await service
      .from('user_stores')
      .select('user_id')
      .eq('store_id', storeId);
    if (usErr) return NextResponse.json({ error: 'Store filter failed' }, { status: 500 });
    idSets.push((us ?? []).map((r) => r.user_id as string));
  }
  // §P5.5: constrain a scoped manager to employees in their stores (company-wide HR → storeIds null).
  if (scope.storeIds) {
    const { data: us, error: usErr } = await service
      .from('user_stores')
      .select('user_id')
      .in('store_id', scope.storeIds);
    if (usErr) return NextResponse.json({ error: 'Scope filter failed' }, { status: 500 });
    idSets.push((us ?? []).map((r) => r.user_id as string));
  }
  // Intersect every id set (search ∩ store filter ∩ scope) into the final profile_id filter.
  const profileIdFilter: string[] | null = idSets.length
    ? idSets.reduce<string[] | null>((acc, s) => {
        if (acc === null) return [...s];
        const set = new Set(s);
        return acc.filter((x) => set.has(x));
      }, null)
    : null;

  // Printer system accounts (printer-{store_code}) must never show as employees, even if one
  // was accidentally linked to an hr_employees row (owner ask 2026-07-27).
  const { data: printerProfiles } = await service
    .from('profiles')
    .select('id')
    .ilike('username', 'printer-%');
  const printerIds = (printerProfiles ?? []).map((r) => r.id as string);

  let query = service.from('hr_employees').select(LIST_SELECT, { count: 'exact' });
  for (const key of ['position_id', 'department_id', 'company_id', 'pay_type', 'status'] as const) {
    const v = sp.get(key);
    if (v) query = query.eq(key, v);
  }
  if (profileIdFilter) query = query.in('profile_id', profileIdFilter.length ? profileIdFilter : [NIL_UUID]);
  if (printerIds.length) query = query.not('profile_id', 'in', `(${printerIds.join(',')})`);
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with venues (from user_stores → stores) for the returned page.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const profileIds = rows.map((e) => e.profile_id as string);
  const venueMap: Record<string, Array<{ id: string; store_name: string }>> = {};
  if (profileIds.length) {
    const { data: us, error: vErr } = await service
      .from('user_stores')
      .select('user_id, store:stores(id, store_name)')
      .in('user_id', profileIds);
    if (vErr) console.error('hr employees list: venue enrichment failed', vErr.message);
    (us ?? []).forEach((r) => {
      const uid = r.user_id as string;
      (venueMap[uid] ??= []).push(r.store as unknown as { id: string; store_name: string });
    });
  }
  const enriched = rows.map((e) => ({ ...e, stores: venueMap[e.profile_id as string] ?? [] }));

  return NextResponse.json({ data: enriched, count: count ?? 0 });
}

// POST /api/hr/employees — onboard a new person: auth account + profile + hr_employees.
// OR link an EXISTING account: pass `link_profile_id` and no new auth user is created — the
// hr_employees row attaches to the profile the person already logs in with, so their punches,
// schedule, leaves and payslip self-read (all keyed on profiles.id) line up with their HR record.
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // ── Link-existing mode ──────────────────────────────────────────────────────
  const linkProfileId = typeof body.link_profile_id === 'string' ? body.link_profile_id : '';
  if (linkProfileId) {
    const picked0 = pickEmployeeFields(body, false);
    if (!picked0.ok) return NextResponse.json({ error: 'Validation failed', fields: picked0.errors }, { status: 400 });
    const withForced0 = applyPartTimeProfile({ ...picked0.fields, pay_type: picked0.fields.pay_type as string });
    const fields0: Record<string, unknown> = { ...withForced0 };
    if (fields0.start_date && !fields0.probation_end) {
      const policies0 = await getHrPolicies(createServiceClient());
      fields0.probation_end = computeProbationEnd(fields0.start_date as string, policies0.probation_days);
    }
    const docs0 = (fields0.documents as EmployeeDocument[] | undefined) ?? [];
    const docErr0 = validatePartTimeDocs(fields0.pay_type as string, docs0);
    if (docErr0) return NextResponse.json({ error: docErr0 }, { status: 400 });

    const service = createServiceClient();
    const { data: prof, error: profErr } = await service
      .from('profiles')
      .select('id, username, role, active')
      .eq('id', linkProfileId)
      .maybeSingle();
    if (profErr) return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    if (!prof) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    // Same policy as onboarding: never an owner or customer account. (No role change happens
    // here — linking grants nothing — so the owner-only elevated-role gate does not apply.)
    if (prof.role === 'owner' || prof.role === 'customer') {
      return NextResponse.json({ error: `Cannot link a '${prof.role}' account as an employee` }, { status: 400 });
    }
    const { data: dup } = await service
      .from('hr_employees')
      .select('id')
      .eq('profile_id', linkProfileId)
      .maybeSingle();
    if (dup) return NextResponse.json({ error: 'This user already has an employee record' }, { status: 409 });

    const { data: emp, error: empErr } = await service
      .from('hr_employees')
      .insert({ profile_id: linkProfileId, ...fields0, created_by: auth.userId })
      .select('*')
      .single();
    if (empErr) {
      if ((empErr as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'This user already has an employee record' }, { status: 409 });
      }
      return NextResponse.json({ error: empErr.message }, { status: 500 });
    }

    // Venue assignment: only add memberships the account doesn't already have.
    const warnings: string[] = [];

    // A deactivated account becomes a live login again the moment it is linked as an
    // employee (returning-staff case). Done after the insert so a failed link never
    // silently re-enables a login.
    if (!prof.active) {
      const { error: actErr } = await service
        .from('profiles')
        .update({ active: true })
        .eq('id', linkProfileId);
      if (actErr) {
        warnings.push('เปิดใช้งานบัญชีอัตโนมัติไม่สำเร็จ — ไปเปิดใช้งานที่หน้าจัดการผู้ใช้');
      }
    }
    const linkStoreIds = Array.isArray(body.storeIds)
      ? body.storeIds.filter((s): s is string => typeof s === 'string')
      : [];
    if (linkStoreIds.length) {
      const { data: existing } = await service
        .from('user_stores')
        .select('store_id')
        .eq('user_id', linkProfileId);
      const have = new Set((existing ?? []).map((r) => r.store_id as string));
      const missing = linkStoreIds.filter((sid) => !have.has(sid));
      if (missing.length) {
        const { error: storesErr } = await service
          .from('user_stores')
          .insert(missing.map((sid) => ({ user_id: linkProfileId, store_id: sid })));
        if (storesErr) warnings.push('Store assignment failed — assign venues manually');
      }
    }

    // Sheet identity picked alongside the existing login — consume it exactly like the
    // create-new-account path (historical payslips, leave balances, payroll full name).
    const linkPendingIdentityId = typeof body.pending_identity_id === 'string' ? body.pending_identity_id : '';
    if (linkPendingIdentityId) {
      await consumePendingIdentity(
        service,
        {
          pendingIdentityId: linkPendingIdentityId,
          employeeId: emp.id as string,
          companyId: (emp.company_id as string | null) ?? null,
          note: `Linked via add-employee prefill to existing account ${prof.username ?? linkProfileId}`,
          actorId: auth.userId,
        },
        warnings
      );
    }

    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'create',
      table: 'hr_employees',
      recordId: emp.id,
      before: null,
      after: emp,
      reason: `Linked existing account ${prof.username ?? linkProfileId}${prof.active ? '' : ' (re-activated a disabled login)'}${linkPendingIdentityId ? ' + imported sheet identity' : ''}`,
    });

    return NextResponse.json({ id: emp.id, profileId: linkProfileId, linked: true, warnings }, { status: 201 });
  }

  const username = String(body.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    return NextResponse.json({ error: 'username must be >=3 chars [a-z0-9._-]' }, { status: 400 });
  }
  const displayName = typeof body.display_name === 'string' && body.display_name ? body.display_name : null;

  // Role gate — block privilege escalation (CRITICAL): never onboard owner/customer;
  // elevated (owner-equivalent / cross-cutting) roles require an OWNER caller.
  let role = typeof body.role === 'string' ? body.role : 'staff';
  if (role === 'owner' || role === 'customer') {
    return NextResponse.json({ error: `Cannot onboard an employee with role '${role}'` }, { status: 400 });
  }
  if (!ALLOWED_NEW_ROLES.includes(role)) role = 'staff';
  // Owner ask 2026-07-23: HR may onboard every non-owner role (elevated gate removed).

  const storeIds = Array.isArray(body.storeIds)
    ? body.storeIds.filter((s): s is string => typeof s === 'string')
    : typeof body.store_id === 'string'
      ? [body.store_id]
      : [];

  const picked = pickEmployeeFields(body, false);
  if (!picked.ok) return NextResponse.json({ error: 'Validation failed', fields: picked.errors }, { status: 400 });

  // part-time auto-profile (§A) — forced server-side
  const withForced = applyPartTimeProfile({ ...picked.fields, pay_type: picked.fields.pay_type as string });
  const fields: Record<string, unknown> = { ...withForced };
  if (fields.start_date && !fields.probation_end) {
    const policies = await getHrPolicies(createServiceClient());
    fields.probation_end = computeProbationEnd(fields.start_date as string, policies.probation_days);
  }
  const docs = (fields.documents as EmployeeDocument[] | undefined) ?? [];
  const docErr = validatePartTimeDocs(fields.pay_type as string, docs);
  if (docErr) return NextResponse.json({ error: docErr }, { status: 400 });

  const service = createServiceClient();
  const email = `${username}@stockmanager.app`;
  // HR may supply the initial password (e.g. a simple default to hand over); otherwise a random
  // one is minted. Either way must_change_password forces a reset on first login.
  const providedPassword = typeof body.password === 'string' ? body.password : '';
  const tempPassword = providedPassword.length >= 4 ? providedPassword : `Hr${randomBytes(6).toString('hex')}!`;

  const { data: authData, error: authErr } = await service.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { username, role },
  });
  if (authErr || !authData?.user) {
    if (authErr && String(authErr.message).includes('already been registered')) {
      return NextResponse.json({ error: 'username already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: authErr?.message ?? 'Failed to create account' }, { status: 500 });
  }
  const newUserId = authData.user.id;

  const rollbackAuthUser = async () => {
    await service.auth.admin
      .deleteUser(newUserId)
      .catch((delErr) => console.error('hr onboarding rollback: failed to delete orphaned auth user', newUserId, delErr));
  };

  const { error: profileErr } = await service
    .from('profiles')
    .update({ username, role, display_name: displayName, active: true, must_change_password: true, created_by: auth.userId })
    .eq('id', newUserId);
  if (profileErr) {
    await rollbackAuthUser();
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { data: emp, error: empErr } = await service
    .from('hr_employees')
    .insert({ profile_id: newUserId, ...fields, created_by: auth.userId })
    .select('*')
    .single();
  if (empErr) {
    await rollbackAuthUser();
    return NextResponse.json({ error: empErr.message }, { status: 500 });
  }

  const warnings: string[] = [];
  if (storeIds.length) {
    const { error: storesErr } = await service
      .from('user_stores')
      .insert(storeIds.map((sid) => ({ user_id: newUserId, store_id: sid })));
    if (storesErr) {
      console.error('hr onboarding: store assignment failed', newUserId, storesErr.message);
      warnings.push('Store assignment failed — assign venues manually');
    }
  }

  // When this onboarding was prefilled from an imported (unclaimed) roster row, consume it.
  const pendingIdentityId = typeof body.pending_identity_id === 'string' ? body.pending_identity_id : '';
  if (pendingIdentityId) {
    await consumePendingIdentity(
      service,
      {
        pendingIdentityId,
        employeeId: emp.id as string,
        companyId: (emp.company_id as string | null) ?? null,
        note: 'Linked via add-employee prefill',
        actorId: auth.userId,
      },
      warnings
    );
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: 'hr_employees',
    recordId: emp.id,
    before: null,
    after: emp,
    reason: null,
  });

  return NextResponse.json({ id: emp.id, profileId: newUserId, tempPassword, warnings }, { status: 201 });
}
