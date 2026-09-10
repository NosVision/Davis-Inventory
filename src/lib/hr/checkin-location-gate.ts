export type AttendanceLocationGate = {
  status: 'inside' | 'outside_pending' | 'blocked' | 'undetermined';
  code: 'outside_geofence_not_allowed' | 'outside_geofence_limit_exceeded' | null;
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
