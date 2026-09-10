# Branch Outside-Attendance Policy Design

## Goal

Allow HR to configure, per branch, whether employees may check in or check out beyond the branch geofence. Every branch defaults to strict mode with a 150-metre threshold. An accepted punch outside the normal geofence must immediately create an HR review item and notify HR through in-app and web push.

## Chosen approach

Store the policy beside the existing branch coordinates in `hr_locations`. This keeps the coordinate, normal geofence radius, outside-punch switch, and maximum permitted distance in one row with the existing per-store authorization and audit trail.

Alternatives considered:

- Store the fields in `stores`: rejected because attendance policy would be mixed into a broad operational table and would need separate authorization handling.
- Create a new attendance-policy table: rejected because it would duplicate the existing one-row-per-store `hr_locations` ownership model without adding a separate lifecycle.

## Data model and defaults

Add two columns to `hr_locations`:

- `allow_outside_geofence boolean not null default false`
- `outside_max_distance_m integer not null default 150`

The migration backfills existing `hr_locations` rows to `false` and `150`. Branches without a location row receive the same defaults in the locations API response and when their first row is saved. The existing `radius_m` remains the normal geofence radius; `outside_max_distance_m` is the total distance from the branch pin, not an additional distance beyond `radius_m`.

Validation requires integer distances greater than zero. When outside punches are enabled, `outside_max_distance_m` must be at least `radius_m`, so the permitted outer boundary cannot be smaller than the normal geofence.

## HR locations interface

Each branch card on `/hr/locations` keeps the latitude, longitude, and normal radius fields and adds:

- A switch labelled “อนุญาตลงเวลานอกพื้นที่” / “Allow outside-area attendance”.
- A numeric “ระยะสูงสุดจากพิกัดสาขา (เมตร)” field, enabled only while the switch is on.
- Explanatory copy stating that accepted outside punches require HR review and trigger immediate notifications.

The page saves all policy fields in the existing per-store `PUT /api/hr/locations` request. The route retains `requireStoreManager(storeId)`, validates the new fields, and records them in the existing HR audit event.

## Punch decision

The server remains authoritative. After resolving the closest assigned branch and calculating distance:

1. At or within `radius_m`: accept normally.
2. Beyond `radius_m`, switch on, and at or within `outside_max_distance_m`: accept with `review_status='pending'`.
3. Beyond `radius_m` while the switch is off: reject before uploading the selfie or inserting attendance.
4. Beyond `outside_max_distance_m`: reject before uploading the selfie or inserting attendance.

The response for a rejected punch includes a stable error code and the measured/allowed distances so the employee screen can show a clear Thai or English message. Break punches retain the same geofence decision behavior as attendance punches because they use the same endpoint.

If a branch has no usable coordinates, preserve the current fallback behavior rather than locking employees out during rollout. Missing GPS and VPN/GPS-spoof suspicion continue through the existing pending-review path.

## Notifications and HR dashboard

For every accepted outside punch (case 2), reuse `notifyHrManagers` with notification type `hr_attendance_review`. This always inserts an in-app notification and attempts web push according to the existing notification pipeline. The notification links directly to `/hr/attendance?review=pending` and includes employee, action, branch distance, and allowed maximum.

The attendance row remains the source of truth for the HR action queue. `GET /api/hr/dashboard/badges` already counts `hr_attendance.review_status='pending'`; the HR hub continues to show that count under “รายการที่ต้องดำเนินการ” and link to the pending attendance queue. The hub should refresh the badge when the current HR account receives an attendance-review notification, while retaining its existing focus and interval fallbacks.

Rejected attempts are shown to the employee but are not inserted and therefore do not create dashboard work or an HR notification.

## Authorization and safety

- Reading remains scoped through `resolveHrScope()`.
- Updating remains scoped through `requireStoreManager(storeId)`.
- Attendance policy is evaluated only on the server from stored branch settings; client values cannot override it.
- A failed attendance insert still removes an uploaded selfie through the existing cleanup path.
- Policy rejection happens before upload, avoiding orphaned storage objects.
- Existing unrelated attendance gates—roster, duplicate-punch, open-day, GPS absence, and VPN suspicion—remain intact.

## Testing and verification

Use test-first coverage for:

- Location GET defaults and PUT validation/persistence for both fields.
- Strict default rejection outside 150 metres.
- Enabled acceptance between normal radius and configured maximum.
- Rejection beyond configured maximum.
- Normal inside-geofence acceptance.
- Accepted outside punch stored as pending, HR notification dispatched, and dashboard attendance count incremented.
- Store-scoped HR cannot edit another branch policy.
- Thai and English UI strings and disabled maximum-distance input state.

Run focused route assertions, TypeScript, focused ESLint, and the relevant HR E2E checks. Apply the migration to the configured Supabase project only after verifying its project identity, then read back the new defaults. Commit only files belonging to this feature, push to `main`, and verify local `HEAD` equals `origin/main`.
