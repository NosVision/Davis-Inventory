import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { buildEmployeeNameMap } from '@/lib/hr/employee-name-map';
import { callerCanViewConfidentialPay } from '@/lib/hr/pay-visibility';

/**
 * Payroll groups — slices of one company's payroll that are run separately, so two HR users can
 * each own part of it without their people mixing (owner ask 2026-08-11).
 *
 * A group with MANAGERS listed (hr_payroll_group_managers, §00195) is restricted: only those users
 * — plus can_view_confidential_pay holders — may see its members' pay or build its payrun. A group
 * with no managers is open to any HR user, exactly as before. Employees with no group are the
 * default slice (a payrun with payroll_group_id IS NULL), which can never be restricted.
 *
 * Editing the manager list needs can_view_confidential_pay, NOT merely can_manage_hr. If any HR
 * user could edit it, the lock would be decorative: remove the one manager and the group is yours.
 */
const TABLE = 'hr_payroll_groups';
const MANAGERS_TABLE = 'hr_payroll_group_managers';

const MANAGER_EDIT_REFUSAL =
  'ต้องมีสิทธิ์ "ดูเงินเดือนได้ทุกคน" จึงจะกำหนดผู้จัดการกลุ่มได้ — ไม่งั้นใครก็ปลดล็อกกลุ่มลับได้';

interface ManagerRow {
  group_id: string;
  user_id: string;
}

/** Normalize a client-supplied manager list to unique non-empty ids, or null when not sent. */
function readManagerIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/** Replace one group's manager list wholesale, then audit the before/after. */
async function replaceManagers(
  service: ReturnType<typeof createServiceClient>,
  groupId: string,
  managerIds: readonly string[],
  actorId: string,
  groupName: string
): Promise<string | null> {
  const { data: existing } = await service
    .from(MANAGERS_TABLE)
    .select('user_id')
    .eq('group_id', groupId);
  const before = (existing ?? []).map((r) => r.user_id as string).sort();
  const after = [...managerIds].sort();
  if (JSON.stringify(before) === JSON.stringify(after)) return null;

  const { error: delErr } = await service.from(MANAGERS_TABLE).delete().eq('group_id', groupId);
  if (delErr) return delErr.message;

  if (after.length > 0) {
    const { error: insErr } = await service
      .from(MANAGERS_TABLE)
      .insert(after.map((userId) => ({ group_id: groupId, user_id: userId, created_by: actorId })));
    if (insErr) return insErr.message;
  }

  await logHrAudit(service, {
    actorId,
    action: 'update',
    table: MANAGERS_TABLE,
    recordId: groupId,
    before: { manager_ids: before },
    after: { manager_ids: after },
    reason: `ผู้จัดการกลุ่มเงินเดือน "${groupName}"`,
  });
  return null;
}

// GET /api/hr/payroll-groups?company_id= — groups with their managers and member counts, plus the
// HR users who may be assigned as managers.
export async function GET(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const companyId = request.nextUrl.searchParams.get('company_id');
  const service = createServiceClient();

  let q = service.from(TABLE).select('id, company_id, name, note, sort_order, created_at');
  if (companyId) q = q.eq('company_id', companyId);
  const { data: groups, error } = await q.order('sort_order').order('name');
  if (error) return NextResponse.json({ error: 'Failed to load payroll groups' }, { status: 500 });

  let empQ = service
    .from('hr_employees')
    .select('payroll_group_id, company_id, pay_confidential')
    .in('status', ['active', 'probation']);
  if (companyId) empQ = empQ.eq('company_id', companyId);

  const [{ data: emps }, managersRes, candidatesRes, canEditManagers] = await Promise.all([
    empQ,
    service.from(MANAGERS_TABLE).select('group_id, user_id'),
    // Only someone who can already run HR can own a payroll slice. Mirrors can_manage_hr():
    // role owner/hr, or an explicit grant.
    service.from('profiles').select('id, username, display_name, role').eq('active', true),
    callerCanViewConfidentialPay(service, auth.userId),
  ]);

  const { data: grants } = await service
    .from('user_permissions')
    .select('user_id')
    .eq('permission', 'can_manage_hr');
  const grantedIds = new Set((grants ?? []).map((g) => g.user_id as string));
  const candidates = (
    (candidatesRes.data ?? []) as {
      id: string;
      username: string;
      display_name: string | null;
      role: string;
    }[]
  ).filter((c) => c.role === 'owner' || c.role === 'hr' || grantedIds.has(c.id));

  const managerRows = (managersRes.data ?? []) as ManagerRow[];
  const names = await buildEmployeeNameMap(service, [
    ...managerRows.map((m) => m.user_id),
    ...candidates.map((c) => c.id),
  ]);
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const decorate = (id: string) => {
    const c = candidateById.get(id);
    return {
      user_id: id,
      name: names.get(id)?.name ?? c?.display_name ?? c?.username ?? '—',
      nickname: names.get(id)?.nickname ?? null,
      role: c?.role ?? null,
    };
  };

  const managersByGroup = new Map<string, ReturnType<typeof decorate>[]>();
  for (const m of managerRows) {
    const list = managersByGroup.get(m.group_id) ?? [];
    list.push(decorate(m.user_id));
    managersByGroup.set(m.group_id, list);
  }

  const counts = new Map<string, { total: number; confidential: number }>();
  for (const e of (emps ?? []) as { payroll_group_id: string | null; pay_confidential: boolean }[]) {
    // null → the default slice, keyed as '' so it can be reported alongside the named ones.
    const key = e.payroll_group_id ?? '';
    const cur = counts.get(key) ?? { total: 0, confidential: 0 };
    cur.total += 1;
    if (e.pay_confidential) cur.confidential += 1;
    counts.set(key, cur);
  }

  return NextResponse.json({
    data: {
      groups: (groups ?? []).map((g) => ({
        ...g,
        employee_count: counts.get(g.id as string)?.total ?? 0,
        confidential_count: counts.get(g.id as string)?.confidential ?? 0,
        managers: managersByGroup.get(g.id as string) ?? [],
      })),
      ungrouped: counts.get('') ?? { total: 0, confidential: 0 },
      candidates: candidates.map((c) => decorate(c.id)),
      // Drives the UI: whether this caller may edit manager lists at all, and who files the
      // company-wide statutory documents no group manager can produce alone.
      can_edit_managers: canEditManagers,
    },
  });
}

