import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { haversineMeters, isValidLat, isValidLng } from '@/lib/hr/geo';
import { assessIp } from '@/lib/hr/ip-geo';
import { getClientIp } from '@/lib/hr/request-ip';
import { openBusinessDateBangkok } from '@/lib/utils/date';
import { notifyHrManagers } from '@/lib/hr/notify';
import { notifyUser } from '@/lib/notifications/service';

// db type value → Thai label for notification bodies
const TYPE_TH: Record<string, string> = {
  in: 'เข้างาน',
  out: 'ออกงาน',
  break_start: 'เริ่มพัก',
  break_end: 'เลิกพัก',
};

const BUCKET = 'hr-documents';
const VALID_TYPES = ['in', 'out', 'break_start', 'break_end'] as const;
// ~3MB of base64 (a watermarked selfie JPEG is well under this).
const MAX_PHOTO_B64 = 3 * 1024 * 1024;
const PHOTO_PREFIX = /^data:image\/(jpe?g|png);base64,/;

interface StoreLocation {
  store_id: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
}

// POST /api/hr/ess/checkin — employee GPS + selfie attendance punch (§F).
// Auth-any: any authenticated employee may punch their own attendance. The photo
// is uploaded to the private hr-documents bucket (HR resolves a signed URL later);
// only the storage PATH is persisted. Geofence is computed server-side against the
// nearest of the user's assigned store locations.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // --- Validate type ---
  const type = body.type;
  if (typeof type !== 'string' || !VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  // --- GPS (optional) --- Valid coords run the normal geofence flow; a punch with NO resolvable
  // location is still accepted but HELD FOR HR REVIEW (owner ask 2026-07-08) so an employee can log
  // time when GPS fails and then explain it to HR (never a silent geofence bypass).
  const hasGps = isValidLat(body.gps_lat) && isValidLng(body.gps_lng);
  const gpsLat = hasGps ? (body.gps_lat as number) : null;
  const gpsLng = hasGps ? (body.gps_lng as number) : null;

  // --- Validate photo (data URL → base64 → magic bytes) ---
  const photo = typeof body.photo === 'string' ? body.photo : '';
  if (!PHOTO_PREFIX.test(photo)) {
    return NextResponse.json(
      { error: 'photo must be a data:image/jpeg or data:image/png base64 data URL' },
      { status: 400 }
    );
  }
  const b64 = photo.slice(photo.indexOf(',') + 1);
  if (b64.length === 0 || b64.length > MAX_PHOTO_B64) {
    return NextResponse.json({ error: 'photo is empty or too large' }, { status: 400 });
  }
  const buffer = Buffer.from(b64, 'base64');
  const isPng =
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isJpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) {
    return NextResponse.json({ error: 'photo must be a valid JPEG or PNG' }, { status: 400 });
  }
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  const service = createServiceClient();

  // --- Abuse guard (defense-in-depth): reject spammed or accidental-duplicate punches
  // BEFORE any storage upload, so a rejected punch never leaves an orphaned object.
  // Cheap lookback on the (user_id, business_date) index. This feeds payroll, so a
  // double-tap across tabs/devices or a retried lost-response must not create dupes. ---
  const RECENT_WINDOW_MS = 60_000;
  const DUP_GAP_MS = 30_000; // same-type punch within this window = accidental duplicate
  const MAX_PUNCHES_PER_MINUTE = 20;
  const { data: recentPunches } = await service
    .from('hr_attendance')
    .select('type, ts')
    .eq('user_id', user.id)
    .gte('ts', new Date(Date.now() - RECENT_WINDOW_MS).toISOString());
  if (recentPunches && recentPunches.length >= MAX_PUNCHES_PER_MINUTE) {
    return NextResponse.json(
      { error: 'Too many check-ins — please wait a moment.' },
      { status: 429 }
    );
  }
  const dupCutoff = Date.now() - DUP_GAP_MS;
  const isDuplicate = (recentPunches ?? []).some(
    (r: { type: string; ts: string }) => r.type === type && new Date(r.ts).getTime() >= dupCutoff
  );
  if (isDuplicate) {
    return NextResponse.json({ error: 'This check-in was just recorded.' }, { status: 409 });
  }

  // --- Resolve store + geofence against the user's assigned stores ---
  const { data: userStores } = await service
    .from('user_stores')
    .select('store_id')
    .eq('user_id', user.id);
  const storeIds = (userStores ?? []).map((r: { store_id: string }) => r.store_id);

  // Store attribution + geofence. `in_geofence` is null when it cannot be evaluated
  // (no configured geofence among the user's stores) — distinct from false (evaluated,
  // outside). We never guess a store for a multi-store employee we can't localise.
  let storeId: string | null = null;
  let distanceM: number | null = null;
  let inGeofence: boolean | null = null;

  if (hasGps && storeIds.length > 0) {
    const { data: locations } = await service
      .from('hr_locations')
      .select('store_id, lat, lng, radius_m')
      .in('store_id', storeIds)
      .not('lat', 'is', null)
      .not('lng', 'is', null);

    // Track the nearest store overall AND the nearest store the employee is actually
    // inside of. The geofence decision is per-store (dist <= that store's radius), not
    // nearest-by-distance — otherwise a closer store with a tighter radius could
    // shadow a farther store the employee is legitimately standing inside of.
    let nearest: { storeId: string; dist: number } | null = null;
    let bestInside: { storeId: string; dist: number } | null = null;
    for (const loc of (locations ?? []) as StoreLocation[]) {
      if (!isValidLat(loc.lat) || !isValidLng(loc.lng)) continue;
      const dist = haversineMeters(gpsLat as number, gpsLng as number, loc.lat, loc.lng);
      if (!nearest || dist < nearest.dist) nearest = { storeId: loc.store_id, dist };
      if (dist <= (loc.radius_m ?? 0) && (!bestInside || dist < bestInside.dist)) {
        bestInside = { storeId: loc.store_id, dist };
      }
    }
    if (bestInside) {
      // Inside at least one assigned store's radius → attribute to the nearest such store.
      storeId = bestInside.storeId;
      distanceM = Math.round(bestInside.dist);
      inGeofence = true;
    } else if (nearest) {
      // Geofence(s) exist but the employee is outside all of them.
      storeId = nearest.storeId;
      distanceM = Math.round(nearest.dist);
      inGeofence = false;
    } else if (storeIds.length === 1) {
      // No geofence configured, but a single assignment is unambiguous — keep the
      // store attribution; leave distance/in_geofence null (undeterminable).
      storeId = storeIds[0];
    }
    // else: multiple stores, none with a geofence → store_id stays null (ambiguous).
  }

  // No-GPS punch: nothing to geolocate, but a single assignment is unambiguous — attribute the
  // store so HR knows where it belongs (location stays null → this punch is held for review).
  if (!hasGps && storeId === null && storeIds.length === 1) {
    storeId = storeIds[0];
  }

  // --- Server-side IP capture; ip_country / is_vpn_suspect are assessed below (§F, P2.1c).
  // getClientIp prefers the platform-set x-real-ip over the client-prependable leftmost
  // x-forwarded-for hop, so a staffer can't spoof a clean IP to dodge the anti-VPN check. ---
  const ip = getClientIp(request.headers);

  // --- Upload selfie to the private bucket; persist only the path.
  // Run the IP assessment CONCURRENTLY with the upload — they're independent, so we
  // don't add serial latency. The IP assessment never throws (best-effort). ---
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `attendance/${user.id}/${Date.now()}-${rand}.jpg`;
  const [uploadResult, ipAssessment] = await Promise.all([
    service.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    }),
    assessIp(ip),
  ]);
  if (uploadResult.error)
    return NextResponse.json({ error: uploadResult.error.message }, { status: 500 });

  // --- Final anti-VPN / GPS-spoof flag: datacenter/proxy IP OR a gross IP-vs-GPS geo
  // mismatch. IP geolocation is coarse, so use a LARGE threshold to avoid false positives,
  // and SKIP the geo signal for mobile connections — mobile carriers (CGNAT) geolocate
  // their egress far from the subscriber, which would false-flag honest up-country staff. ---
  const IP_GPS_MISMATCH_M = 500_000; // 500 km — coarse IP geo; only flag gross mismatches
  const geoMismatch =
    hasGps &&
    !ipAssessment.isMobile &&
    ipAssessment.lat !== null &&
    ipAssessment.lng !== null &&
    haversineMeters(gpsLat as number, gpsLng as number, ipAssessment.lat, ipAssessment.lng) > IP_GPS_MISMATCH_M;
  const isVpnSuspect = ipAssessment.is_vpn_suspect || geoMismatch;
  const ipCountry = ipAssessment.country;

  const ts = new Date().toISOString();
  const device = (typeof body.device === 'string' ? body.device : '').slice(0, 300);

  // Geofence enforcement (owner 2026-07-08): a punch OUTSIDE every assigned geofence, or one
  // flagged VPN/GPS-spoof suspect, is not silently accepted — it's held for HR review. A punch
  // that's inside (true) or undeterminable (null, no geofence configured) needs no review.
  const reviewStatus: 'pending' | null =
    !hasGps || inGeofence === false || isVpnSuspect ? 'pending' : null;

  // Business-date bucket. Default = the 06:00-cutoff Bangkok business day. Overnight-shift fix: a
  // closing punch (out / break_end) recorded AFTER 06:00 would land on the NEXT business date and
  // orphan the whole night, while its matching opener sits unclosed on the previous date. If this
  // employee has an un-closed opener on a recent earlier business date, adopt THAT date so the pair
  // stays in one bucket (payroll/timesheet then reconcile the overnight shift correctly).
  let businessDate = openBusinessDateBangkok();
  if (type === 'out' || type === 'break_end') {
    const openerType = type === 'out' ? 'in' : 'break_start';
    const { data: opener } = await service
      .from('hr_attendance')
      .select('business_date')
      .eq('user_id', user.id)
      .eq('type', openerType)
      .lt('business_date', businessDate)
      .gte('ts', new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString())
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (opener?.business_date) {
      const { count } = await service
        .from('hr_attendance')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', type)
        .eq('business_date', opener.business_date as string);
      if (!count) businessDate = opener.business_date as string;
    }
  }

  const { data: inserted, error: insertErr } = await service
    .from('hr_attendance')
    .insert({
      user_id: user.id,
      store_id: storeId,
      type,
      ts,
      business_date: businessDate,
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      distance_m: distanceM,
      in_geofence: inGeofence,
      review_status: reviewStatus,
      photo_url: path,
      ip,
      ip_country: ipCountry,
      is_vpn_suspect: isVpnSuspect,
      device,
    })
    .select('id')
    .single();
  if (insertErr) {
    // Remove the orphaned object the upload just created before failing.
    await service.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => {});
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Held for review → tell HR there's a punch to check, and reassure the employee it's pending
  // (not rejected). Best-effort: a notification failure must never fail the punch.
  if (reviewStatus === 'pending') {
    try {
      const { data: prof } = await service
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .maybeSingle();
      const who = prof?.display_name || prof?.username || '—';
      const label = TYPE_TH[type] ?? type;
      const reason = !hasGps
        ? 'ไม่มีตำแหน่ง GPS'
        : isVpnSuspect
          ? 'ตำแหน่ง/เครือข่ายน่าสงสัย'
          : distanceM != null
            ? `นอกพื้นที่ ~${distanceM} ม.`
            : 'นอกพื้นที่';
      await Promise.allSettled([
        notifyHrManagers(service, {
          storeId,
          type: 'hr_attendance_review',
          title: 'ลงเวลารอตรวจสอบ',
          body: `${who} ${label} — ${reason}`,
          data: { attendance_id: inserted.id, url: '/hr/attendance?review=pending' },
          excludeUserId: user.id,
        }),
        notifyUser({
          userId: user.id,
          storeId,
          type: 'hr_attendance_result',
          title: 'ลงเวลาอยู่นอกพื้นที่ — รอ HR ตรวจสอบ',
          body: `${label} ของคุณถูกบันทึกแล้ว แต่ ${reason} จึงส่งให้ HR ตรวจสอบก่อน`,
          data: { url: '/me/checkin' },
        }),
      ]);
    } catch (e) {
      console.error('[ess/checkin] review notify failed:', e);
    }
  }

  return NextResponse.json(
    { ok: true, in_geofence: inGeofence, distance_m: distanceM, store_id: storeId, review_status: reviewStatus, ts },
    { status: 201 }
  );
}

// GET /api/hr/ess/checkin — this user's punches for the current business date.
// Returns a lightweight list (no photo/GPS) for the "Today" panel.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('hr_attendance')
    .select('id, type, ts, in_geofence, distance_m')
    .eq('user_id', user.id)
    .eq('business_date', openBusinessDateBangkok())
    .order('ts', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
