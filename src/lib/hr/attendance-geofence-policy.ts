export interface AttendanceGeofencePolicyInput {
  distanceM: number;
  radiusM: number;
  allowOutsideGeofence: boolean;
  outsideMaxDistanceM: number;
}

export type AttendanceGeofenceDecision =
  | { outcome: 'inside'; allowedDistanceM: number }
  | { outcome: 'outside_pending'; allowedDistanceM: number }
  | { outcome: 'rejected'; allowedDistanceM: number };

export function decideAttendanceGeofence(
  input: AttendanceGeofencePolicyInput,
): AttendanceGeofenceDecision {
  if (input.distanceM <= input.radiusM) {
    return { outcome: 'inside', allowedDistanceM: input.radiusM };
  }

  const allowedDistanceM = Math.max(input.radiusM, input.outsideMaxDistanceM);
  if (!input.allowOutsideGeofence || input.distanceM > allowedDistanceM) {
    return { outcome: 'rejected', allowedDistanceM: input.allowOutsideGeofence ? allowedDistanceM : input.radiusM };
  }

  return { outcome: 'outside_pending', allowedDistanceM };
}