// POST /api/hr/payroll-groups { company_id, name, note?, manager_ids? }
export async function POST(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyId = typeof body.company_id === 'string' ? body.company_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;
  const managerIds = readManagerIds(body.manager_ids) ?? [];
  if (!companyId || !name) {
    return NextResponse.json({ error: 'company_id and name are required' }, { status: 400 });
  }

  const service = createServiceClient();
  if (managerIds.length > 0 && !(await callerCanViewConfidentialPay(service, auth.userId))) {
    return NextResponse.json({ error: MANAGER_EDIT_REFUSAL }, { status: 403 });
  }

  const { data, error } = await service
    .from(TABLE)
    .insert({ company_id: companyId, name, note, created_by: auth.userId })
    .select('id, name')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'มีกลุ่มชื่อนี้ในบริษัทนี้อยู่แล้ว' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'create',
    table: TABLE,
    recordId: data.id as string,
    before: null,
    after: data as Record<string, unknown>,
    reason: `Payroll group created: ${name}`,
  });

  if (managerIds.length > 0) {
    const failure = await replaceManagers(service, data.id as string, managerIds, auth.userId, name);
    if (failure) {
      // The group itself is already created; say so rather than implying nothing happened.
      return NextResponse.json(
        { data, warning: 'สร้างกลุ่มแล้ว แต่บันทึกผู้จัดการกลุ่มไม่สำเร็จ — ลองตั้งอีกครั้ง' },
        { status: 201 }
      );
    }
  }
  return NextResponse.json({ data }, { status: 201 });
}

// PATCH /api/hr/payroll-groups { id, name?, note?, manager_ids? } — rename, re-note, or set who
// owns the group. `manager_ids` replaces the whole list; omit it to leave the list untouched.
export async function PATCH(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const managerIds = readManagerIds(body.manager_ids);

  const service = createServiceClient();
  const { data: before } = await service
    .from(TABLE)
    .select('id, name, note')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'ไม่พบกลุ่มนี้' }, { status: 404 });

  if (managerIds !== null && !(await callerCanViewConfidentialPay(service, auth.userId))) {
    return NextResponse.json({ error: MANAGER_EDIT_REFUSAL }, { status: 403 });
  }

  const fields: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) fields.name = body.name.trim();
  if ('note' in body) fields.note = typeof body.note === 'string' ? body.note.trim() || null : null;

  if (Object.keys(fields).length > 0) {
    const { data: after, error } = await service
      .from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, note')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'มีกลุ่มชื่อนี้ในบริษัทนี้อยู่แล้ว' }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: TABLE,
      recordId: id,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      reason: 'แก้ไขกลุ่มเงินเดือน',
    });
  }

  if (managerIds !== null) {
    const failure = await replaceManagers(
      service,
      id,
      managerIds,
      auth.userId,
      (fields.name as string) ?? (before.name as string)
    );
    if (failure) {
      return NextResponse.json({ error: 'บันทึกผู้จัดการกลุ่มไม่สำเร็จ' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/hr/payroll-groups?id= — refused while any payrun still references the group, so a
// run can never be orphaned from the population it was built for.
export async function DELETE(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const service = createServiceClient();
  const { count } = await service
    .from('hr_payruns')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_group_id', id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `ลบไม่ได้ — มีงวดเงินเดือน ${count} งวดที่ใช้กลุ่มนี้อยู่` },
      { status: 409 }
    );
  }

  const { data: before } = await service.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'ไม่พบกลุ่มนี้' }, { status: 404 });

  // Deleting a RESTRICTED group is the same act as clearing its manager list: members fall back to
  // the ungrouped slice and their pay becomes readable by every HR user. Same grant required.
  const { count: managerCount } = await service
    .from(MANAGERS_TABLE)
    .select('user_id', { count: 'exact', head: true })
    .eq('group_id', id);
  if ((managerCount ?? 0) > 0 && !(await callerCanViewConfidentialPay(service, auth.userId))) {
    return NextResponse.json({ error: MANAGER_EDIT_REFUSAL }, { status: 403 });
  }

  // Members fall back to the default slice (FK is ON DELETE SET NULL) rather than vanishing.
  const { error } = await service.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'delete',
    table: TABLE,
    recordId: id,
    before: before as Record<string, unknown>,
    after: null,
    reason: 'Payroll group deleted — members returned to the ungrouped slice',
  });
  return NextResponse.json({ success: true });
}
