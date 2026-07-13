import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

// POST /api/hr/payruns/[id]/reopen — reopen a finalized payrun back to draft so it can be
// regenerated/edited (§A: "แก้ต้อง reopen + ลง log"). HR only, compare-and-set, audited.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();

  // §P5.5: gate on the payrun's store.
  const { data: pr, error: prErr } = await service
    .from('hr_payruns')
    .select('store_id, bank_exported_at')
    .eq('id', id)
    .maybeSingle();
  if (prErr) return NextResponse.json({ error: 'Failed to reopen payrun' }, { status: 500 });
  if (!pr) return NextResponse.json({ error: 'Payrun not found' }, { status: 404 });
  const auth = await requireHrManagerForStore(pr.store_id as string | null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to reopen a payrun' }, { status: 400 });

  // §Phase 0B: this payrun's bank file was already exported → money may have been transferred.
  // Refuse to rewind it to draft unless HR explicitly overrides (force:true), which is loudly audited.
  const bankExportedAt = pr.bank_exported_at as string | null;
  const force = body.force === true;
  if (bankExportedAt && !force) {
    return NextResponse.json(
      {
        error:
          'A bank file was already exported for this payrun — money may have been transferred. Re-send with force to reopen anyway.',
        bank_exported_at: bankExportedAt,
        requires_force: true,
      },
      { status: 409 }
    );
  }
  // Clear the bank-export stamp: reopening means the payrun is being redone, so any prior export no
  // longer describes it (the export time is preserved in the audit entry below). A fresh export after
  // re-finalizing re-arms the lock.
  const { data: updated, error } = await service
    .from('hr_payruns')
    .update({ status: 'draft', finalized_by: null, finalized_at: null, bank_exported_at: null, bank_exported_by: null })
    .eq('id', id)
    .eq('status', 'finalized')
    .select('id');
  if (error) return NextResponse.json({ error: 'Failed to reopen payrun' }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Payrun not found or not finalized' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId, action: 'update', table: 'hr_payruns', recordId: id,
    before: { status: 'finalized', bank_exported_at: bankExportedAt },
    after: { status: 'draft', forced_after_bank_export: Boolean(bankExportedAt) },
    reason: bankExportedAt
      ? `payrun FORCE-reopened after bank export (${bankExportedAt}): ${reason}`
      : `payrun reopened: ${reason}`,
  });

  return NextResponse.json({ data: { id, status: 'draft' } });
}
