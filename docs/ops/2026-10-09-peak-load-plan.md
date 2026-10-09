# Peak-load outage 2026-10-09 ~17:50–18:05 — diagnosis & plan

Status (2026-10-09 evening): code items 2a–2c done on branch `fix/peak-load-and-checkin-hints`
(not merged/deployed). Migration `20261009120000_print_server_status_out_of_realtime.sql` written,
**not applied**. Compute upgrade (item 1) is the owner's call. The same branch also carries the
check-in hints (iPhone home-screen permission, approximate location, `translate="no"`).

## What happened (Thai time)
- 17:20–17:52 shift-start traffic climbed to ~1,000 req/min — **1.7× the same window on 2026-10-08** (which had 0 errors).
- 17:51:52 first Postgres `statement timeout`; DB so starved that a trivial `pg_stat_statements` sum took 11–14 s.
- 17:53:18 PostgREST got a schema-cache reload (no migration ran today — likely platform-initiated), could not reload under load → **every REST call 503 for ~30–40 s** (PGRST002 / PGRST003).
- 17:56–18:04 Auth `/user` and `/token` refresh 504 (10–15 s) → users whose token expired froze / got logged out.
- ~18:05 recovered.

Not a regression: the 2026-10-06 middleware fix (`getClaims`) is live on main. Root cause is capacity.

## Key facts
- Supabase project `oogyjqywuqmutkjnnsik` runs on **NANO compute (0.5 GB)** — the smallest tier. `max_connections` 60, PostgREST pool 10.
- Dashboard shows **outstanding invoices** — pay before changing compute.
- Server-time share 17:40–17:52 (7,370 req, 2,044 s origin time):
  - `/auth/v1/user` from API routes (`auth.getUser()`): 1,027 calls, **~23%**
  - push fan-out (`notification_preferences` + `push_subscriptions` per recipient, `src/lib/notifications/push.ts`): 1,332 calls, ~6.5%
  - `print_server_status` heartbeat is in the `supabase_realtime` publication (~588k updates lifetime) though only the store-settings page subscribes.
- Indexes / RLS on deposits, notifications, comparisons checked — fine.

## Plan
1. **Upgrade compute** Nano → Medium (4 GB, ~$60/mo) or Small (2 GB, ~$15/mo). Dashboard → Project Settings → Infrastructure → Compute size. Causes 2–5 min restart → do off-peak (10:00–14:00), never 17:00–18:30 or 03:30–04:30. Owner decision (cost).
2. **Code (zero-downtime deploy)**, on a new branch, typecheck + build green before merge:
   a. Shared server helper using `getClaims()`; swap hot routes (`/api/hr/ess/*`, `src/lib/hr/route-auth.ts`, POS). Keep `getUser()` for sensitive routes (change-password, user admin, payroll) and keep the `profiles.active` check (disabled-login rule). Est. −20–25% peak load.
   b. Batch push recipient lookups (one query for prefs + subscriptions). Est. −5%.
   c. Drop `print_server_status` from the realtime publication; settings page polls instead.
3. After each change, compare the next 04:00 and 17:30 peaks in edge/postgres logs.

Expected: code alone ≈ −25–35% peak load — helps but not enough on Nano for a Friday peak; do both.
