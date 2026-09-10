# Branch Outside-Attendance Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict-by-default per-branch outside-attendance policy, enforce it server-side, and surface every accepted outside punch to HR through push, in-app, and the HR hub action queue.

**Architecture:** Persist the switch and total maximum distance on `hr_locations`, isolate the distance decision in a pure helper, and call it from the existing ESS check-in route before the selfie upload. Reuse the current pending-review notification and dashboard badge pipeline, adding a notification-driven badge refresh for immediate HR hub feedback.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres, Node test runner, next-intl.

**Spec:** `docs/superpowers/specs/2026-09-10-branch-outside-attendance-design.md`

## Global Constraints

- Every branch defaults to `allow_outside_geofence=false` and `outside_max_distance_m=150`.
- `outside_max_distance_m` is total distance from the branch pin and must be at least `radius_m` when enabled.
- Strict or over-limit rejection occurs before selfie upload and attendance insertion.
- Accepted outside punches are always `review_status='pending'` and notify HR through the existing `hr_attendance_review` pipeline.
- Missing branch coordinates preserve the existing fallback behavior.
- Existing scoped HR authorization, audit, roster, duplicate, open-day, VPN, and missing-GPS behavior must remain intact.
- Preserve unrelated working-tree changes and stage only feature files.

---

### Task 1: Pure outside-attendance decision and schema migration

**Files:**
- Create: `src/lib/hr/attendance-geofence-policy.ts`
- Create: `scripts/test-attendance-geofence-policy.cjs`
- Modify: `supabase/migrations/20260910163040_hr_location_outside_attendance_policy.sql`

**Interfaces:**
- Consumes: measured distance plus `radius_m`, `allow_outside_geofence`, and `outside_max_distance_m` from a resolved branch location.
- Produces: `decideAttendanceGeofence(input): { outcome: 'inside' | 'outside_pending' | 'rejected'; allowedDistanceM: number }`.

- [ ] **Step 1: Write the failing pure-policy tests**

  Cover literal cases: 100m inside a 150m radius, 151m with the switch off, 300m with a 500m enabled maximum, 501m over that maximum, and an enabled maximum smaller than the radius normalized to the radius.

