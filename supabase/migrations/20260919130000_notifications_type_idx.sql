-- notifications has grown to ~644k rows (336k new_deposit, 201k deposit_confirmed, 50k
-- approval_request as of 2026-09-19) and the only indexes are on user_id / store_id. Any query
-- that selects by type — the HR reset script, the HR hub's "newest hr_attendance_review" lookup
-- (src/lib/hr/attendance-review-notifications.ts) — is a 16 s sequential scan, past the 8 s
-- statement timeout PostgREST runs under. A composite on (type, created_at desc) turns both into
-- an index range scan.
--
-- Plain CREATE INDEX (not CONCURRENTLY, which cannot run inside the migration transaction) takes
-- a share lock that blocks writes to notifications for the build (~20 s at this size): apply it
-- outside opening hours.
create index if not exists idx_notifications_type_created
  on public.notifications (type, created_at desc);
