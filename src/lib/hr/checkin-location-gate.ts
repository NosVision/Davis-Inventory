import { haversineMeters } from '@/lib/hr/geo';

export type AttendanceLocationGate = {
  status: 'inside' | 'outside_pending' | 'blocked' | 'undetermined';
  code: 'outside_geofence_not_allowed' | 'outside_geofence_limit_exceeded' | 'gps_required' | null;
  store_id: string | null;
  distance_m: number | null;
  allowed_distance_m: number | null;
};

export type AttendanceLocationGateLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export function areAttendanceControlsBlocked(
  loadStatus: AttendanceLocationGateLoadStatus,
  gate: Pick<AttendanceLocationGate, 'status'> | null,
  isFresh = true
): boolean {
  if (loadStatus === 'unavailable') return false;
  return !isFresh || loadStatus !== 'ready' || gate?.status === 'blocked';
}

/** A GPS fix the preflight was (or would be) run against. */
export interface GateFix {
  lat: number;
  lng: number;
  /** Date.now() when the fix was captured. */
  at: number;
}

/** How far the phone must move before the branch policy is asked again. */
export const GATE_RECHECK_DISTANCE_M = 20;
/** How old a verified fix may get before it is re-verified even without moving. */
export const GATE_RECHECK_AGE_MS = 20_000;

/**
 * Does a new GPS fix justify asking the server again?
 *
 * `watchPosition` with high accuracy delivers a fresh fix roughly every second while the phone
 * sits still. Re-running the branch preflight on every one of them put the page through
 * loading → ready → loading forever, so the status line alternated "กำลังหาตำแหน่ง" /
 * "ได้ตำแหน่งแล้ว" and the punch buttons blinked in step with it on every device (คุณเมย์
 * 2026-09-17, after the 2026-09-11 gate shipped). A fix only matters when the phone has actually
 * moved, or when the last answer is old enough that a moved-then-stopped phone must be re-checked.
 */
export function shouldRecheckLocationGate(previous: GateFix | null, next: GateFix): boolean {
  if (!previous) return true;
  if (next.at - previous.at >= GATE_RECHECK_AGE_MS) return true;
  return haversineMeters(previous.lat, previous.lng, next.lat, next.lng) >= GATE_RECHECK_DISTANCE_M;
}
