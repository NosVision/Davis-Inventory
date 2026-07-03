import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const TABLE = 'hr_offboarding';
const ASSET_TABLE = 'hr_offboarding_assets';

const COLS =
  'id, user_id, company_id, store_id, kind, reason, notice_date, last_working_date, ' +
  'severance_note, status, employee_signature_path, employee_signed_at, hr_signature_path, ' +
  'hr_signed_at, hr_signed_by, initiated_by, completed_at, created_at, updated_at, updated_by';

const ASSET_COLS =
  'id, offboarding_id, asset_id, asset_code, asset_name, resolution, note, created_at, updated_at';

// GET /api/hr/ess/offboarding — the caller's OWN offboarding record(s) with their
// asset-return checklist, newest first. Auth-any: never exposes anyone else's record.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data: records, error } = await service
    .from(TABLE)
    .select(COLS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Failed to load offboarding' }, { status: 500 });

  const rows = records ?? [];
  const ids = rows.map((r) => (r as unknown as { id: string }).id);

  const { data: assets } = ids.length
    ? await service.from(ASSET_TABLE).select(ASSET_COLS).in('offboarding_id', ids)
    : { data: [] as unknown[] };

  const assetsByParent = new Map<string, unknown[]>();
  for (const a of (assets ?? []) as unknown as Record<string, unknown>[]) {
    const parent = a.offboarding_id as string;
    const list = assetsByParent.get(parent) ?? [];
    list.push(a);
    assetsByParent.set(parent, list);
  }

  const data = rows.map((r) => {
    const rec = r as unknown as Record<string, unknown>;
    return { ...rec, assets: assetsByParent.get(rec.id as string) ?? [] };
  });

  return NextResponse.json({ data });
}
