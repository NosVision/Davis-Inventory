# Peak-load outage 2026-10-09 ~17:50–18:05 — diagnosis & plan

Status (2026-10-09 evening): code items 2a–2c done on branch `fix/peak-load-and-checkin-hints`
(merged + pushed to main as c6b3d6c). Migration `20261009120000_print_server_status_out_of_realtime.sql` written and
**applied to prod 2026-10-09 ~20:01**. Compute upgrade (item 1) is the owner's call. The same branch also carries the
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

## Findings 2026-10-10 (morning, after the 04:00 peak)

04:00 peak (10 Oct): `/auth/v1/user` calls down ~90% vs the day before (getSessionUser works), but
p95 25–51 s for 17 min (04:03–04:20), 45 statement timeouts, a 1-row INSERT took 10.8 s — every
endpoint equally slow ⇒ CPU/connection starvation on NANO, not a bad query. Compute upgrade still
the main fix.

1. **1,090 GB of temp files since April = Supabase's own `postgres_exporter`.** It scrapes every
   ~60 s and its queries materialise `pg_stat_statements` (4,821 rows, ~50 MB of query text, cap
   5,000) through a tuplestore that spills because `work_mem` is 2,184 kB → ~3.5–5 MB per scan.
   Those sessions run `set pg_stat_statements.track = none` (659×), so the usage never shows in
   pg_stat_statements (all app roles: 0 bytes temp). Measured 2.5 min quiet window: +7 files /
   ~29 MB ⇒ ~170 files/h now; long-run average 87 files/h, 7 GB/day. Mostly harmless; at peak the
   exporter's regexp query ran 12–18 s (4× on 9 Oct). Options: nothing / `pg_stat_statements_reset()`
   before a peak (shrinks it temporarily) / bigger compute (larger work_mem).
2. **PostgREST schema-cache reloads ~18×/day come from Supabase Realtime.** When the last websocket
   user leaves, Realtime drops its DB connection ("Tenant has no connected users…"); on the next
   connect it runs "Creating partitions for realtime.messages" = `CREATE TABLE IF NOT EXISTS` +
   `ALTER TABLE … OWNER TO supabase_realtime_admin` → event trigger `pgrst_ddl_watch` (source
   checked: no exclusion for the `realtime` schema, 'ALTER TABLE' is in its list) → `NOTIFY pgrst`
   → PostgREST reloads schema + config. Timestamps match every reload (e.g. 04:15:08.57→.68,
   14:14:07.59→.70, 17:59:07.56→.69 UTC; 4/4 in the 23:00 hour). On 9 Oct 17:52:40–17:53:01 Thai
   Realtime logged "Too many database timeouts" ×5, reconnected, DDL → reload at 17:53:18 → the
   catalog queries timed out for 41 s (PGRST002) → every REST call 503. That is what turned "slow"
   into "down". We cannot change the trigger (owner supabase_admin) — report to Supabase support;
   a bigger instance keeps the reload at 10–80 ms.
3. **`HEAD /rest/v1/deposits` = the deposit list page**, `src/app/(dashboard)/deposit/page.tsx`
   `loadStats` (lines ~296–314): 7 deposit counts + 1 withdrawals count = 8 requests on page load,
   on date-filter change, and on EVERY realtime change to a deposit in the store (no debounce; also
   re-reads the whole active list with no LIMIT). At the 04:00 peak: 15 users at one store, 9 at
   another → 612 HEAD requests in 20 min. Fix: one RPC `deposit_counts(store_id, from, to)` with
   `count(*) filter (…)` (8→1 request) + 3 s debounce on the realtime refetch.
