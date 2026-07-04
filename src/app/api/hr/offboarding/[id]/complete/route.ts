import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManagerForRowStore } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_offboarding';
const ASSET_TABLE = 'hr_offboarding_assets';

// POST /api/hr/offboarding/[id]/complete — the finalization (§J6). Guards: the
// offboarding must still be open (draft|pending_signoff), a last_working_date must be
// set, and every asset item must be resolved (none 'pending'). The completion flip is
// an atomic compare-and-set claimed FIRST (source of truth); the downstream effects —
// hr_employees status/end_date, hr_assets, and account deactivation — are then applied
// best-effort, so a failure there returns 200 + a warning rather than 500-ing after the
// offboarding is already committed.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireHrManagerForRowStore('hr_offboarding', id);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, status, user_id, kind, reason, last_working_date')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });

  const status = row.status as string;
  if (status !== 'draft' && status !== 'pending_signoff') {
    return NextResponse.json({ error: 'This offboarding is already completed or cancelled' }, { status: 409 });
  }

  const userId = row.user_id as string;
  const kind = row.kind as string;
  const reason = (row.reason as string | null) ?? null;
  const lastWorkingDate = row.last_working_date as string | null;
  if (!lastWorkingDate) {
    return NextResponse.json({ error: 'A last_working_date must be set before completing' }, { status: 400 });
  }

  const { data: assetItems, error: assetErr } = await service
    .from(ASSET_TABLE)
    .select('id, asset_id, resolution')
    .eq('offboarding_id', id);
  if (assetErr) return NextResponse.json({ error: 'Failed to load asset checklist' }, { status: 500 });
  const items = assetItems ?? [];
  if (items.some((a) => (a.resolution as string) === 'pending')) {
    return NextResponse.json(
      { error: 'Every asset must be resolved (returned/lost/damaged) before completing' },
      { status: 400 }
    );
  }

  // Claim the completion atomically FIRST — a concurrent complete/cancel can never
  // double-run the effects below.
  const completedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await service
    .from(TABLE)
    .update({ status: 'completed', completed_at: completedAt, updated_by: auth.userId })
    .eq('id', id)
    .in('status', ['draft', 'pending_signoff'])
    .select('id');
  if (claimErr) return NextResponse.json({ error: 'Failed to complete offboarding' }, { status: 500 });
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: 'This offboarding is already completed or cancelled' }, { status: 409 });
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    before: { status },
    after: { status: 'completed', completed_at: completedAt },
    reason: `Offboarding completed: ${kind}`,
  });

  // --- Downstream effects: everything below is best-effort. ---
  const warnings: string[] = [];
  const newEmpStatus = kind === 'resignation' ? 'resigned' : 'terminated';

  // hr_employees: set status/end_date/end_reason (keyed by profile_id).
  const { data: empBefore, error: empReadErr } = await service
    .from('hr_employees')
    .select('id, status, end_date, end_reason')
    .eq('profile_id', userId)
    .maybeSingle();
  if (empReadErr || !empBefore) {
    warnings.push('Could not update the employee record (hr_employees).');
  } else {
    const { error: empUpdErr } = await service
      .from('hr_employees')
      .update({ status: newEmpStatus, end_date: lastWorkingDate, end_reason: reason })
      .eq('profile_id', userId);
    if (empUpdErr) {
      warnings.push('Failed to update the employee record (hr_employees).');
    } else {
      await logHrAudit(service, {
        actorId: auth.userId,
        action: 'update',
        table: 'hr_employees',
        recordId: empBefore.id as string,
        before: {
          status: empBefore.status,
          end_date: empBefore.end_date,
          end_reason: empBefore.end_reason,
        },
        after: { status: newEmpStatus, end_date: lastWorkingDate, end_reason: reason },
        reason: `Offboarding completed: ${kind}`,
      });
    }
  }

  // hr_assets: apply each checklist resolution. The checklist is a point-in-time snapshot
  // from initiate time, so re-scope every update to `holder_id = userId` — the asset may
  // have been reassigned to a DIFFERENT employee since, and an unscoped update would clobber
  // that live issuance. A 0-row match means the asset is no longer held by this employee →
  // warn (do not silently succeed). Every applied change is audited.
  for (const item of items) {
    const assetId = item.asset_id as string;
    const resolution = item.resolution as string;
    const patch =
      resolution === 'returned'
        ? { status: 'returned', holder_id: null, returned_date: lastWorkingDate }
        : resolution === 'lost'
          ? { status: 'lost' }
          : resolution === 'damaged'
            ? { status: 'damaged' }
            : null;
    if (!patch) continue;

    const { data: assetBefore } = await service
      .from('hr_assets')
      .select('id, status, holder_id, returned_date')
      .eq('id', assetId)
      .maybeSingle();

    const { data: assetAfter, error: assetUpdErr } = await service
      .from('hr_assets')
      .update(patch)
      .eq('id', assetId)
      .eq('holder_id', userId)
      .select('id, status, holder_id, returned_date');
    if (assetUpdErr) {
      warnings.push(`Failed to update asset ${item.asset_id}.`);
      continue;
    }
    if (!assetAfter || assetAfter.length === 0) {
      warnings.push(
        `Asset ${item.asset_id} was not updated — it is no longer held by this employee (possibly reassigned).`
      );
      continue;
    }
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'hr_assets',
      recordId: assetId,
      before: assetBefore ?? null,
      after: assetAfter[0],
      reason: `Offboarding asset ${resolution}: ${kind}`,
    });
  }

  // Deactivate the account.
  const { error: profErr } = await service.from('profiles').update({ active: false }).eq('id', userId);
  if (profErr) {
    warnings.push('Failed to deactivate the employee account.');
  } else {
    await logHrAudit(service, {
      actorId: auth.userId,
      action: 'update',
      table: 'profiles',
      recordId: userId,
      before: { active: true },
      after: { active: false },
      reason: `Offboarding completed: account deactivated (${kind})`,
    });
  }

  return NextResponse.json({
    data: { id, status: 'completed' },
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  });
}
