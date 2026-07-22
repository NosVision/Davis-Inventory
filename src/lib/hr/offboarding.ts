import type { SupabaseClient } from '@supabase/supabase-js';

const ASSET_TABLE = 'hr_offboarding_assets';
const ASSET_COLS =
  'id, offboarding_id, asset_id, asset_code, asset_name, resolution, note, created_at, updated_at';

// Snapshot the assets the employee currently holds into the offboarding's return
// checklist. Best-effort by contract: returns the created rows plus warnings instead of
// throwing, so a snapshot failure never fails the initiation that triggered it. Shared
// by HR-initiated offboarding (POST /api/hr/offboarding) and resignation-request accept.
export async function snapshotOffboardingAssets(
  service: SupabaseClient,
  offboardingId: string,
  userId: string
): Promise<{ assets: unknown[]; warnings: string[] }> {
  const warnings: string[] = [];

  const { data: held, error: heldErr } = await service
    .from('hr_assets')
    .select('id, asset_code, name')
    .eq('holder_id', userId)
    .eq('status', 'issued');
  if (heldErr) {
    warnings.push('Could not read the employee’s issued assets; the return checklist is empty.');
    return { assets: [], warnings };
  }
  if (!held || held.length === 0) return { assets: [], warnings };

  const rows = held.map((a) => ({
    offboarding_id: offboardingId,
    asset_id: a.id as string,
    asset_code: (a.asset_code as string | null) ?? null,
    asset_name: (a.name as string | null) ?? null,
    resolution: 'pending',
  }));
  const { data: created, error: assetErr } = await service
    .from(ASSET_TABLE)
    .insert(rows)
    .select(ASSET_COLS);
  if (assetErr) {
    warnings.push('Failed to snapshot the asset-return checklist; add items manually.');
    return { assets: [], warnings };
  }
  return { assets: created ?? [], warnings };
}
