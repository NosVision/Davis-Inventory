import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { callerCanViewConfidentialPay, CONFIDENTIAL_PAY_PERMISSION } from '@/lib/hr/pay-visibility';
import { loadDocumentIssuers } from '@/lib/hr/document-issuers';

/**
 * PUT /api/hr/payroll-document-issuers { user_ids } — set who may issue the company-wide statutory
 * documents (owner ask 2026-08-26).
 *
 * Deliberately its own route rather than a relaxation of /api/users/[id]/permissions. That screen
 * manages EVERY permission and stays owner-only; loosening it so an issuer could edit this one
 * grant would have handed them all the others too. Here the blast radius is a single permission.
 *
 * Who may call it: an owner, or someone who already issues documents. Both already see every
 * salary in the company, so neither gains anything by naming a peer — which is what makes this the
 * one grant an existing holder can safely extend. Every other permission still needs an owner.
 */
const PERMISSION = CONFIDENTIAL_PAY_PERMISSION;

export async function PUT(request: NextRequest) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();
  if (!(await callerCanViewConfidentialPay(service, auth.userId))) {
    return NextResponse.json(
      { error: 'เฉพาะเจ้าของระบบ หรือผู้ที่ออกเอกสารบริษัทได้อยู่แล้ว จึงจะแก้รายชื่อนี้ได้' },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(body.user_ids)) {
    return NextResponse.json({ error: 'user_ids must be an array' }, { status: 400 });
  }
  const requested = new Set(
    (body.user_ids as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
  );

  const { candidates } = await loadDocumentIssuers(service);
  const byId = new Map(candidates.map((c) => [c.user_id, c]));

  // Only a real, active, non-system HR account may be named. Anything else is a stale id or a
  // hand-crafted request; refusing beats silently dropping it, because the caller believes they
  // just granted someone the right to see every salary in the company.
  const unknown = [...requested].filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: 'มีผู้ใช้ที่เลือกไม่อยู่ในรายชื่อที่กำหนดได้ — โหลดหน้าใหม่แล้วลองอีกครั้ง' },
      { status: 400 }
    );
  }

  // Owners already hold the right through their role; an explicit row for them would be a no-op
  // that later reads as removable. Drop them from both sides of the comparison.
  const desired = new Set([...requested].filter((id) => !byId.get(id)?.implicit));
  const existing = new Set(
    candidates.filter((c) => c.is_issuer && !c.implicit).map((c) => c.user_id)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) {
    return NextResponse.json({ success: true, added: 0, removed: 0 });
  }

  // Removing yourself would take away the very right that lets you edit this list — and unlike
  // every other change here, you could not undo it. An owner or another issuer can still remove
  // you; you just cannot walk out and lock the door behind you.
  if (toRemove.includes(auth.userId)) {
    return NextResponse.json(
      { error: 'ถอนสิทธิ์ของตัวเองไม่ได้ — ให้เจ้าของระบบหรือผู้ออกเอกสารคนอื่นเป็นคนถอนให้' },
      { status: 400 }
    );
  }

  if (toRemove.length > 0) {
    const { error } = await service
      .from('user_permissions')
      .delete()
      .eq('permission', PERMISSION)
      .in('user_id', toRemove);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (toAdd.length > 0) {
    const { error } = await service
      .from('user_permissions')
      .insert(toAdd.map((userId) => ({ user_id: userId, permission: PERMISSION })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One row per person, so the audit page can answer "when did X get this?" without reading a diff.
  const label = (id: string) => byId.get(id)?.name ?? id;
  await Promise.all([
    ...toAdd.map((id) =>
      logHrAudit(service, {
        actorId: auth.userId,
        action: 'create',
        table: 'user_permissions',
        recordId: id,
        before: null,
        after: { permission: PERMISSION },
        reason: `ให้สิทธิ์ออกเอกสารบริษัท & ดูเงินเดือนทุกคน แก่ ${label(id)}`,
      })
    ),
    ...toRemove.map((id) =>
      logHrAudit(service, {
        actorId: auth.userId,
        action: 'delete',
        table: 'user_permissions',
        recordId: id,
        before: { permission: PERMISSION },
        after: null,
        reason: `ถอนสิทธิ์ออกเอกสารบริษัท & ดูเงินเดือนทุกคน จาก ${label(id)}`,
      })
    ),
  ]);

  return NextResponse.json({ success: true, added: toAdd.length, removed: toRemove.length });
}
