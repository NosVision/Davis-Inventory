import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveHrScope } from '@/lib/hr/route-auth';
import { openBusinessDateBangkok } from '@/lib/utils/date';

// Attendance selfies are uploaded by the ESS check-in route to the PRIVATE
// `hr-documents` bucket under `attendance/<userId>/…jpg` — we mint short-lived
// signed URLs here so raw storage paths are never exposed as public.
const BUCKET = 'hr-documents';
const SIGNED_URL_TTL_SECONDS = 120;

// Embed employee (profiles) + branch (stores). Both FKs are unambiguous, so the
// plain relationship embed resolves without needing the constraint name.
const LIST_SELECT =
  'id, user_id, store_id, type, ts, business_date, distance_m, in_geofence, review_status, ' +
  'photo_url, ip, ip_country, is_vpn_suspect, device, ' +
  // hr_attendance now has TWO FKs to profiles (user_id + reviewed_by), so the embed must name the
  // relationship explicitly or PostgREST 300/500s on the ambiguity.
  'employee:profiles!hr_attendance_user_id_fkey(username, display_name), store:stores(store_code, store_name)';

const ATTENDANCE_TYPES = ['in', 'out', 'break_start', 'break_end'];

interface AttendanceRow {
  id: string;
  user_id: string;
  store_id: string | null;
  type: string;
  ts: string;
  business_date: string;
  distance_m: number | null;
  in_geofence: boolean | null;
  review_status: string | null;
  photo_url: string | null;
  ip: string | null;
  ip_country: string | null;
  is_vpn_suspect: boolean;
  device: string | null;
  employee: { username: string | null; display_name: string | null } | null;
  store: { store_code: string | null; store_name: string | null } | null;
}

// GET /api/hr/attendance — HR attendance report (§F, P2.1c) with filters:
//   business_date (default = current open business day), store_id, user_id,
//   type, suspect ('true' → only VPN-suspect rows), limit, offset.
export async function GET(request: NextRequest) {
  // §P5.5: company-wide HR sees all punches; a scoped manager sees only their stores' punches.
  const scope = await resolveHrScope();
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const sp = request.nextUrl.searchParams;
  const businessDateParam = sp.get('business_date');
  // Validate the date format before it reaches the DB, so a malformed value can't
  // trigger a cast error whose raw message would leak query/schema internals.
  if (businessDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(businessDateParam)) {
    return NextResponse.json({ error: 'Invalid business_date' }, { status: 400 });
  }
  const businessDate = businessDateParam || openBusinessDateBangkok();
  const storeId = sp.get('store_id');
  const userId = sp.get('user_id');
  const type = sp.get('type');
  const suspectOnly = sp.get('suspect') === 'true';
  const reviewPending = sp.get('review') === 'pending';
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);

  const service = createServiceClient();
  let query = service.from('hr_attendance').select(LIST_SELECT, { count: 'exact' });
  // The review queue spans all dates (HR clears the whole backlog); normal browsing is date-scoped.
  if (reviewPending) query = query.eq('review_status', 'pending');
  else query = query.eq('business_date', businessDate);
  if (storeId) query = query.eq('store_id', storeId);
  if (scope.storeIds) query = query.in('store_id', scope.storeIds); // scoped manager: their stores only
  if (userId) query = query.eq('user_id', userId);
  if (type && ATTENDANCE_TYPES.includes(type)) query = query.eq('type', type);
  if (suspectOnly) query = query.eq('is_vpn_suspect', true);
  query = query.order('ts', { ascending: false }).range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  // Return a generic message — don't reflect the raw PostgREST/Postgres error to the client.
  if (error) return NextResponse.json({ error: 'Failed to load attendance' }, { status: 500 });

  const rows = (data ?? []) as unknown as AttendanceRow[];

  // Sign every selfie path in one batched round-trip. A signing failure must
  // NEVER sink the whole request — bad/missing paths simply resolve to null.
  const signedByPath = new Map<string, string>();
  const paths = rows.map((r) => r.photo_url).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    try {
      const { data: signed } = await service.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl && !item.error) {
          signedByPath.set(item.path, item.signedUrl);
        }
      }
    } catch {
      // leave signedByPath empty → every photo_signed_url falls back to null
    }
  }

  const responseRows = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    store_id: r.store_id,
    type: r.type,
    ts: r.ts,
    business_date: r.business_date,
    distance_m: r.distance_m,
    in_geofence: r.in_geofence,
    review_status: r.review_status,
    is_vpn_suspect: r.is_vpn_suspect,
    ip_country: r.ip_country,
    employee_name: r.employee?.display_name || r.employee?.username || null,
    store_label: r.store?.store_name || r.store?.store_code || null,
    photo_signed_url: r.photo_url ? signedByPath.get(r.photo_url) ?? null : null,
  }));

  return NextResponse.json({ data: responseRows, total: count ?? 0, limit, offset });
}
