import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireHrManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';
import { isCalendarDate } from '@/lib/hr/leaves';
import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'hr_offboarding';
const ASSET_TABLE = 'hr_offboarding_assets';

const COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

const ASSET_COLS =
  'id, offboarding_id, asset_id, asset_code, asset_name, resolution, note, created_at, updated_at';

const EMPLOYEE_EMBED =
  'employee:profiles!hr_offboarding_user_id_fkey(id, display_name, username)';

const KINDS = ['resignation', 'termination'] as const;
const RESOLUTIONS = ['pending', 'returned', 'lost', 'damaged'] as const;

// Load the offboarding (with employee embed) plus its asset checklist.
async function loadDetail(service: SupabaseClient, id: string) {
  const { data: offboarding, error } = await service
    .from(TABLE)
    .select(`${COLS}, ${EMPLOYEE_EMBED}`)
    .eq('id', id)
    .maybeSingle();
  if (error || !offboarding) return { offboarding: null, assets: [] as unknown[] };

  const { data: assets } = await service
    .from(ASSET_TABLE)
    .select(ASSET_COLS)
    .eq('offboarding_id', id)
    .order('created_at', { ascending: true });

  return { offboarding, assets: assets ?? [] };
}

// GET /api/hr/offboarding/[id] — full detail: the offboarding, the departing employee,
// and the asset-return checklist.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { offboarding, assets } = await loadDetail(service, id);
  if (!offboarding) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });

  return NextResponse.json({ data: { ...(offboarding as Record<string, unknown>), assets } });
}

// PUT /api/hr/offboarding/[id] — edit a DRAFT offboarding (409 once it has left draft).
// Body may include { reason, notice_date, last_working_date, severance_note, kind,
// assets: [{ asset_id, resolution, note }] }. Only the provided fields change.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireHrManager();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from(TABLE)
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Offboarding not found' }, { status: 404 });
  if ((row.status as string) !== 'draft') {
    return NextResponse.json({ error: 'Only a draft offboarding can be edited' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = { updated_by: auth.userId };
  if ('reason' in body) {
    update.reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  }
  if ('severance_note' in body) {
    update.severance_note =
      typeof body.severance_note === 'string' ? body.severance_note.trim() || null : null;
  }
  if ('kind' in body) {
    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!(KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: "kind must be 'resignation' or 'termination'" }, { status: 400 });
    }
    update.kind = kind;
  }
  if ('notice_date' in body) {
    const d = typeof body.notice_date === 'string' ? body.notice_date : null;
    if (d !== null && !isCalendarDate(d)) {
      return NextResponse.json({ error: 'notice_date is not a valid date' }, { status: 400 });
    }
    update.notice_date = d;
  }
  if ('last_working_date' in body) {
    const d = typeof body.last_working_date === 'string' ? body.last_working_date : null;
    if (d !== null && !isCalendarDate(d)) {
      return NextResponse.json({ error: 'last_working_date is not a valid date' }, { status: 400 });
    }
    update.last_working_date = d;
  }

  const { data: parentUpd, error: updErr } = await service
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (updErr) return NextResponse.json({ error: 'Failed to update offboarding' }, { status: 500 });
  // If the compare-and-set matched 0 rows the offboarding was completed/cancelled between
  // our read and this write — stop before rewriting the checklist against a closed record.
  if (!parentUpd || parentUpd.length === 0) {
    return NextResponse.json(
      { error: 'This offboarding is no longer editable (not in draft)' },
      { status: 409 }
    );
  }

  // Asset resolutions: update each provided item by (offboarding_id, asset_id).
  if (Array.isArray(body.assets)) {
    for (const raw of body.assets as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const assetId = typeof item.asset_id === 'string' ? item.asset_id : '';
      if (!assetId) continue;

      const assetUpdate: Record<string, unknown> = {};
      if ('resolution' in item) {
        const resolution = typeof item.resolution === 'string' ? item.resolution : '';
        if (!(RESOLUTIONS as readonly string[]).includes(resolution)) {
          return NextResponse.json({ error: 'Invalid asset resolution' }, { status: 400 });
        }
        assetUpdate.resolution = resolution;
      }
      if ('note' in item) {
        assetUpdate.note = typeof item.note === 'string' ? item.note.trim() || null : null;
      }
      if (Object.keys(assetUpdate).length === 0) continue;

      await service
        .from(ASSET_TABLE)
        .update(assetUpdate)
        .eq('offboarding_id', id)
        .eq('asset_id', assetId);
    }
  }

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: id,
    after: update,
    reason: 'Offboarding draft edited',
  });

  const { offboarding, assets } = await loadDetail(service, id);
  return NextResponse.json({ data: { ...(offboarding as Record<string, unknown>), assets } });
}