- [ ] **Step 2: Run the tests and verify RED**

  Run: `node --test scripts/test-attendance-geofence-policy.cjs`

  Expected: FAIL because `src/lib/hr/attendance-geofence-policy.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

  Export these types and function:

  ```ts
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
  ): AttendanceGeofenceDecision;
  ```

- [ ] **Step 4: Run the policy tests and verify GREEN**

  Run: `node --test scripts/test-attendance-geofence-policy.cjs`

  Expected: all policy cases pass with no warnings.

- [ ] **Step 5: Add the migration SQL**

  Add both non-null columns with defaults, explicit backfill, positive-value checks, and a conditional check requiring `outside_max_distance_m >= radius_m` only when outside attendance is enabled. Existing RLS remains on `hr_locations`; no new policy is required.

- [ ] **Step 6: Commit Task 1**

  Stage only the helper, test, and migration, then commit `feat(hr): add branch attendance distance policy`.

### Task 2: Locations API and UI

**Files:**
- Modify: `src/app/api/hr/locations/route.ts`
- Modify: `src/app/(dashboard)/hr/locations/page.tsx`
- Modify: `src/messages/th.json`
- Modify: `src/messages/en.json`
- Create: `scripts/test-hr-location-policy-route.cjs`

**Interfaces:**
- Consumes: `allow_outside_geofence` and `outside_max_distance_m` in the locations API.
- Produces: GET rows with strict defaults and PUT persistence after validation.

- [ ] **Step 1: Write failing route tests**

  Execute the real route against an in-memory Supabase boundary and assert: GET supplies `false/150` when a row is absent; PUT rejects non-boolean switches, non-integer/non-positive maximums, and enabled maximums below `radius_m`; PUT persists valid values and makes no write when authorization fails.

- [ ] **Step 2: Run the route tests and verify RED**

  Run: `node --test scripts/test-hr-location-policy-route.cjs`

  Expected: FAIL because the response and upsert do not yet include the policy fields.

- [ ] **Step 3: Extend the API**

  Select, default, validate, upsert, return, and audit both fields while retaining `resolveHrScope()` and `requireStoreManager(storeId)`.

- [ ] **Step 4: Run the route tests and verify GREEN**

  Run: `node --test scripts/test-hr-location-policy-route.cjs`

- [ ] **Step 5: Add the branch-card controls**

  Extend `BranchLocation` and `Draft`, add a per-card switch, disable the maximum-distance input while off, and send both values in PUT. Keep mobile stacking and existing compact/list modes.

- [ ] **Step 6: Add Thai and English strings**

  Add labels, help text, enabled/disabled state copy, maximum-distance validation context, and check-in rejection copy under the existing `hr.locations` and `hr.checkin` namespaces.

- [ ] **Step 7: Run focused validation**

  Run the route tests, `npx tsc --noEmit`, and focused ESLint for the API/page/helper files.

- [ ] **Step 8: Commit Task 2**

  Commit `feat(hr): configure outside attendance by branch` with only Task 2 files.

### Task 3: Check-in enforcement and HR notification detail

**Files:**
- Modify: `src/app/api/hr/ess/checkin/route.ts`
- Modify: `src/app/(dashboard)/me/checkin/page.tsx`
- Create: `scripts/test-ess-checkin-geofence-policy.cjs`

**Interfaces:**
- Consumes: `decideAttendanceGeofence` and the two location policy fields.
- Produces: accepted outside punches with pending review, or HTTP 403 with `code='outside_geofence_not_allowed'` / `code='outside_geofence_limit_exceeded'`, `distance_m`, and `allowed_distance_m`.

- [ ] **Step 1: Write failing enforcement tests**

  Exercise the real decision integration around the route boundary: strict rejection, enabled acceptance within the outer limit, rejection beyond the limit, normal inside acceptance, and accepted-outside notification data including measured and allowed distance.

- [ ] **Step 2: Run the enforcement tests and verify RED**

  Run: `node --test scripts/test-ess-checkin-geofence-policy.cjs`

  Expected: strict and over-limit punches are currently accepted pending review, so those assertions fail.

- [ ] **Step 3: Enforce before upload**

  Fetch the policy columns with each location, retain the chosen location policy while resolving nearest/inside branches, apply `decideAttendanceGeofence` after store attribution, and return the stable rejection response before IP assessment or storage upload.

- [ ] **Step 4: Enrich accepted-outside alerts**

  Keep `review_status='pending'`, call `notifyHrManagers`, and include `distance_m`, `allowed_distance_m`, `store_id`, and `attendance_id` in notification data and Thai body copy. Keep employee pending notification behavior.

- [ ] **Step 5: Show clear employee errors**

  Map the two stable error codes to localized messages while preserving the API message fallback for unrelated failures.

- [ ] **Step 6: Run enforcement tests and verify GREEN**

  Run: `node --test scripts/test-ess-checkin-geofence-policy.cjs`

- [ ] **Step 7: Commit Task 3**

  Commit `feat(hr): enforce branch outside attendance limits`.

### Task 4: Immediate HR hub badge refresh

**Files:**
- Modify: `src/app/(dashboard)/hr/page.tsx`
- Create: `scripts/test-hr-dashboard-attendance-refresh.cjs`

**Interfaces:**
- Consumes: the existing notification store, populated in real time by `useNotifications()` for the authenticated HR account.
- Produces: a reload of `/api/hr/dashboard/badges` when the newest `hr_attendance_review` notification changes.

- [ ] **Step 1: Write a failing refresh test**

  Isolate a small exported predicate/key helper that returns the latest attendance-review notification id and prove that unrelated notifications do not trigger the attendance refresh key.

- [ ] **Step 2: Run the refresh test and verify RED**

  Run: `node --test scripts/test-hr-dashboard-attendance-refresh.cjs`

- [ ] **Step 3: Wire notification-driven refresh**

  Select notifications from `useNotificationStore`, derive the latest `hr_attendance_review` id, and make the existing badge loader rerun when that id changes. Retain the 45-second and focus fallbacks.

- [ ] **Step 4: Run the refresh test and verify GREEN**

  Run: `node --test scripts/test-hr-dashboard-attendance-refresh.cjs`

- [ ] **Step 5: Commit Task 4**

  Commit `feat(hr): refresh attendance alerts immediately`.

### Task 5: Database rollout, regression verification, review, and push

**Files:**
- Modify if required by findings: only files already listed in Tasks 1–4.

**Interfaces:**
- Consumes: completed feature commits and configured Supabase project.
- Produces: verified database defaults, green focused checks, reviewed diff, and `origin/main` matching local `HEAD`.

- [ ] **Step 1: Verify the Supabase target identity**

  Compare the linked project ref/URL with `.env.local` before any remote schema change. Stop if they differ.

- [ ] **Step 2: Inspect migration state and apply through the project workflow**

  Use CLI `--help` and migration-list output before `npx supabase db push`; do not repair migration history automatically.

- [ ] **Step 3: Read back defaults and constraints**

  Query `information_schema.columns`, `pg_constraint`, and current `hr_locations` rows to confirm `false/150` defaults and existing-row backfill.

- [ ] **Step 4: Run the complete focused suite**

  Run all four new Node tests, the existing location scope E2E if credentials are available, `npx tsc --noEmit`, focused ESLint, and `git diff --check`.

- [ ] **Step 5: Request code review and address findings**

  Review authorization, rejection-before-upload ordering, notification recipients, migration constraints, UI accessibility, and unrelated worktree preservation.

- [ ] **Step 6: Verify the final staged scope**

  Confirm only the design, plan, migration, feature source, messages, and focused tests are included. Do not stage the existing commission edit or unrelated untracked files.

- [ ] **Step 7: Push and prove synchronization**

  Push `main`, fetch `origin/main`, and verify `git rev-parse HEAD` equals `git rev-parse origin/main`.
