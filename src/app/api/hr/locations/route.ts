import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope, requireStoreManager } from '@/lib/hr/route-auth';
import { logHrAudit } from '@/lib/hr/audit';

const TABLE = 'hr_locations';

interface StoreRow {
  id: string;
  store_name: string | null;
  store_code: string | null;
}

interface LocationRow {
  store_id: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
}

// GET /api/hr/locations — one row per active branch, stitched with its geofence (if set).
export async function GET() {
  // §P5.5: company-wide HR sees every branch geofence; a scoped manager only their stores'.
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const service = createServiceClient();

  let storesQuery = service
    .from('stores')
    .select('id, store_name, store_code')
    .eq('active', true)
    .order('store_name');
  if (scope.storeIds) storesQuery = storesQuery.in('id', scope.storeIds);
  const [storesRes, locationsRes] = await Promise.all([
    storesQuery,
    service.from(TABLE).select('store_id, lat, lng, radius_m'),
  ]);

  if (storesRes.error) return NextResponse.json({ error: storesRes.error.message }, { status: 500 });
  if (locationsRes.error) return NextResponse.json({ error: locationsRes.error.message }, { status: 500 });

  const stores = (storesRes.data ?? []) as StoreRow[];
  const locations = (locationsRes.data ?? []) as LocationRow[];

  const data = stores.map((s) => {
    const loc = locations.find((l) => l.store_id === s.id);
    return {
      store_id: s.id,
      store_name: s.store_name,
      store_code: s.store_code,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      radius_m: loc?.radius_m ?? null,
    };
  });

  return NextResponse.json({ data });
}

// PUT /api/hr/locations — upsert one branch geofence { store_id, lat, lng, radius_m }.
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const storeId = typeof body.store_id === 'string' ? body.store_id : '';
  if (!storeId) return NextResponse.json({ error: 'store_id is required' }, { status: 400 });

  // §P5.5: geofence config is per store — only a manager of this store (or company HR).
  const auth = await requireStoreManager(storeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const lat = body.lat;
  const lng = body.lng;
  const radiusM = body.radius_m;

  const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: 'lat must be a number between -90 and 90' }, { status: 400 });
  }
  if (!isFiniteNumber(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'lng must be a number between -180 and 180' }, { status: 400 });
  }
  if (!isFiniteNumber(radiusM) || !Number.isInteger(radiusM) || radiusM <= 0) {
    return NextResponse.json({ error: 'radius_m must be a positive integer' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .upsert(
      { store_id: storeId, lat, lng, radius_m: radiusM, updated_by: auth.userId },
      { onConflict: 'store_id' }
    )
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logHrAudit(service, {
    actorId: auth.userId,
    action: 'update',
    table: TABLE,
    recordId: storeId,
    after: data,
  });

  return NextResponse.json({ data });
}
